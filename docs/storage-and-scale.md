# Device storage, cloud sync and scale

How CrabbyTab keeps tournament data on the device and in Firestore, and what keeps it working for
large events (the target is a 1000-team tournament).

## Working copy on the device

Each tournament's working copy lives in **IndexedDB** (database `crabbytab`, object store `kv`),
under the same keys localStorage used before: `crabbytab_t_{slug}_{suffix}` (`meta`, `rounds`,
`teams`, `adjudicators`, `debates`, `ballots`, `feedback`, `auditEvents`, `syncBaseline`, ...), each
holding a JSON string. localStorage (~5 MB per origin) could not hold a 1000-team working copy;
IndexedDB is bounded only by the browser's disk quota.

- `src/lib/offline/localStore.ts` is the only code that touches it. `TournamentContext` loads one
  tournament's keys into memory when the tournament opens (`loadPrefix`) and then reads and writes
  synchronously; writes are coalesced and flushed to IndexedDB in one transaction a moment later.
- A failed flush (quota exceeded, storage blocked) shows the "Could not save … locally" alert and is
  retried with the next change.
- Creating or importing a tournament writes all of its keys in one transaction (`writeAll`), so a
  failure leaves nothing half-saved.
- **Migration:** on first use, every `crabbytab_t_*` key in localStorage is copied to IndexedDB and,
  once that commits, removed from localStorage. A key already in IndexedDB is never overwritten.
- If IndexedDB is unavailable (some private-browsing modes), the same store falls back to
  localStorage with its old size limit.
- Known limits: a change is on disk a few milliseconds after it is made rather than immediately, and
  a second tab sees another tab's changes to the same tournament after a reload.

Theme, language and remembered portal passcodes stay in localStorage: they are tiny and must be
readable synchronously before the first paint.

## Uploading to the cloud

For cloud tournaments on administrator devices, ballots, debates, teams and adjudicators are also
written and read live, record by record (see `live-collaboration.md`); uploads then normally have
nothing to send for those collections.

"Upload to cloud" sends only what changed since this device last synced:

- **Delta.** `recordsChangedSinceBaseline` (`application/cloudSync.ts`) compares each record with
  its synced-baseline entry (the cloud `syncVersion` and content hash it had at the last upload or
  download). Records without an entry, edited records, records whose version changed (e.g. a
  diverged record resolved as "keep mine") and records restored from a backup are sent; the rest are
  already in the cloud as held here. Not sending unchanged records also stops a device from
  archiving its never-edited stale copy as a conflict when another device changed the record.
- **Batching.** Records the cloud may already hold are read and written in transactions of up to
  150 records (`infrastructure/tournamentRepository.ts`). Each record keeps the per-record rules it
  always had: created at version 1 if missing, skipped if identical, refused and archived in
  `syncConflicts` if the cloud copy is newer or soft-deleted, otherwise written at the next version
  with the replaced version archived (`superseded` / `restored`). Tombstoned deletions are applied
  in transactions of the same size.
- **Audit events** are append-only (the Firestore rules refuse updates), so events the cloud has
  never seen are created in plain write batches without reading them; a batch refused because an
  event already exists is retried with per-event checks. The upload no longer reads the whole audit
  collection.
- An interrupted upload keeps every chunk committed before the failure, and the records in them
  keep their new versions on the device, as before.

Measured with the in-memory Firestore (`uploadScale.test.ts`; synthetic 1000-team BP event, 550
adjudicators, 8 rounds played, 10,299 records):

| Upload | Before (reads / writes / commits) | After |
| --- | --- | --- |
| Initial | 10,304 / 10,301 / ~10,300 one-record transactions | 9,983 / 10,301 / 74 |
| Again, nothing changed | 10,303 / 2 | 4 / 2 |
| One round (1,061 changed records) | 11,343 / 1,084 | 1,025 / 1,084 / 12 |

Writes are already proportional to changes; the initial upload of a 1000-team event (~10k writes)
fits in Spark's 20k writes/day, but several full uploads a day do not, so plan on Blaze for events
of that size. Security-rule `get()` lookups are billed per request, so batching also cuts those.

## Private portals: participant-scoped reads

Each debate in Firestore carries `participantIds`: the ids of every team and adjudicator in the
room (`debateParticipantIds` in `src/lib/privateSync.ts`). It is derived, cloud-only data:

