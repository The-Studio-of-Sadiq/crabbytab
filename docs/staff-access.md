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
| `checkins.edit` | change check-in and availability fields of teams and adjudicators, and check rooms in (rooms: `checkedIn`, `checkedInAt`, `checkInHistory` only; staff never create rooms) | data-entry-sync, firestore.rules (live check-in update) |
| `participants.edit` | add and edit teams, adjudicators, institutions | data-entry-sync |
| `draw.display` | see draft draws (draw display before release) and project confirmed draws on `/display` | assistant-data |
| `motions.display` | see a round's motions before they are released and reveal them on `/display` | assistant-data |
| `conflicts.view` | see adjudicator conflicts and team–institution conflicts | assistant-data (`conflicts`, `institutionConflictIds` are sent only with it) |
| `conflicts.edit` | change those conflicts (only together with `conflicts.view`) | data-entry-sync |
| `feedback.view` | see feedback scores, comments and answers, and adjudicators' base/test scores, score history, breaking and adjudication-core flags | assistant-data |
| `adjudicators.scores_edit` | change base and test scores (one by one or in bulk), breaking status and the tester flag (recorded in the score history with the staff member's name); the app offers it only together with `feedback.view`, since staff cannot change scores they cannot see | data-entry-sync |
| `allocation.edit` | change adjudicator panels of draws they can see | data-entry-sync (one transaction per round), assistant-data (unrevealed panels) |
| `standings.view` | see standings, the break and analytics, and the results of silent and unreleased rounds (Tabbycat VIEW_TEAMSTANDINGS, VIEW_SPEAKERSSTANDINGS, VIEW_MOTIONSTAB, VIEW_BREAK) | assistant-data (ballots and debate points) |

Groups (set per staff member on **Tournament access**; more than one may be ticked):

| Group | Permissions | Tabbycat |
|---|---|---|
| Tabulation assistant (default) | the first eight permissions above (pinned: new permissions never widen it) | Tabulation Assistant |
| Ballot desk | `results.enter`, `results.confirm_others`, `ballots.intake` | — |
| Check-in desk | `checkins.edit` | — |
| Feedback desk | `feedback.enter` | — |
| Equity | `conflicts.view`, `conflicts.edit` | Equity |
| Adjudication core | `feedback.view`, `adjudicators.scores_edit`, `allocation.edit`, `conflicts.view`, `draw.display`, `motions.display`, `standings.view` | Adjudication Core |

Staff documents written before groups existed have no groups and keep the tabulation assistant
set. Equity leaves out Tabbycat's room-constraint and participant-contact permissions (room
preferences, phone numbers and emails stay administrator-only). Adjudication Core leaves out
editing feedback questions, motions and releases, and the standings pages' admin-only views; make
people administrators for those.

### Custom groups

Organisers define their own groups (Tabbycat `users.Group`) under **Custom permission groups** on
the Tournament access page: a name and any set of the permissions above. They are stored
server-only (`tournaments/{id}/serverOnly/staffPermissionGroups`) and only
`GET/PUT /api/tournaments/{id}/staff/groups` (administrators) reads or writes them; the PUT
validates them (known permissions only, unique names, `conflicts.edit` only with
`conflicts.view`) and, in the same transaction, recomputes the stored `permissions` of every
data-entry staff member, so firestore.rules and the assistant routes agree at once. A staff member
in a removed group keeps the group id and gets nothing from it (never the default group). The
assistant routes read the custom groups only for staff who use one.

## Access level (`assistantAccess`)

| Level | Effect |
|---|---|
| All areas (default) | no cap |
| Results entry and draw display | removes `motions.display` |
| Results entry only | removes `motions.display`, `draw.display` and `allocation.edit` |
| No access | every data-entry account is refused by every assistant route and by firestore.rules |

The level is a tournament preference, so it reaches the server with the next upload of the
tournament. Without `draw.display`, staff receive debates only for rounds whose draw is confirmed
or released (ballot entry needs nothing else).

### Results staff may see

Ballots and the points on debates reach a staff member's device only for rounds whose results
they may see (`assistantMaySeeRoundResults` in `src/lib/dataEntrySync.ts`): every round with
`standings.view`; rounds whose results are released; for ballot staff (`results.enter`,
`results.confirm_others`, `ballots.intake`) also rounds still being entered and completed rounds
that are not silent. Other debates arrive without `points`, `speakerScoreTotal` and `byeResult`.
Staff groups saved before `standings.view` existed (including the default tabulation assistant
set) do not have it, so their standings, break and analytics pages close, as in Tabbycat.

