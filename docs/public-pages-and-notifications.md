# Public pages, projector, notifications and self check-in

Step 4 of [the parity plan](tabbycat-parity-plan.md) ("Public site" and "Notifications" in Phase 3).

## Public pages (`/[slug]/public`)

Everything the public page shows comes from the public projection
(`src/lib/publicView/projection.ts`), published at upload time and served from the Vercel Data Cache
through `/api/public/tournaments/[slug]`. No public page reads Firestore collections directly.

| Tab | Shown when | Data |
| --- | --- | --- |
| Draw, Results, Standings | existing per-round releases | unchanged |
| Team / Speaker / Replies tab | `releaseTeamTab` / `releaseSpeakerTab` / `releaseRepliesTab` | completed preliminary rounds' confirmed ballots |
| Motions | `publicMotions` and the motion is released | text, info slide; per-motion side results from released ballots only |
| Break | the category is in `releasedBreakCategoryIds` | the generated break |
| Participants | `publicParticipants` | every team with speaker names, every adjudicator with institution |
| Institutions | `publicInstitutionsList` | name, code, region; team/adjudicator counts only if participants are public too |
| Adjudication core / Breaking adjudicators | `publicAdjudicatorCore` / `publicBreakingAdjudicators` | adjudicators flagged `adjCore` / `breaking` |

All list releases default to hidden and are switched in the **Public release** panel on the standings
page. Adjudicators are flagged as core or breaking in the participant directory's edit dialog.

Projection rules added in this step:

- Teams outside the draw and released breaks are only included when the participants list is
  released. Break redaction (`redactUnreleasedBreak`) still applies to every team.
- Adjudicators are included when they sit on a revealed panel or appear on a released list. The
  `adjCore` / `breaking` flags are only sent when their own list is released, so an unreleased
  breaking-adjudicator decision cannot be read from the JSON.
- Public ballots now carry `forfeitSide`, so motion statistics can exclude forfeits.
- Never exposed: emails, private URL keys, passcodes, conflicts, base/test scores, feedback.

Motion statistics count one confirmed ballot per debate, skip forfeits, and use the ballot's motion
(falling back to the debate's). BP counts first places and average points per position; two-team
formats count wins per side. The χ² balance test is the existing `analyzeMotionBalance`.

## Projector display (`/[slug]/display`)

Three views: **Draw by room** (responsive: one column on phones, two on tablets, four BP positions on
wide screens), **Draw by team** (alphabetical, with side, room and opponents) and **Motion reveal**.

The motion reveal shows a cover slide, then each motion's information slide (if any) followed by the
motion, in `seq` order. Keys: → / Space / Enter / Page Down advance, ← / Backspace / Page Up go back,
Home / End jump, Esc returns to the draw.

Public viewers only see released motions (the projection holds nothing else). Signed-in users whose
administrator role is confirmed by `/api/tournaments/[id]/access` can preview unreleased motions;
those come from the administrator's own working copy in this browser's local storage, never from a
server response.

## Automatic notifications

Opt in per event on the email page:

| Preference | Sent to | When |
| --- | --- | --- |
| `notifyDrawReleased` | each team's speakers | the round's draw is confirmed or released (panels show "TBA" until revealed) |
| `notifyDrawReleased` | each allocated adjudicator | the draw is visible **and** panels are revealed |
| `notifyTeamPoints` | each team's speakers | results are released, the round is not silent and public results are on |
| `notifyBallotReceipt` | the submitting adjudicator | they submit a ballot from their private URL |

How it works:

- The server reads the **cloud copy**, so a release is only emailed after it has been uploaded. Each
  cloud upload calls `/api/tournaments/[id]/notifications` (administrators only) until nothing is
  due; the email page also has **Send due notifications now**.
- Running team points use the standings calculator over released, non-silent preliminary rounds
  only. Teams without a confirmed result for the round get no email (missing is not zero).
  Elimination rounds are not covered by team-points emails.
- Each (event, round) has a document in `tournaments/{id}/notificationLog`. Recipients are sorted by
  address and sent in chunks of at most 100 (one chunk per request, to stay within the route's
  time limit); each chunk is claimed in a transaction before sending, so concurrent triggers do not
  double-send. Ballot receipts are claimed once per ballot id, so an offline resubmission does not
  repeat them.
- Switching an event on first marks rounds already released in the cloud copy as skipped, so opting
  in mid-tournament does not email old rounds.
- Every send is a campaign in email history (marked "Automatic notification"). A claimed chunk is not
  re-sent automatically if delivery fails; use **Retry failed** in the history.
- A missing SMTP configuration fails before anything is claimed. A failing ballot receipt never fails
  the ballot submission.

Private portal links and passcodes can now also be emailed to teams (`{{private_url}}` and
`{{passcode}}` resolve to the team's link for each speaker). A send is refused if one address would
receive two different links.

## QR slips

**Print QR Slips** on the private URLs page prints one slip per participant in the current list
(adjudicators or teams, after search), with the QR code, link and optionally the passcode. QR codes are
generated locally by `src/lib/qr/qrcode.ts` (byte mode, versions 1–40, levels L/M/Q/H); its output was
checked against an independent decoder for every mask and level, and the tests pin it.

## Self check-in

With **Self check-in from private URLs** on (configuration → visibility), the team and adjudicator
portals show a check-in panel for the current round: the earliest round that is neither cancelled
nor completed. Requests go through `/api/private/sync` (passcode check and per-link rate limit) and
are refused for any other round.

The server writes `roundAvailability[roundId]` and `roundAvailabilityAt[roundId]` and bumps
`syncVersion`. Organisers see check-ins after **Download from cloud**; uploading an older local copy of
that participant records a sync conflict instead of silently overwriting the check-in. The public
check-in counts update at the next publish.

## Known limitations

- Notifications and self check-ins depend on the cloud copy, so they lag local changes until the
  next upload (or download, for check-ins). This goes away with the Firestore source-of-truth work
  (Phase 4.1).
- Notification templates are fixed in code.
- Veto statistics are not public: vetoes are not in the projection.
