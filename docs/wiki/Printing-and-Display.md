# Printing and display

Everything printable uses the browser's print dialog, so you can print directly or save as PDF.
Ballots and feedback forms are for the **active round** (pick it in the top bar). Without one, the
pages say *Select a round first.*

## What you can print

| Printable | Where | Notes |
| --- | --- | --- |
| Ballot sheets | **Results** → print ballots, or **Results → Ballot intake** (`/{slug}/print/ballots`) | See below |
| Feedback forms | **Feedback** → print forms (`/{slug}/print/feedback`) | See below |
| Draw sheet | Round → **Draw** → **Print draw sheet** | Prints the draw page |
| Standings | **Standings** → print button | |
| One result | A debate's result page → print | |
| QR slips for private URLs | **Public → Private URLs** → **Print QR slips** | [Private URLs](Private-URLs-and-Portals#generating-credentials) |
| Barcode labels | Round → **Availability** → print barcodes | For check-in scanners; speakers have labels too. See [Check-ins and availability](Check-ins-and-Availability). |

**Language.** Ballots, feedback forms and barcode labels print in the tournament's **public pages
and portals language** (Configuration → Public visibility). The on-screen buttons stay in your own
language.

## Ballot sheets

- **One sheet per debate** for consensus panels. **One sheet per voting adjudicator** for voting
  panels, each named "sheet n of m". Byes get no sheet.
- Each sheet has the round and room, the motion line (when motions are on), the teams and speakers
  by side with each speaker's pronoun, and columns that follow the round's ballot rules: speaker
  scores (none for results-only rounds), one column per scoring criterion, speech ranks, and team
  rank, total or winner. N-team rooms rank the teams, or tick the advancing teams in results-only
  rounds. Then come a notes box, the chair and panel names, and a signature line.
- If the draw did not set sides, the sheet asks the adjudicator to tick the side each team took.
- Each sheet carries a **barcode**. Scan returned sheets on **Results → Ballot intake** to track
  which have come back. Reprint after changing the draw or panels, because changed debates get new
  sheet ids.
- The tournament's **ballot introduction** text is printed if you set one.

**Print options** (card on the print page, saved with the tournament):

| Option | Effect |
| --- | --- |
| Return location | "Return this sheet to …" on every sheet. Empty or "TBA" hides it. |
| Digit strip | A strip of digits beside each score for the adjudicator to circle, so handwriting is unambiguous |
| Blank motion line | Prints an empty motion line, for printing before motions are released |

## Feedback forms

One form per expected submission in the active round, so the printed set matches the feedback
progress tracker. The page header lists the round's feedback paths and how many team and
adjudicator forms there are. Each form has who it is from and about, the room, the overall score
scale, the questions for that source (teams or adjudicators), a comments box and a confidentiality
note. A **return location** can be printed too. If the round collects no feedback, or adjudicators
are not allocated yet, the page says so.

## Projector display

`/{slug}/display` is made for a projector or big screen. Open it from sidebar → **Round → Display**
(administrators, and data-entry staff with the `draw.display` permission). The address itself is
public, so you can open it on any laptop without signing in.

**Views:**

- **Draw by room**: one column on phones, two on tablets, the four BP positions side by side on
  wide screens. Shows the chair, panellists and trainees once panels are visible; byes show "Full
  win awarded" or "Absent — no standings result".
- **Draw by team**: alphabetical, with side, room and opponents, so teams find themselves quickly.
- **Motion reveal**: a cover slide, then each motion's information slide (if any) followed by the
  motion, in order. Keys: → / Space / Enter / Page Down advance; ← / Backspace / Page Up go back;
  Home / End jump; Esc returns to the draw. If only the info slides are released, the reveal stops
  at the info slides.

**Controls:** text smaller and larger, **Auto-scroll** (on by default; pause it for long draws),
and **All current rounds**.

**Concurrent rounds.** When the shown round shares its schedule slot with other rounds (parallel
panels such as "Round 1 (A)" and "Round 1 (B)"), the projector shows all of them, each under its
own heading. Untick **All current rounds** to show only the active round.

### What the projector shows, and to whom

| Viewer | Draw | Panels | Motions |
| --- | --- | --- | --- |
| Anyone (not signed in, or without projector rights) | Only rounds on the public draw page, so only **Released to public** draws, under the Public draw setting | Only after **Reveal Adjudicators** | Only released motions or info slides, and only with the public motions page on |
| Administrator | Every **confirmed** (or later) draw of the slot, before release, from this device's working copy. Never a draft. | Always | Everything, with a "Staff preview: not released" note |
| Data-entry staff with `draw.display` / `motions.display` | As administrator, from their staff copy (the server sends only what those permissions allow) | Always | As administrator, with `motions.display` |

Public viewers refresh from the published snapshot every 45 seconds. Staff copies load once. Click
**Reload staff copy** after changing the draw. A projector laptop that has never opened the
tournament has no working copy, so it shows the public view even for an administrator.

## Details

- Projector logic: `src/lib/display.ts`. Printed-sheet options: `src/lib/printOptions.ts`.
- Developer detail:
  [public-pages-and-notifications.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/public-pages-and-notifications.md)
  (projector, printed forms),
  [ballot-intake.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/ballot-intake.md),
  [staff-access.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/staff-access.md#projector).
