# Backups, restore and cloud sync

CrabbyTab is local-first: each device keeps a full working copy of the tournament, and the cloud copy in Firestore is
shared between devices, private URLs and the public site. Some records sync live between administrator devices; the
rest go up with **Upload now**. This page explains what is where, how to keep devices in step, how conflicts are
handled, and how to back up and restore.

Developer detail: [storage-and-scale.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/storage-and-scale.md),
[live-collaboration.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/live-collaboration.md),
[data-import-export.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/data-import-export.md).

## The working copy on this device

- Each tournament's working copy is stored in the browser's **IndexedDB** (keys `crabbytab_t_{slug}_…`). Older
  copies in localStorage are moved there automatically on first use. If IndexedDB is unavailable (some
  private-browsing modes), localStorage is used with its ~5 MB limit.
- Draws, allocations, standings and breaks are computed in the browser from this copy, so the tab room keeps working
  offline.
- If the browser cannot save (for example the disk quota is full), the app shows *Could not save … locally* and
  retries with the next change.
- The working copy belongs to one browser profile on one device. Clearing site data deletes it. A second tab on the
  same device sees the other tab's changes after a reload.

A tournament that has never been uploaded is **local only**: nothing leaves the device, and its public pages work
only on that device.

## What syncs live and what needs an upload

For a tournament with a cloud copy, an administrator's device is **live** (status pill **Live**) while it is online
and live updates are not paused:

| Data | How it reaches the cloud and other admin devices |
|---|---|
| Ballots, debates (draw, allocation, per-side results), teams and adjudicators (check-ins, availability, details) | **Live**, record by record, within seconds. Offline changes are queued and sent on reconnect. |
| Tournament settings, rounds (including releases), motions, rooms, break categories, feedback, institutions, audit log | **Upload now** (other devices get them with **Download and compare** or a reload) |

Things to know:

- Only debates and ballots of the **active round** are listened to. A correction to an earlier round reaches other
  devices when they reload or download.
- A release changes the **round**, so releases upload and publish in one step (see below). Another device sees a new
  draw's debates live, but the round's status only after the upload reaches it.
- Data-entry assistants are not live: they use their own **Upload** (see below).
- To work without live writes on one device, open the cloud status menu → **Pause live updates on this device**
  (**Resume live updates** turns them back on). While paused, every change waits for **Upload now**.
- The page warns before you close it while changes are not uploaded or live writes are still queued.

Opening a cloud tournament merges the cloud copy into this device's copy using the same rules as a download.

## The cloud status menu

The status pill in the top bar opens the **Cloud sync** menu. The pill shows one of: **Live**, **Connecting…**,
**Uploaded**, **N changes not uploaded**, **Offline**, **Offline — N queued**, **Local copy**, **Syncing…**,
**N sync conflicts**, **N upload conflicts**, **Upload incomplete**, **N double confirmations**, **Live updates
stopped** or **Sync failed**. The menu explains the state, lists pending changes per collection and shows the last
result. Its actions:

| Action | What it does |
|---|---|
| **Upload now** | Sends this device's changes to the cloud and publishes public pages. |
| **Download and compare** | Merges the cloud copy into this device. |
| **Resolve sync conflicts (N)…** | Opens the conflicts dialog (only when there are conflicts). |
| **Pause / Resume live updates** | Per device and tournament (administrators). |
| **Export archived cloud versions** | Downloads the recovery file (shown after conflicts). |

Administrators also have **Upload** and **Download** buttons next to the pill. Signed-out users see **Sign in to
upload**. Both ask for confirmation first.

### Upload now

1. Queued live writes are flushed first (up to 20 seconds), so the checks below see them.
2. Only records changed since this device last synced are sent, in batches.
3. For each record:

| Situation | Result |
|---|---|
| New in the cloud | Written at version 1. |
| Same content | Nothing written. |
| Cloud unchanged since this device last had it | Your version is written at the next version; the replaced cloud version is archived. |
| Cloud changed by someone else since then | **The cloud version is kept.** Yours is archived as a conflict. |
| Deleted on this device | Soft-deleted in the cloud (`deletedAt`); the previous cloud version is archived as recoverable. |
| Already deleted in the cloud | Not resurrected; yours is archived. |
| Audit events | Append-only: only events the cloud does not have are added. |

4. If nothing conflicted, the public pages are republished. If any record conflicted, public pages are **not**
   updated (the message says so): download, choose versions, and upload again.
5. Due automatic emails (draw and results notifications) are sent; see [Email and notifications](Email-and-Notifications).

Other rules: an upload never changes the owner or administrators of a cloud tournament, and is refused if the cloud
tournament belongs to someone else and you are not one of its administrators. The first upload reserves the
tournament's URL; a URL already taken is refused.

If an upload stops part-way, everything committed so far is kept, the pill shows **Upload incomplete**, and public
pages are not updated. Upload again to finish; every write is safe to repeat. This also completes a regenerated draw
whose cloud write was interrupted.

### Download and compare

Merges the cloud copy into this device, record by record:

- records not changed here since the last sync take the cloud version;
- records changed here are kept, and become **sync conflicts** if the cloud changed them too;
- records only in the cloud are added; records deleted in the cloud, or deleted here and not yet uploaded, are
  dropped; no cloud records are deleted.

### Resolving conflicts

