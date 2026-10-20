# Staff access, assistant confirmations and individual ballots

Tabbycat's `assistant_access` setting, its permission groups, assistants confirming other people's
ballots, and per-adjudicator ballots through private URLs (`individual_ballots`, "merge latest"),
mapped onto CrabbyTab. Code: `src/lib/staffPermissions.ts`, `src/lib/staffAccessServer.ts`,
`src/lib/assistantBallotConfirmation.ts`, `src/lib/ballots/individualBallots.ts`,
`src/lib/privateIndividualBallots.ts`.

## Roles

| Role | Who | Can do |
|---|---|---|
| Administrator | owner, listed admins, staff admins, global admins | everything (Tabbycat's Tabulation Director) |
| Data-entry staff | `staff/{uid}.role == "dataEntry"` | what their permission groups allow, capped by the tournament's access level |

## Permissions and groups

| Permission | What it allows | Enforced in |
|---|---|---|
| `results.enter` | enter ballots (always unconfirmed) | data-entry-sync, firestore.rules (live ballot create) |
| `results.confirm_others` | confirm, or blind-check, a ballot someone else entered | assistant-ballots route |
| `ballots.intake` | record paper ballots arriving | data-entry-sync |
| `feedback.enter` | enter feedback | data-entry-sync |
| `checkins.edit` | change check-in and availability fields | data-entry-sync, firestore.rules (live check-in update) |
| `participants.edit` | add and edit teams, adjudicators, institutions | data-entry-sync |
| `draw.display` | see draft draws (draw display before release) | assistant-data |
| `motions.display` | see a round's motions before they are released | assistant-data |

Groups (set per staff member on **Tournament access**; more than one may be ticked):

| Group | Permissions | Tabbycat |
|---|---|---|
| Tabulation assistant (default) | all of the above | Tabulation Assistant |
| Ballot desk | `results.enter`, `results.confirm_others`, `ballots.intake` | — |
| Check-in desk | `checkins.edit` | — |
| Feedback desk | `feedback.enter` | — |

Staff documents written before groups existed have no groups and keep the full assistant set.
Tabbycat's *Equity* and *Adjudication Core* groups are not offered: they need conflicts, feedback
scores and allocation, which are administrator-only data in CrabbyTab (make those people
administrators).

## Access level (`assistantAccess`)

| Level | Effect |
|---|---|
| All areas (default) | no cap |
| Results entry and draw display | removes `motions.display` |
| Results entry only | removes `motions.display` and `draw.display` |
| No access | every data-entry account is refused by every assistant route and by firestore.rules |

The level is a tournament preference, so it reaches the server with the next upload of the
tournament. Without `draw.display`, staff receive debates only for rounds whose draw is confirmed
or released (ballot entry needs nothing else).

## Server enforcement

Every assistant route (`assistant-data`, `data-entry-sync`, `assistant-ballots`) resolves
permissions with `authorizeDataEntryStaff` and re-reads the staff document inside each write
transaction (`currentDataEntryPermissions`), so revoking or narrowing a group applies to the next
record written. A synced record outside the permissions is not written and is reported back as
rejected, so the device keeps it as a local edit. firestore.rules check `assistantMay(...)` on the
two direct live writes assistants make: the staff document's `permissions` list (derived from the
groups by the staff route) and the tournament's `assistantAccess`. The app hides links staff
cannot use, but hiding is never the barrier.

## Confirming others' ballots

`POST /api/tournaments/{id}/assistant-ballots`:

- `{ action: "confirm", ballotId, version }`: review check. Confirms the pending version.
- `{ action: "check", ballotId, version, entry }`: blind check. Confirms the pending version only
  when the assistant's re-entry matches it field by field (`diffBallots`); otherwise 409 with the
  differences, and nothing changes.

The server runs the tab room's confirmation command against the debate's records in one
transaction: the other versions are discarded, the debate's result is recorded, and every written
record's `syncVersion` moves on. Extra rules for staff:

- the same-person check always applies, double entry or not: nobody confirms their own entry;
- the version must be the one the assistant looked at, and no newer version may be waiting;
- nothing that would need a tab-room override: unpublished draws, cancelled or completed rounds,
  advanced eliminations, and rounds whose results are released are refused.

Staff confirmations are recorded on the ballot (`confirmedBy`, `confirmedById`,
`confirmedTimestamp`; discarded versions get `discardedBy`). They are not written to the
hash-chained audit log, which is appended by administrator devices.

## Private-URL ballots

`privateBallotConfirmation`:

- **The chair confirms** (default; CrabbyTab's behaviour before this setting): a chair's ballot
  counts at once and supersedes earlier ballots of the debate (unless the tab room confirmed one
  or the round is locked).
- **The tab room confirms** (Tabbycat's default): every private-URL ballot is stored unconfirmed
  and waits for the tab room or data-entry staff with `results.confirm_others`.

### Individual ballots (`individualBallots`)

For two-team tournaments in voting rounds. Each voting adjudicator (chair and panellists, never
trainees) submits their own scoresheet through their private URL; it is stored unconfirmed with
`singleAdjudicator: true` and replaces only that adjudicator's earlier sheets.

The latest sheet of each voting adjudicator is merged into one voting ballot and aggregated like
any voting ballot (`aggregateVotingSheets`). As in Tabbycat's `populate_from_merge`, the sheets
must agree on everything that is not a score: who gave each speech (and ghost speeches), the
motion, vetoes and, with sides chosen on the ballot, which team took which side. A sheet with
tied totals cannot vote. Disagreements are reported, never resolved.

- With **the chair confirms**, the merge happens automatically when the last sheet arrives and
  agrees: a merged ballot (`submitterName` "Merged individual ballots", `mergedFromIds`) is written
  confirmed and earlier merges are discarded. A later sheet re-merges.
- With **the tab room confirms**, sheets wait. On the ballot page, **Fill from private URLs**
  copies each adjudicator's latest sheet into the voting ballot (Tabbycat's "merge latest") and
  warns about disagreements and missing adjudicators; the tab room then confirms as usual.

Ballot receipts go to the adjudicator for their own sheet only.

## Limitations

- Data-entry staff cannot merge individual ballots themselves; they confirm the merged or
  tab-entered ballot.
- Equity and Adjudication Core groups are not available (see above).
- Staff confirmations are not in the audit log (see above).
