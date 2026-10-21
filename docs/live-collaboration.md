# Live collaboration (sync model B, step 1)

Several tab-room devices can work on the same cloud tournament at once. Ballots, check-ins and
debates (the draw and its adjudicator allocation) are written to Firestore record by record as soon
as they change, and every administrator device receives the others' changes within seconds. Offline,
the changes are queued on the device and sent when it reconnects. Everything else still goes through
**Upload now** / **Download and compare** (see `storage-and-scale.md`).

This is the first step of the sync model adopted on 2026-10-18 (`tabbycat-parity-plan.md`,
"Decisions"): Firestore is the source of truth for the collections where concurrent tab-room work
happens, and the remaining collections move over in later steps.

## Who is live

A device is live when all of these hold:

- the tournament has a cloud copy (its settings carry a cloud `syncVersion`, i.e. it has been
  uploaded or opened from the cloud). **Local-only tournaments are unchanged**;
- the signed-in account is a tournament administrator (owner, admin, staff admin or global
  admin), verified by `/api/tournaments/{id}/access`. Offline, the role last verified on this
  device for the same account is used, so the tab room keeps working; Firestore rules still decide
  whether queued writes are accepted when they reach the cloud;
- it is an admin page (not `/public`, `/display` or a private URL), the tournament has finished
  loading, and live updates are not paused on this device (cloud status menu → **Pause live
  updates on this device**, stored per tournament and device).

