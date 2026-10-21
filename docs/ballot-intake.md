# Paper-ballot intake

Tab rooms that run on paper need to know, at any moment, which ballots have come back and what
has happened to each one since. CrabbyTab does this the way Tabbycat's ballot check-in does:
every printed ballot sheet carries a barcode, staff scan each sheet as it reaches the tab room,
and a round status board follows every debate from missing paper to a confirmed result.

Pages:

- **Print ballot sheets** (`/<tournament>/print/ballots`, linked from Results): prints the active
  round's sheets.
- **Ballot intake** (`/<tournament>/results/intake`, linked from Results and the print page):
  scanning plus the round status board.
- **Results overview** (`/<tournament>/results`): a one-line summary of the active round's paper
  (sheets received and debates per status) with a link to the intake page.

The logic is in `src/features/tournament/application/ballotIntake.ts` (pure functions, tested in
`ballotIntake.test.ts`).

## Printed sheets

- **Consensus ballots** (and every BP tournament): one sheet per debate, for the chair.
- **Voting ballots** (`ballotMode: "voting"`, two-team formats only): one sheet per voting
  adjudicator, chair first, then panellists. Trainees never vote and get no sheet. A voting
  panel with no adjudicators yet still gets one debate sheet. Byes get no sheet.

Which of the two applies is decided per round by `usesPerAdjudicatorSheets(round, rules)`, which
passes the round's stage to `usesVotingBallots` in `src/lib/ballots/result.ts`, so the ballot-mode
resolution there (including a separate elimination ballot mode) applies to printing and intake too.

Each sheet shows the round, room, debate number, motion, the adjudicator it belongs to (voting
ballots, "sheet 2 of 3") and a Code 39 barcode of its **sheet id**, which is also printed in
text for typing.

### Sheet ids

A sheet id looks like `B3-4K7M2QXZ`: `B`, the round number, a dash, and an 8-character code.

- The code is 7 characters of a hash of the debate id and (voting ballots) the adjudicator id,
  plus a check character. It is stable: reprinting the same debate gives the same id.
- Only the code identifies the sheet. The `B3-` prefix is for people; typing the code alone works.
- The alphabet has 31 characters and leaves out I, L, O, U and Y. When typed, O is read as 0 and
  I or L as 1. The check character catches any single wrong character and any swap of two
  neighbouring characters, so a mistyped id is reported as mistyped rather than matching another
  sheet.
- Every id is Code 39 compatible, so USB scanners and the camera scanner read it directly.
- Collisions are possible in principle but very unlikely (about 2.7 × 10¹⁰ codes). If two current
  sheets ever share a code, scanning it is refused with a message, and the debate's ballot is
  entered from the board instead.

**Reprint after changing the draw or panels.** A sheet belongs to a debate (and an adjudicator).
If a debate is deleted or regenerated, or an adjudicator moves to another panel, its old sheet no
longer matches anything and scanning it reports an unknown sheet. Moving a debate to another room
does not change its id.

## Intake (check-in)

Staff choose the round being received, then scan (USB scanner, the camera via the browser's
`BarcodeDetector`, as on the Availability page) or type each sheet id. Every scan gets a clear
answer:

| Outcome | Meaning | Recorded? |
| --- | --- | --- |
| Received | First scan of this sheet. | Yes: who (signed-in user) and when. |
| Already received | The sheet was received before; the message says when and by whom. | No (idempotent). |
| Wrong round | The sheet belongs to another round. A button switches to that round. | No |
| Cancelled round | The sheet's round is cancelled or deleted (`round_cancelled`). | No |
| Unknown sheet | No current debate has this code (see "Reprint" above). | No |
| Not a sheet id / mistyped | The text is not a sheet id, or its check character is wrong. | No |

Late paper for a completed round is still recorded. A recent-scans list on the page shows this
device's last few scans.

Receipts are append-only: there is no "undo receipt". A receipt records that a physical sheet was
in the tab room, and the check character makes recording the wrong sheet by mistyping very
unlikely.

## Round status board

One row per non-bye debate in room order, with the paper received so far (`2/3`, plus which
adjudicators' sheets are missing), the status, the time of the last scan, and a link straight to
ballot entry for the debate. Filter buttons show the count per status.

| Status | Rule (first match wins) |
| --- | --- |
| Confirmed | The debate has a confirmed, non-discarded ballot version. A newer pending version is flagged under it. |
| Disputed | No confirmed version, and either every entered version was discarded (it needs entering again), or double entry is on and two or more pending versions disagree (`diffBallots`). |
| Awaiting check | Double entry is on and a version is waiting for a second person's check. |
| Entered | Double entry is off and an unconfirmed version exists (including judges' private-URL ballots, which need no paper). |
| Received | All expected sheets have arrived and nothing is entered yet. |
| Partly received | Voting ballots: some, not all, voting adjudicators' sheets have arrived. |
| Missing | No paper and no ballot. |

A blind double-entry mismatch is resolved in the ballot-entry dialog (keep the first or second
entry), so it is never left stored; what the board can see afterwards is a discarded version or
disagreeing pending versions, which it shows as disputed.

A debate-level sheet (printed while ballots were consensus) counts for every voter's sheet, and a
voter's sheet scanned in consensus mode counts as the debate's paper, so a ballot-mode change
between printing and intake does not lose paper.

## Data

Receipts are stored in the `ballotIntake` collection (`BallotIntakeRecord` in `src/types`), one
record per sheet with the id `intake-<code>`, so the same sheet scanned on two devices produces
the same record:

```
{ id, tournamentId, roundId, debateId, sheetCode, adjudicatorId?, receivedAt, receivedBy?, receivedByName? }
```

- **Local working copy and cloud sync:** the collection is in `CLOUD_COLLECTIONS`, so it is saved
  on the device, uploaded and downloaded with the other tournament records, and covered by the
  pending-changes and conflict views. Firestore access is the generic administrator-only rule.
- **Data-entry assistants** may record intake. Their receipts go through the `data-entry-sync`
  route, which keeps only the sheet fields, stamps `receivedBy`/`receivedByName` from the signed-in
  assistant, refuses receipts for a missing debate, a round mismatch or a cancelled round, and
  keeps the first receipt when a sheet is already recorded. `assistant-data` returns receipts so
  assistants see the board.
- **Backups** include the collection. Backups written before it existed are read as having no
  receipts. A receipt whose debate is missing from a backup is a warning, not an error.
- **Public views** never include it, and **DebateXML** does not carry it.

Known limits: if two devices receive the same sheet before syncing, the second upload of that
receipt is archived as a sync conflict (the record is identical apart from who and when, so either
version is fine to keep).
