# Data import and export

How CrabbyTab moves tournament data in and out. The logic is pure and tested:

- DebateXML export: `src/features/tournament/application/debateXml.ts`
- DebateXML import: `src/features/tournament/application/debateXmlImport.ts`
- CSV imports with preview: `src/lib/csv/importPlan.ts`, conflicts: `src/lib/csv/conflictsImport.ts`
- CSV exports: `src/lib/csv/exporters.ts`
- JSON backup, validation, merge and replace: `src/features/tournament/application/tournamentBackup.ts`

## DebateXML

**Export** (account menu → Export DebateXML Archive, admins only) writes a Tabbycat-compatible
archive. Emails, private URLs, passcodes and free-text feedback comments are never exported.

**Import** (Tournaments hub → "Or import a DebateXML archive", global admins only) always creates a
**new** tournament; it never merges into an existing one. The file is checked before anything is
saved, and the page lists counts, errors and warnings with the element they came from
(for example `round "Round 1" › debate "D3" › side 2`). Any error blocks the import.

What is read:

| Element | Imported as |
| --- | --- |
| `<institution id reference region>` | Institution (`reference` → code) |
| `<team id name code institution break-eligibilities division>` + `<speaker id categories gender>` | Team and speakers |
| `<adjudicator id name score institutions independent trainee gender team-conflicts institution-conflicts adjudicator-conflicts>` | Adjudicator and conflicts; the own-institution conflict is always added |
| `<venue id priority>`, `<motion id reference>` + `<info-slide>` | Venue, motion |
| `<break-category id priority break-size reserve-size general>` | Break category |
| `<speaker-category>`, `<division>` | Speaker category names, team divisions |
| `<question id name type from-teams from-adjudicators required min-value max-value>` | Team/adjudicator feedback questions |
| `<round name abbreviation elimination feedback-weight break-category silent>` | Round |
| `<debate id chair adjudicators venue motion>` with `<side team>` | Debate. Side order is position: OG, OO, CG, CO (BP) or Affirmative, Negative |
| `<side>`/`<speech>` `<ballot adjudicators rank>` | Results: one scoresheet → consensus ballot; several scoresheets in a two-team debate → voting ballot with one sheet per adjudicator, aggregated by majority |
| `<speech speaker reply ghost>` | Speaker scores; position is the speech's order in the side |
| `<bye>` | Bye debate |
| `<feedback source-team/source-adjudicator debate score ignored>` + `<answer question>` | Confirmed feedback |

Decisions and limits:

- The format comes from `style` when it is a CrabbyTab format, otherwise from the debates (4 sides = BP).
- Substantive speakers and whether replies are used are inferred from the speeches. Score ranges
  start from CrabbyTab's defaults and are widened to fit the imported scores; the preview says so.
- Two-team ballots without ranks are decided by the higher total; a tie is an error. BP results need
  a rank (or 0–3 points) for every team.
- Imported draws are drafts and motions/results are unreleased, so nothing becomes public until it
  is released. Private URLs, emails and check-ins are not part of DebateXML.
- Debate panels only distinguish the chair; other panel members become trainees if the adjudicator
  is flagged `trainee`, otherwise panellists.
- Untrusted input: 10 MB limit, files with a DOCTYPE or entity declarations are refused, only
  attributes and text nodes are read, and record counts are capped.
- An export → import → export round trip produces an identical archive (tested).

## CSV imports: institutions, teams, adjudicators

Institutions, Teams and Adjudicators → Import CSV. Upload a file or paste text, then **Preview
import**. Nothing is saved until **Import** is pressed, and the save is one write per collection
(teams and adjudicators go through the live-sync path like any other edit). Logic:
`src/lib/csv/importPlan.ts` (plan and commit), `csvTable.ts` (reading), `importer.ts` (row parsers).

