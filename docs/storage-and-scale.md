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