- The admin upload writes it on every debate it sends and refreshes it when a panel or draw
  changes; when only the index is missing or outdated it is updated without bumping `syncVersion`
  or archiving a conflict. Sync hashing and comparisons ignore it, and downloads strip it, so the
  working copy (and the public projection built from it) never holds it.
- **Backfill.** `tournaments/{id}/data/participantIndex` (`{ version: 1 }`) records that every
  debate has the index. The first upload after this change reads the tournament's debates once,
  updates those without a current index in batches, then writes the marker; later uploads only read
  the marker. A tournament first created by an upload is marked without the scan.
- `/api/private/sync` and `/api/private/team` read the participant's debates with
  `array-contains` once the marker exists (and every debate before that), the teams of those
  debates by id, and their ballots with `debateId in [...]` (30 per query). Assignment, draw release,
  adjudicator reveal and result-release checks still run on the debate content itself, so a stale
  index can hide a debate but never expose or authorise one.

For a 1000-team BP event (2,250 debates over 9 rounds) a team portal load reads ~10 debates
instead of 2,250, plus its ~30 opponents' team documents instead of 1,000, and its ~9 debates'
ballots instead of all ~2,250.

Known limit: a debate written to the cloud by an older client after the marker exists has no index
until the next admin upload that sends it.

## Public projection paged by round

The public view (`src/lib/publicView/*`) is stored as sections under `publicViews/{slug}`: base
sections (`tournament`, `rounds`, `teams`, `adjudicators`, `venues`, `motions`, `breakCategories`,
`institutions`, `checkins`) and one `round-{roundId}` section per public round holding that round's
public debates and ballots. Each section is chunked into Firestore documents (≤700 KB each) and
cached in the Vercel Data Cache as its own entry, keyed by content hash, so publishing a round's
results rewrites and invalidates only that round's section and the sections it changed.

- `GET /api/public/tournaments/[slug]`: base sections, the latest public round's debates and
  ballots, `roundSections` (round id → hash) and `loadedRoundIds`.
- `GET /api/public/tournaments/[slug]?round={id}&h={hash}`: one round. With the current hash the
  response is cached by the CDN for a day (it is a content address); otherwise for 15 s.
- Clients keep rounds whose hash did not change when a new version is published.
- Roots published before this layout (no `format: 2`) are still served: their whole-tournament
  `debates` and `ballots` sections are split by round when read, until the next publish rewrites them.

Known limits: a tournament that was never published is still built live from its collections into
one cache entry (too large to cache for very large events, so publish before sharing links), and
publishing still rebuilds the projection by reading every public collection once.

## Scale benchmark

`src/features/tournament/application/scale.test.ts` runs 1000-team BP (550 adjudicators) and WSDC
(1100 adjudicators) tournaments through the real commands: draw, auto-allocation (panels of 2),
ballots, standings and the public view. It checks that each round is a valid draw (every team once,
no adjudicator twice, no draw-check errors), that public sections and the first public response
stay under the cache and response limits, and time budgets. By default it plays 2 rounds of each
(~20 s); `CRABBYTAB_SCALE=full` plays all 9 and `CRABBYTAB_SCALE=off` skips it.

Full run on a developer laptop (Vitest, Node 22):

| | BP, 1000 teams | WSDC, 1000 teams |
| --- | --- | --- |
| Draw per round | 0.07–3.1 s | 0.26–0.8 s |
| Auto-allocation per round | 0.7–6.5 s | 7–17.7 s |
| Standings | 17–41 ms | 39–97 ms |
| Public view after 9 rounds | 5.0 MB in 18 sections, largest 527 KB | 8.4 MB in 18 sections, largest 886 KB |
| First public response | 864 KB | 1.34 MB |
| Working copy | 7.3 MB | 12.9 MB |

Known limits found by the benchmark:
- Auto-allocation is the slowest step at this size. It runs in a Web Worker, so the page stays
  usable, but it has not been optimised.
- With the default two-team conflict avoidance (`one_up_one_down`), pairing ignores side limits, so
  late rounds of a long two-team tournament can pair two teams that have both reached the
  per-side limit; the draw then stops with an error naming them. `min_cost` conflict avoidance
  treats side limits as hard while pairing (the benchmark's WSDC run uses it).