Reading: a UTF-8 BOM and spaces around column names are removed, blank rows (including rows of
empty cells) are skipped, quoted commas, quotes and newlines stay inside the value, and nothing is
evaluated (formulas and markup are kept as text). Files over 5 MB, an empty file, a header with no
rows, repeated column names, a missing `name` column and an unclosed quote stop the whole import.
Unknown columns are listed as ignored. Row numbers are spreadsheet rows (the header is row 1).

| Kind | Columns |
| --- | --- |
| Institutions | `name` (required), `code`, `region`, venue requirement columns |
| Teams | `name` (required), `institution`, `code`, `speaker1`…`speaker5`, `speakerN_email`, `speakerN_categories`, `break_categories`, `division`, `division_id`, `category` (legacy team-wide label), `seed` (see below), venue requirement columns |
| Adjudicators | `name` (required), `email`, `institution`, `score` (default 5), `trainee`, `independent`, `gender`, `region`, `preformed_panel_id`, venue requirement columns |

Each row is shown with what will happen and why:

- **Errors** (row cannot be imported): missing name, invalid email, score or yes/no flag, unknown
  break category, a speaker email or categories without a speaker name, wrong number of cells. A
  file with errors is refused unless **Import the valid rows only** is ticked; there are no silent
  partial imports.
- **Warnings**: no speakers (placeholder speakers "Team Speaker 1"… are created and the warning
  says to rename them), fewer speakers than the format uses, a speaker email already used by
  another speaker, an adjudicator with the same name at another institution, a short row.
- **Duplicates**: names are compared ignoring case and repeated spaces. Institutions match an
  existing one by name or code, teams by name, adjudicators by email, else by name and
  institution. A match defaults to **Skip**; it can be switched to **Update existing** or
  **Create** anyway. A repeat inside the file defaults to Skip.
- **Updates** change only the cells that are filled: blank cells keep the existing value, speakers
  are updated by position and keep their ids (ballots refer to them), and an adjudicator who
  changes institution keeps their other conflicts.
- **Unknown institutions** are listed with a derived code (first four letters, made unique) that can
  be edited before importing; they are created with the import. Unticking one keeps its name on the
  rows without linking it (no institution conflicts then). `Independent`, `Unaffiliated`, `None`
  and `-` mean no institution. An adjudicator marked independent is not linked to an institution.
- **Speaker categories** in `speakerN_categories` are matched to the tournament's speaker
  categories by name or slug; unknown names are created (not public) and listed in the preview.

**Team seeds** (Tabbycat `show_seed_in_importer`): the **Team seed column** setting at the top of
the team import (saved for the tournament as `preferences.teamSeedMode`) is *Do not ask* (default:
a `seed` column is listed as ignored), *numeric* (a whole number 0–99,999; higher is stronger, as
seeded draws read it) or *seed title* (`Unseeded`, `Free seed`, `Half seed`, `Full seed`, or 0–3,
stored as 0–3 like Tabbycat). An invalid seed is a row error; a blank cell means no seed (not 0)
and, on update, keeps the team's seed. In title mode the seeded-draw setup panel and the
registration form offer the titles instead of a number box.

Each import is one `entities.batch_saved` audit event listing the created and updated ids.
Venue and motion CSVs still import directly, without this preview.

## Conflicts CSV

Setup → Conflicts. Each row fills exactly two of `adjudicator`, `team`, `institution`,
`other_adjudicator` (logic: `src/lib/csv/conflictsImport.ts`):

| Filled | Conflict | Stored as |
| --- | --- | --- |
| adjudicator + team | adjudicator–team | `{ teamId, type: "personal" }` on the adjudicator |
| adjudicator + other_adjudicator | adjudicator–adjudicator | `{ adjudicatorId, type: "personal" }` on the first adjudicator |
| adjudicator + institution | adjudicator–institution | `{ institutionId, type: "institution" }` on the adjudicator |
| team + institution | team–institution | `Team.institutionConflictIds`; adjudicators from that institution clash with the team in allocation |

