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