Data-entry assistants are not live yet: they cannot read the raw collections (teams hold private
URLs and e-mails; panels and motions are redacted until released), so their copy still comes from
`/api/tournaments/{id}/assistant-data` and their changes still go through the server-validated
`data-entry-sync` route. Administrators see an assistant's ballots and check-ins live as soon as the
assistant syncs. Firestore rules already allow assistants the direct writes a later assistant live
mode will use (see [Rules](#firestore-rules)).

## The hybrid

| Collection | Path | Notes |
|---|---|---|
| `ballots` | **live** | listened to for the active round |
| `debates` (draw, allocation, results per side) | **live** | listened to for the active round; draw generation writes its debates live too |
| `teams`, `adjudicators` (check-ins, availability, details) | **live** | listened to as whole collections |
| tournament settings, `rounds`, `motions`, `venues`, `breakCategories`, `feedback`, `institutions`, `auditEvents` | upload / download | unchanged |

The split is by collection, so it is easy to reason about: every change to a live collection is
written live, whichever command made it (setup edits to a team, a regenerated draw, a confirmed
ballot), and nothing else is. Consequences worth knowing:

- A release (draw, results, …) changes a **round** (`drawStatus`, `resultsReleased`), which is on the
  upload path, so releases still upload and publish in one step (`ReleaseActionDialog`). Another
  device sees a new draw's debates live, but the round's status only after that upload (or a
  download/reload).
- Debates and ballots of rounds other than the active one are not listened to. Changes another
  device makes to them arrive with the next load or **Download and compare**. Standings use every
  round, so a correction to an earlier round shows on other devices after they reload. Switching
  the active round switches the listeners.
- Records deleted from a live collection are soft-deleted in Firestore (`deletedAt`, content kept),
  instead of being queued as tombstones for upload.
- The pending-changes indicator still counts what an upload would send. Live writes are not
  pending: each write updates the record's synced baseline. Records of live collections that were
  edited before live collaboration started (or while it was paused) stay pending and go up with the
  next upload, which keeps its stale-version check.

## Writes

`TournamentContext` routes every command save of a live collection through `saveLiveRecords`, which
calls `planLiveWrites` (`src/features/tournament/application/liveSync.ts`):

1. **State rules first.** Commands run their guards (`stateGuards.ts`: locked ballots, completed
   rounds, double-entry `same_person_check`, …) before they save, so a refused command produces no
   write. `liveSession.test.ts` covers this.
2. **Only what the command changed.** A command computes its result from the state it was given,
   which can be older than what the device holds if a listener delivered another device's change
   meanwhile. The plan compares the command's input with its output, and applies only the changed
   records and fields on top of the device's current copy, so other devices' changes are kept.
   A command that saves the same collection twice (submitting a ballot confirmed saves it, then
   its confirmation saves it again) passes its starting state both times; a record that is missing
   from that state but already synced here (created by the first save) is diffed against its
   synced copy, so the second save is written live too. Before, it stayed a local-only edit that
   the next listener event reported as a sync conflict. A confirmation also keeps the
   `confirmedTimestamp` the ballot was submitted with, so one confirmation has one timestamp.
3. **Field-level patches.** A synced record is written as a Firestore `set` with `mergeFields`
   naming exactly the changed field paths, so Firestore leaves every other field as it is. Map
   fields are written key by key: `roundAvailability` / `roundAvailabilityAt` per round, a debate's
   `teams` per side. A record the cloud has never stored is written whole at `syncVersion` 1.
   Each write sets `syncVersion` to the next version, so older clients' uploads still detect that
   the record changed, and public publishing still notices the change (`sourceToken`).
4. **One batch per command.** Writes queued in the same tick are merged per record and committed as
   one atomic `writeBatch` (`coalesceLiveWrites`). Confirming a ballot therefore marks it
   confirmed, discards the debate's other versions and records the debate result in one batch.
   Debates also get their cloud-only `participantIds` index, so private portals keep finding them.
5. **Offline.** Batches are handed to the Firestore SDK immediately. Its persistent cache
   (IndexedDB, `src/lib/firebase.ts`) applies them locally at once and keeps them, across reloads,
   until the cloud acknowledges them. Before an upload or publish, the device waits (up to 20 s) for
   the cloud to acknowledge its live writes, so the stale-version checks and public pages see them.
6. **Refused writes** (for example the account lost its admin role) are reported in the cloud status
   ("Live updates stopped"), and the records lose their baseline entry: they count as changes not
   uploaded and, once the cloud version arrives, are listed as sync conflicts. Nothing refused is
   silently dropped.

Why batches and not transactions: Firestore client transactions cannot run offline and cannot run
queries, so a transaction could not find a ballot another device created meanwhile anyway, and would
make confirmation impossible offline. Batches are atomic, offline-capable, and serialized by the
server; the one race they leave is detected (below).

## Listeners

`liveListenerScopes(activeRoundId)` decides what to listen to: `teams` and `adjudicators` (whole
collections), and `debates` and `ballots` where `roundId == activeRoundId`. `createLiveSession`
(`application/liveSession.ts`) keeps exactly those listeners open (`onSnapshot` with
`includeMetadataChanges`), re-scoping when the active round changes; the Firestore adapter is
`infrastructure/liveRepository.ts`. Each event goes through `applyLiveSnapshot`, which uses the
same rule as a download (`classifyAgainstBaseline` in `cloudSync.ts`):

- a record unchanged on this device since it was last synced takes the cloud version (the cloud
  has already merged it field by field with this device's queued writes);
- a record edited here and not written live keeps the local edit for upload, and is listed as a
  sync conflict if the cloud changed it too (the existing **Resolve sync conflicts** dialog);
- records soft-deleted in the cloud are dropped; records restored from a backup and records with a
  pending local deletion are left alone.

Bulk operations that replace whole collections (upload results, download, backup restore, conflict
choices) stop the session first and restart it afterwards; the restarted listeners' first events
re-apply every cloud record on top of the new state.

## Conflict semantics per collection

| Collection | Unit | Rule |
|---|---|---|
| `ballots` | one document per ballot version | Append-only versions: a new or corrected ballot is a new document; a confirmed or discarded version is never rewritten (guarded). Confirmation and discard flags are last write wins per field. |
| `ballots` → confirmation | per debate | Confirming a version unconfirms the previously confirmed one (drafts are kept); a double-entry check also discards the entry it replaces. If two devices confirm different versions while one could not yet see the other's ballot (offline, or within a listener's delay), two versions can end up confirmed. `findConfirmationConflicts` detects this; the cloud status shows "N double confirmations" until someone discards the version that should not count. It is never resolved automatically. |
| `teams`, `adjudicators` | per field; availability per round | Last write wins per round of `roundAvailability` / `roundAvailabilityAt`, and per field otherwise (`checkedIn`, name, …). Checking a team in for round 3 never undoes another device's round 2 change. |
| `debates` | per field; result per side | The adjudicator panel (`adjudicators`) is one unit, last write wins, so two allocators never produce a mixed panel. Venue, motion and result status are per field; points and speaker totals per side. |

The state rules run against the device's copy, which offline may be behind the cloud (for example a
round marked complete on another device). Writes that reach the cloud are only checked by the
Firestore rules, which give administrators full access as before.

## Firestore rules

`firestore.rules` keeps administrators' access to every tournament collection unchanged and adds,
for data-entry assistants (a `staff/{uid}` document with role `dataEntry`):

- `ballots`: **create** only, and only a ballot that is the assistant's own (`submitterId` is the
  signed-in user, `submitterType` `"tabroom"`), unconfirmed and not discarded, with whitelisted
  fields (`assistantLiveBallotFields`), version 1–1000, map-typed scores, `syncVersion` 1, for an
  existing, non-deleted debate of the same round;