**Resolve sync conflicts (N)…** (cloud status menu or account menu) opens the **Sync conflicts** dialog. It lists each
record changed both here and in the cloud, with a table of the fields that differ (**This device** / **Cloud**).
For each record choose **Keep mine** or **Use cloud**, or use **Keep all of mine** / **Use all cloud versions** (both
ask for confirmation). This device's version stays in use until you choose. Versions you keep go up with the next
upload, which archives the cloud version it replaces.

**Double confirmations**: if two devices confirm different ballots for the same debate before seeing each other's,
the pill shows **N double confirmations**. Nothing is resolved automatically; open the debate's ballots and discard
the version that should not count.

**Live updates stopped** means the cloud refused a live write (for example the account lost its admin role). Those
records count as not uploaded and show as conflicts once the cloud version arrives; nothing is silently dropped.

### The recovery file

Every replaced or conflicting cloud version is archived in the tournament's `syncConflicts` collection
(append-only). Account menu → **Export sync recovery** (administrators, online) downloads all of them as
`{slug}-sync-recovery.json` (`crabbytab-sync-recovery-v1`). There is no screen for browsing archived versions;
restore anything you need by re-entering it or editing a backup.

## What changes the cloud without your upload

- Live writes from other administrator devices.
- Ballots, feedback and self check-ins from [private URLs](Private-URLs-and-Portals) and public forms.
- Uploads by data-entry assistants.
- [API](API-and-Tokens) writes.

Each bumps the record's `syncVersion`, so a stale upload from another device becomes a conflict instead of
overwriting it.

**Data-entry assistants** have a single **Upload** button that sends only the participant, ballot, feedback and
result changes they are allowed to make, through a server-checked route. Settings, draws and allocations are never
uploaded from their device. See [Staff and roles](Staff-and-Roles).

## Publishing public pages

Public pages and private URLs read a **published snapshot** of the cloud copy, not live data
(see [Public pages and releases](Public-Pages-and-Releases)).

- **Upload now** publishes automatically when it had no conflicts.
- **Releases** (draw, results, motions, tabs, breaks, participant lists) upload and publish as one action. They are
  refused while offline or while records conflict with the cloud.
- **Saved on this device only.** After saving settings that public pages or private URLs read (tournament settings,
  public forms, staff access), a notice says the change is on this device only and offers **Upload and publish**.
  After it succeeds: "Uploaded and published. Public pages and private URLs now use this setting."
- Account menu → **Republish public pages** rebuilds the snapshot from the **cloud copy**. If this device has changes
  not uploaded, it asks first (**Upload and publish**, or **Publish cloud copy anyway**). After an incomplete upload
  or conflicts it is blocked until you **Upload again** or **Download and compare**.

## Backups

Account menu (administrators):

- **Export tournament backup** → `{slug}-backup.json` (`crabbytab-tournament-backup-v1`): every collection, full
  fidelity. This is the recovery format.
- **Export DebateXML archive** → `{slug}-archive.xml`: the Tabbycat-compatible exchange format. It never contains
  emails, private URLs, passcodes or feedback comments, and may omit fields DebateXML cannot represent.

Export a backup before each round and before risky operations (regenerating a draw with results, deleting rounds,
restoring, changing format).

### Restore tournament backup…

1. Account menu → **Restore tournament backup…** and choose the file (valid JSON, at most 50 MB).
2. The file is checked before anything changes: format version, the tournament record, required fields, duplicate
   ids, records from another tournament, and references (missing rounds, teams, debates, adjudicators or break
   categories are errors; missing venues, motions and institutions are warnings).
3. You see, per collection, how many records are only in the backup, only on this device, different or the same.
4. Choose:
   - **Merge**: add the backup's missing records; records on this device win.
   - **Replace**: make the tournament match the backup, after an explicit confirmation. A
     `{slug}-pre-restore-backup.json` of the current data downloads first. The tournament's id, URL, owner and
     administrators are kept, the audit log is merged (never replaced), records not in the backup are queued as cloud
     deletions, and a `backup.replaced` audit event is recorded.

A restore changes this device only. **Upload now** afterwards to update the cloud copy.

## Recommended routine

1. Keep live updates on for every administrator device; check the pill says **Live**.
2. After setup changes, use **Upload and publish** (or **Upload now**) so other devices and the public site get them.
3. Other devices **Download and compare** before editing settings, rounds, motions, rooms, breaks or feedback.
4. Export a tournament backup at the end of each round.
5. If an upload reports conflicts, export the sync recovery file before doing anything else, then resolve them.

## Details

- Firestore is the source of truth for the live collections; the remaining collections move to live sync in later
  steps of the sync model adopted in the [parity plan](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/tabbycat-parity-plan.md).
- Live writes are field-level patches committed in one atomic batch per command, so two devices changing different
  fields (or different rounds' availability) of the same record do not overwrite each other. An adjudicator panel is
  one unit: last write wins.
- Tab-room rules (locked ballots, completed rounds, double entry) are checked on the device before a live write;
  the server checks only the Firestore security rules.
- If the browser cannot keep the Firestore offline cache (some private-browsing modes), queued offline writes are
  lost when the tab closes.
- Large events: the first upload of a 1000-team tournament is about 10,000 writes, within the free plan's
  20,000 a day, but several full uploads a day are not; plan on the Blaze plan for events of that size.