Adjudicators are found by name or email, teams by name or code, institutions by name or code. A
name that matches two records is an error (use the email or code). Unknown names, an adjudicator
paired with themselves and rows with the wrong columns are errors; conflicts that already exist
(including an adjudicator's own institution) or repeat in the file are shown and skipped. The
preview works like the participant imports: nothing is saved until confirmed, and rows with errors
block the import unless the valid rows only are imported.

The same page lists every recorded conflict, removes one (from both sides for
adjudicator–adjudicator conflicts) and adds team–institution conflicts
(`src/lib/csv/conflictsExport.ts`); its *Export conflicts CSV* button downloads the same file as
the Data exports page.

## Room preferences CSV

Setup → Room preferences (`src/lib/venues/constraintEdits.ts`). One row per preference: exactly
one of `team` (name or code), `adjudicator` (name or email) or `institution` (name or code), plus
`category` and a whole-number `priority`. A row for a category the subject already has updates
its priority; ambiguous or unknown names and duplicate rows are errors. The venues CSV also
accepts a `url` column (http or https links only). Its `category` (or `categories`) cell may name several room
categories separated by `;` or `,` (quote the cell when using commas); the first is also kept in
the older single-category field.

## Speaker categories

Setup → Speaker categories (`src/lib/speakerCategories.ts`), like Tabbycat's SpeakerCategory: a
name, slug, order, whether it has a public speaker tab, and a public limit (the category tab shows
ranks up to that number; 0 shows everyone). They are stored in `preferences.speakerCategories`.

Speakers reference categories by id in `Speaker.categories`. Older tournaments stored free-text
labels there (and team-wide labels in `Team.speakerCategories`); nothing is rewritten: every entry
is resolved by id, slug or name, and labels that match no category appear as unsaved categories
until the list is saved. CSV imports and the team editor write ids. A category can be deleted only
when no speaker is in it. DebateXML export writes the category names; import keeps the names, which
resolve the same way.

## CSV exports

All CSVs use PapaParse with formula escaping (cells starting with `=`, `+`, `-` or `@` are prefixed
with `'`) and a UTF-8 BOM for Excel.

| Where | File | Audience |
| --- | --- | --- |
| Standings → Export CSV | Team, speaker or reply standings (the open tab); per-round columns for speakers | Tab room |
| Draw → Export CSV | The round's draw with adjudicators and motion | Tab room |
| Feedback → Feedback CSV (admin only) | Every submission with source, comments and answers | Admins only |
| Feedback → Scores CSV (admin only) | Base, test, feedback and blended adjudicator scores | Admins only |
| Data exports → Teams | One row per team: speakers, institution, code name, emoji, seed, break categories, swing | Admins only |
| Data exports → Speakers | One row per speaker: team, institution, email, gender, region, speaker categories | Admins only |
| Data exports → Adjudicators | Institution, email, base/test score, trainee, independent, adjudication core, breaking | Admins only |
| Data exports → Institutions | Name, code, region, team and adjudicator counts | Admins only |
| Data exports → Availability | Every team, adjudicator and venue × every non-cancelled round: available yes/no | Admins only |
| Data exports → Break eligibility | Team × break category: eligible, override, speaker-category rule and whether it is met, broke | Admins only |
| Data exports → Conflicts | Adjudicator–team, adjudicator–adjudicator, adjudicator–institution, team–institution | Admins only |

The **Data exports** page (admin sidebar) builds the participant, availability, break-eligibility
and conflict files in the browser from the working copy (`src/lib/csv/participantExports.ts`).
Private URL keys and passcodes are never exported; the files do hold email addresses.

- Teams, speakers, adjudicators and institutions carry their `id`, so rows can be matched up again.
- Availability applies the same rule as the draw: a round's own availability, else the check-in,
  with the check-in expiry; venues use their tournament-wide flag.
- The conflicts file uses the conflicts import's columns (`adjudicator`, `team`, `institution`,
  `other_adjudicator`, plus a `type` column the import ignores), so it can be edited and imported
  again (tested as a round trip). Records are named by name, or by email (adjudicators), code name
  (teams) or code (institutions) where the name is shared. History conflicts (derived from past
  rounds), an adjudicator's or team's own institution and the second copy of a mutual
  adjudicator conflict are left out.

