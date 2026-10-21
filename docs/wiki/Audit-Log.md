# Audit log

CrabbyTab records significant tab-room actions as **audit events**: time, who did it, category, action, a summary, and details captured at the time.

## What is recorded

Categories: `tournament`, `draw`, `allocation`, `ballot`, `standings`, `break`, `feedback`, `venue`. Examples:

| Area | Actions |
| --- | --- |
| Draws | `draw.generated` (with the random seed and requested options), `draw.status_changed` (confirm, release), `draw.debates_updated`, `draw.deleted` |
| Allocation | `adjudicators.allocated` (with remaining clashes), manual assignments, preformed panels; `venue.assigned` (room allocation) |
| Results | `ballot.submitted`, `ballot.confirmed`, `ballot.discarded`, `ballot.received`, `ballots.resaved` (after a scoring change) |
| Feedback | `feedback.submitted`, `feedback.reviewed`, `feedback.deleted` |
| Breaks | `break.generated`, `break.cleared`, `break.categories_updated`, `elimination.round_advanced` |
| Setup | rounds, motions, venues, teams, adjudicators, institutions created/updated/deleted; `entities.batch_saved` (CSV import); `tournament.settings_updated`; `private_urls.regenerated` |
| Other | `rules.overridden` (with the reason, before the overridden action runs), `backup.replaced`, `rehearsal.results_simulated` / `rehearsal.feedback_simulated` (with the seed) |

Round releases (results, motions) appear as `round.updated` with the changed fields. Writes through the API are recorded too, attributed to the API token (`api-token:<id>`) or the participant key.

Not recorded: email sends, data-entry staff confirmations (stored on the ballot instead) and private-portal submissions outside the API. No IP addresses are stored.

## Viewing

**Admin → Audit log** (`/{slug}/audit`, tournament administrators) lists events newest first, with actor, category, action, round/debate ids and an **Event details** disclosure.

Events are stored with the tournament and uploaded with it (see [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync)). In the cloud they are **append-only**: the Firestore rules forbid editing or deleting them, and a user event must name its real author. Restoring a backup merges the log rather than replacing it.

## Publishing a verifiable log

1. **Upload** the tournament first: the release reads the cloud copy.
2. On the Audit log page, **Release audit log** (later: **Update public snapshot**). The card shows when it was last released and how many events; events newer than the snapshot are marked.
3. **View public log** opens `/{slug}/audit/public`.

What is published: sequence number, timestamp, category, action, summary and hashes. Never actors or details.

The events are **hash-chained** at release time: ordered by time, each hash is SHA-256 of `crabbytab-audit-v1`, the previous hash and the event's public fields, starting from 64 zeros. The public page downloads the snapshot and **verifies the chain in the visitor's browser**, so anyone can check that the published history is consistent. Up to 5,000 events per release.

## Limitations

- The chain proves the released snapshot is internally consistent. It cannot prove that nothing was left out before release, and each release rebuilds the chain from the current cloud log.
- Anyone with Firebase console or service-account access can change stored events outside the rules.
- The tab room keeps the whole log in the browser (it is not paged).

More: [tournament-rules-enforcement.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/tournament-rules-enforcement.md), [api.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/api.md).