### Pages

The tournament shell checks each staff page against the permission the server enforces for its
data (`routeRequirement` in `src/lib/tournamentRoutes.ts`), the same permissions the sidebar uses:
the allocation editor needs `allocation.edit` (preformed panels stay administrator-only), the
standings, break and analytics pages `standings.view`, breaking adjudicators and the adjudicator
record `feedback.view` or `adjudicators.scores_edit`, check-ins `checkins.edit`, conflicts
`conflicts.view`; the draw, configuration, staff, private URLs, email, audit log, exports,
rehearsal, API, registration, schedule and the venue, motion, speaker-category and room
preference setup pages are administrator-only. Within the break page, changing categories,
generating the break and overrides stay administrator-only. Routes are matched on path segments
after the slug, so a slug such as `public-speaking-open` never turns staff pages into the public
view; `public`, `display`, `private`, `invite`, `account` and every other top-level route are
reserved slugs (`RESERVED_SLUGS`, kept in step with `src/app` by a test).

### Projector

`/display` loads the public projection for everyone. Administrators also project from this
device's working copy, and staff with `draw.display` or `motions.display` from their assistant
data (`projectorAccess` in `src/lib/display.ts`): confirmed (locked) draws before release, never
drafts, and the round's motions before release. **Reload staff copy** refreshes it. On a device
without a working copy (a fresh projector laptop) an administrator sees the public view; open the
tournament there once first.

## Server enforcement

Every assistant route (`assistant-data`, `data-entry-sync`, `assistant-ballots`) resolves
permissions with `authorizeDataEntryStaff` and re-reads the staff document inside each write
transaction (`currentDataEntryPermissions`), so revoking or narrowing a group applies to the next
record written. A synced record outside the permissions is not written and is reported back as
rejected, so the device keeps it as a local edit. firestore.rules check `assistantMay(...)` on the
two direct live writes assistants make: the staff document's `permissions` list (derived from the
groups by the staff route) and the tournament's `assistantAccess`. The app hides links staff
cannot use, but hiding is never the barrier.

### Conflicts, scores and allocations from staff devices

Every assistant device sends its whole copy of teams, adjudicators and debates on sync. Fields a
staff member cannot read reach their device as placeholders (no conflicts, no scores), so the
server ignores them unless the staff member can read them (`DATA_ENTRY_GUARDED_FIELDS` in
`src/lib/dataEntrySync.ts`), validates them, and accepts a change only from a copy based on the
current cloud version (`syncVersion`); a change made on an older copy is refused and kept on the
device. Allocations (`src/lib/assistantAllocation.ts`) are checked per round on the final state:
known, live adjudicators only, nobody twice in a panel or in two rooms of the round, no change to
closed rounds or to debates with a confirmed result; if one change of a round is refused, none is
written. Panel names and the debates' participant index are rebuilt by the server.

## Confirming others' ballots

`POST /api/tournaments/{id}/assistant-ballots`:

- `{ action: "confirm", ballotId, version }`: review check. Confirms the pending version.
- `{ action: "check", ballotId, version, entry }`: blind check. Confirms the pending version only
  when the assistant's re-entry matches it field by field (`diffBallots`); otherwise 409 with the
  differences, and nothing changes.

The server runs the tab room's confirmation command against the debate's records in one
transaction: the previously confirmed version is unconfirmed (and a blind check's checked entry
discarded; other drafts are kept), the debate's result is recorded, and every written
record's `syncVersion` moves on. Extra rules for staff:

- the same-person check always applies, double entry or not: nobody confirms their own entry;
- the version must be the one the assistant looked at, and no newer version may be waiting;
- nothing that would need a tab-room override: unpublished draws, cancelled or completed rounds,
  advanced eliminations, and rounds whose results are released are refused.

Staff confirmations are recorded on the ballot (`confirmedBy`, `confirmedById`,
`confirmedTimestamp`; discarded versions get `discardedBy`). They are not written to the
hash-chained audit log, which is appended by administrator devices.

## Private-URL ballots