## Rehearsal tools and demo tournaments

Tabbycat's `generateresults`, `simulaterounds` and `generatefeedback` commands and its demo
tournaments, for practising before an event.

- **Load demo tournament** (tournament switcher, or `/tournaments/demo`; global administrators,
  like any new tournament): a seeded BP (24 teams) or WSDC (16 teams) tournament with institutions,
  speakers (some in ESL / novice categories), adjudicators with scores and a few conflicts, rooms,
  preliminary and elimination rounds, motions and Open / ESL break categories
  (`src/lib/rehearsal/demoTournament.ts`). It is saved as a new tournament on this device (never
  overwriting one); its URL starts with `demo-` and its name with "Demo —".
- **Rehearsal tools** (admin sidebar, `/[tournament]/rehearsal`): for a round with a draw,
  *Simulate results* creates one random, valid, confirmed ballot per unresulted debate and
  *Simulate feedback* one feedback submission per expected source/target pair along the configured
  feedback paths, answering custom questions validly (`application/rehearsal.ts`).
  - Seeded: the same seed on the same draw gives the same results.
  - Ballots are validated with the ballot form's checks, built with its result builder (consensus
    or voting, replies, BP ranks from totals so there are no low-point wins) and submitted through
    `submitBallotCommand`, so the round's rules apply (a completed round asks for an override).
  - Simulated records are marked "Simulated (rehearsal)". Debates that cannot be simulated
    (postponed, already resulted, sides chosen on the ballot, a team without enough speakers, no
    voting adjudicator) are listed, never silently dropped.
  - Nothing runs automatically. On a tournament that is not a demo tournament each run needs the
    tournament's short name typed as confirmation, and every run is recorded in the audit log
    (`rehearsal.results_simulated`, `rehearsal.feedback_simulated`, with the seed).

## Tournament configuration file and rules presets

*Settings -> Format & teams -> Configuration file and rules presets* (Tabbycat `exportconfig` /
`importconfig` and options-presets-confirm; `src/lib/setup/configTransfer.ts`):

- **Export settings** downloads the tournament's format and preferences as JSON
  (`kind: "crabbytab.tournament-config"`, `version: 1`). Tournament-specific state is never
  included: the current round, released tabs, ballots and break categories, and the schedule.
- **Load settings from a file** validates the file (kind, version, a known format, every value of
  the right type, teams per debate matching the format; unknown and tournament-specific settings
  are skipped and listed) and previews every setting that would change, before and after.
- **Rules preset** previews applying one of the creation wizard's presets (format, speakers, score
  scale and its settings bundle) to this tournament.

Nothing is saved until **Apply these changes** is confirmed. Settings fixed once ballots exist
(`lockedSettingsFields`) are kept and listed; a different number of teams per debate, or a format
fixed by ballots, refuses the whole file or preset rather than applying half of another format.
Saving goes through `saveTournament`, which enforces the settings guards again. Participants,
rounds and results are never touched.

## JSON backups

Account menu → Export Tournament Backup downloads every collection (`crabbytab-tournament-backup-v1`).
Restore Tournament Backup… validates the file before anything changes:

- format version, the tournament record, required fields and duplicate ids per collection, and
  records that belong to another tournament;
- references between records: missing rounds, teams, debates, adjudicators or break categories are
  errors; missing venues, motions and institutions are warnings.

It then shows, per collection, how many records are only in the backup, only on this device,
different or the same, and offers:

- **Merge**: adds the backup's missing records; records on this device win.
- **Replace**: makes the tournament match the backup after an explicit confirmation. A pre-restore
  backup downloads first. The tournament's id, URL, owner and administrators are kept, the audit
  log is merged (it is append-only), removed records are queued as cloud deletions for the next
  upload, and a `backup.replaced` audit event is recorded.