- `teams`, `adjudicators`: **update** only, changing only check-in fields
  (`assistantLiveCheckInFields`: `checkedIn`, `checkedInAt`, `roundAvailability`,
  `roundAvailabilityAt`) and bumping `syncVersion` by exactly one, on records that are not deleted;
- no reads (their copy is the redacted assistant-data projection).

The field lists mirror `ASSISTANT_LIVE_BALLOT_FIELDS` / `ASSISTANT_LIVE_CHECK_IN_FIELDS` in
`src/lib/dataEntrySync.ts`; `src/lib/liveRules.test.ts` keeps them in step. Score ranges are not
checked by the rules (the data-entry route and the ballot form do that); an unconfirmed ballot never
counts until an administrator confirms it.

The repository has no Firestore emulator setup (it needs Java and `firebase-tools`), so the rules
are not executed in CI. Before deploying rule changes, check them in the Firebase console's Rules
Playground (or the emulator) with:

1. an administrator: read and write `tournaments/{id}/teams/{team}` → allowed;
2. an assistant: read any team, ballot or debate → denied;
3. an assistant: create `ballots/{b}` with `confirmed: false`, own `submitterId`, an existing debate
   of the same round → allowed; with `confirmed: true`, another `submitterId`, a debate of another
   round, a deleted debate, or an extra field such as `confirmedBy` → denied;
4. an assistant: update a team's `roundAvailability.r1` with `syncVersion` +1 → allowed; changing
   `name`, `breakStatus` or `privateUrlKey`, or not bumping `syncVersion` → denied;
5. a signed-out user: any of the above → denied.

## Cost (Spark tier)

Listeners are opened only by administrator devices (never by public pages, which stay on cached
snapshots). A listener's first event reads its documents (with the persistent cache, a listener
restarted within about 30 minutes of the last one resumes and is charged only for changes); after
that each change costs one read per listening device. For a 100-team BP tournament with ~150
adjudicators, opening a device costs about 100 + 150 + 25 debates + ~50 ballots ≈ 325 reads on top
of the existing full load, and each confirmed ballot about 3 reads per other admin device (ballot,
discarded versions, debate). Soft-deleted debates of a regenerated draw stay in the round's
listener, so regenerate sparingly on very large events. This keeps four admin devices well inside
the 50k reads/day budget estimated in the parity plan.

## Migration

Nothing needs migrating: the records keep their shape and `syncVersion`. The first live session on
a device hydrates the live collections from Firestore (the load still reads every collection once,
then the listeners take over). Changes made on the device before it went live stay pending until
the next upload. Older app versions that only upload/download keep working against the same data:
live writes bump `syncVersion`, so their stale uploads are archived as conflicts as before.

## Known limitations

- Assistants, private portals and public pages are not live (by design for the last two).
- Earlier rounds' debates and ballots are not listened to.
- Settings, rounds, motions, rooms, breaks, feedback and the audit log are still upload/download.
- State rules are checked on the device, not on the server, for administrators' live writes.
- A double confirmation needs a person to resolve it.
- If the browser cannot keep the Firestore cache (for example some private-browsing modes), the
  SDK falls back to memory: queued offline writes are then lost when the tab closes. The page warns
  before leaving while live writes are queued.