`privateUrlBallots` (Tabbycat `participant_ballots`): **Ballot submissions from adjudicators
through private URLs**. On by default, CrabbyTab's behaviour before this setting. Turned off
(Tabbycat "Disabled (tab staff only)"), the private portal no longer offers the ballot form and
tells adjudicators to give their ballot to the tab room. The private sync route
(`/api/private/sync`) refuses ballot submissions with 403, so an older or offline client cannot
send one either. Feedback and check-ins are not affected. Tabbycat's "public" mode (a form
without a private URL) is a separate setting.

When `ballotIntroExplanation` is set, the private-URL ballot form shows it above the scores, as the
tab-room ballot page and printed ballots do.

`privateBallotConfirmation`:

- **The chair confirms** (Tabbycat's `disable_ballot_confirms` on; CrabbyTab's behaviour before
  this setting, and still what a tournament without the field gets): a chair's ballot counts at
  once and supersedes earlier ballots of the debate (unless the tab room confirmed one or the
  round is locked).
- **The tab room confirms** (Tabbycat's default, and stored on every tournament created from now
  on): every private-URL ballot is stored unconfirmed and waits for the tab room or data-entry
  staff with `results.confirm_others`.

A ballot the tab room confirms records who confirmed it (`confirmedBy`, the signed-in user, or
"Tab room"; `confirmedById`). That is what protects a tab-room-confirmed judge ballot from being
superseded by a later private-URL ballot from the chair (`isTabRoomConfirmed`); before this,
confirming a stored ballot recorded no confirmer.

**Voting rounds without individual ballots.** Tabbycat gives the chair a per-adjudicator form, so
a voting result always has every voting adjudicator's sheet. A private URL records only the
submitter's own sheet, so (`votingRoundPrivateBallot`): when the submitter is the debate's only
voting adjudicator, their sheet becomes a proper voting ballot (with its sheet and votes, and a
declared 2:1 split when self-split ballots are on); otherwise the ballot is stored **unconfirmed**
whatever this setting says, and the tab room enters the panel's sheets ("Fill from private URLs"
takes this one). Before this, the chair's sheet became the confirmed result with no sheets or
votes.

### Individual ballots (`individualBallots`)

For two-team tournaments in voting rounds. Each voting adjudicator (chair and panellists, never
trainees) submits their own scoresheet through their private URL; it is stored unconfirmed with
`singleAdjudicator: true` and replaces only that adjudicator's earlier sheets.

The latest sheet of each voting adjudicator is merged into one voting ballot and aggregated like
any voting ballot (`aggregateVotingSheets`). As in Tabbycat's `populate_from_merge`, the sheets
must agree on everything that is not a score: who gave each speech (and ghost speeches), the
motion, vetoes and, with sides chosen on the ballot, which team took which side. A sheet with
tied totals cannot vote. Disagreements are reported, never resolved: as in Tabbycat, a speaker,
motion or veto the sheets disagree on is **cleared** in the merge (and in *Fill from private
URLs*) and everything else is kept, so the tab room only chooses what is missing. A merge with
disagreements is never confirmed automatically; different teams on a side, or a sheet without a
winner, cannot be merged at all.

- With **the chair confirms**, the merge happens automatically when the last sheet arrives and
  agrees: a merged ballot (`submitterName` "Merged individual ballots", `mergedFromIds`) is written
  confirmed and earlier merges are discarded. A later sheet re-merges.
- With **the tab room confirms**, sheets wait. On the ballot page, **Fill from private URLs**
  copies each adjudicator's latest sheet into the voting ballot (Tabbycat's "merge latest") and
  warns about disagreements and missing adjudicators; the tab room then confirms as usual.

Ballot receipts go to the adjudicator for their own sheet only.

`privateUrlFeedback` (Staff page, "Feedback submissions through private URLs"; Tabbycat
`participant_feedback`): off, private URLs refuse feedback (`checkParticipantFeedback`, so the v1
API too) and the portals hide the feedback forms; take feedback on the public form or in the tab
room. Absent = on.

## Limitations

- Data-entry staff cannot merge individual ballots themselves; they confirm the merged or
  tab-entered ballot.
- Equity and Adjudication Core cover conflicts, feedback, adjudicator scores and allocation only
  (see above); room preferences, motions, feedback questions and releases stay administrator work.
- Staff confirmations are not in the audit log (see above).
- A staff member cannot clear a test score (only change it); administrators can.
