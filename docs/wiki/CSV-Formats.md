# CSV formats

Every CSV file CrabbyTab reads or writes, where to find it, and the exact columns. For the workflow around imports (recommended order, editing participants) see [Participants and imports](Participants-and-Imports). Developer detail: [data-import-export.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/data-import-export.md).

**Tabbycat compatibility.** CrabbyTab's CSV columns are its own; they are not Tabbycat's `importtournament` files. To move a whole tournament between Tabbycat and CrabbyTab use **DebateXML** (see [Participants and imports](Participants-and-Imports)). For a full copy of a CrabbyTab tournament use the JSON backup (see [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync)).

## Overview

| File | Where (sidebar → page) | Preview before saving | Duplicates |
| --- | --- | --- | --- |
| [Institutions](#institutions) | Setup → Institutions → **Import CSV** | Yes | Matched; skip, update or create |
| [Teams](#teams) | Setup → Teams → **Import CSV** | Yes | Matched; skip, update or create |
| [Adjudicators](#adjudicators) | Setup → Adjudicators → **Import CSV** | Yes | Matched; skip, update or create |
| [Conflicts](#conflicts) | Setup → Conflicts | Yes | Existing and repeated conflicts skipped |
| [Room preferences](#room-preferences) | Setup → Room preferences (admins) | Yes | A repeat in the file is an error; an existing one is updated |
| [Venues](#venues) | Setup → Venues → **Import CSV** | Parsed list only | Not checked |
| [Motions](#motions) | Setup → Motions → **Upload CSV** | No | Not checked |
| [Bulk base scores](#bulk-base-scores) | Results → Feedback → *Update base scores in bulk* | Yes | A repeated adjudicator is an error |

Exports are listed under [CSV exports](#csv-exports).

## Rules shared by the previewed imports

These apply to institutions, teams, adjudicators, conflicts and room preferences.

- **Input:** upload a `.csv` file or paste the text, then **Preview import**. The first row must hold column names.
- **Reading:** a UTF-8 byte-order mark and spaces around column names are removed. Blank rows (including rows of empty cells from spreadsheets) are skipped. Quoted values may contain commas, quotes and newlines. Nothing is evaluated: formulas and HTML stay plain text.
- **Column names** are matched exactly first, then ignoring case. Columns no alias uses are listed as *ignored*.
- **The whole file is refused** when it is larger than 5 MB, empty, has a header but no data rows, repeats a column name, lacks the required column, or has an unclosed quote.
- **Row numbers** are spreadsheet rows: the header is row 1.
- **Errors** stop a row. A file with any row error is refused unless you tick **Import the valid rows only**. There are no silent partial imports.
- **Warnings** (for example a row with fewer cells than columns) do not stop the row.
- **Names** are compared ignoring case and repeated spaces.
- Nothing is saved until you confirm. Institutions, teams and adjudicators are saved in one write per collection and recorded as one `entities.batch_saved` audit event.

**Yes/no cells** accept `yes`, `true`, `1`, `no`, `false`, `0` (any case). Anything else is a row error. A blank cell means "not given".

## Institutions

Setup → Institutions → **Import CSV**.

| Column (aliases) | Required | Value |
| --- | --- | --- |
| `name` (`institution`, `institution name`) | Yes | Text |
| `code` (`abbr`, `institution code`) | No | Text. Blank: the first 4 characters of the name, upper-cased |
| `region` | No | Text |
| [Venue requirement columns](#venue-requirement-columns) | No | Hard room needs for the institution's teams |

```csv
name,code,region
University of Dhaka,DU,Dhaka
"University of Oxford, UK",OXF,Europe
```

- **Matches an existing institution** by name, else by code. Default action **Skip**; you can choose **Update existing** or **Create**.
- A name or code repeated in the file is a warning; the later row defaults to Skip.
- **Unquoted commas:** an older export may have names like `University, City` without quotes. The extra cells are joined back into the name, with a warning.
- **Update** keeps the existing code when the code cell is blank.

## Teams

Setup → Teams → **Import CSV**.

| Column (aliases) | Required | Value |
| --- | --- | --- |
| `name` (`team`, `team_name`, `team name`) | Yes | Text |
| `institution` (`inst`) | No | Name or code of an institution. See [Institutions in team and adjudicator files](#institutions-in-team-and-adjudicator-files) |
| `code` | No | Code name |
| `speaker1` … `speaker5` (`speaker_1`, `Speaker 1`, …) | No | Speaker name |
| `speaker1_email` … (`Speaker 1 Email`) | No | Valid email address |
| `speaker1_categories` … (`Speaker 1 Categories`, `speaker1_category`) | No | Speaker categories, separated by `,` `;` or `\|` |
| `break_categories` (`Break Categories`, `break_category`) | No | Names, slugs or ids of **existing** break categories, separated by `,` `;` or `\|` |
| `division` / `division_id` (`divisionId`) | No | Division label and id. A `division` column alone fills both |
| `category` | No | Legacy team-wide speaker category label |
| `seed` | Only read when asked (below) | Number or seed title |
| [Venue requirement columns](#venue-requirement-columns) | No | Hard room needs |

```csv
name,institution,speaker1,speaker1_email,speaker2,speaker2_email,speaker1_categories,break_categories
DU 1,University of Dhaka,Arif Rahman,arif@example.com,Nabila Islam,nabila@example.com,ESL,Open; ESL
```

Validation:

- **Errors:** missing team name; an invalid email; a speaker email or categories with no speaker name; an unknown break category (create it on the Break page first); an invalid seed or yes/no value.
- **Warnings:** no speakers (placeholder speakers "DU 1 Speaker 1", … are created, as many as the format uses; rename them before results are entered); fewer speakers than the format uses; a speaker email already used by another speaker.
- **Speaker categories** are matched to the tournament's categories by name or slug. Unknown names are listed in the preview and created (not public) with the import.
- Imported teams start checked in.

Duplicates and updates:

- A team **matches** an existing team by name. Default **Skip**; you can choose **Update existing** or **Create**.
- **Update** changes only filled cells. Speakers are updated by position and keep their ids (ballots refer to them). Speakers beyond those in the file are kept; remove speakers in the team editor. A blank `seed` keeps the team's seed.

**Team seeds** (Tabbycat `show_seed_in_importer`). The **Team seed column** setting at the top of the team import is saved for the tournament:

| Setting | `seed` column |
| --- | --- |
| Do not ask (default) | Listed as ignored |
| Numeric | Whole number 0–99,999. Higher is stronger, as seeded draws read it |
| Seed title | `Unseeded`, `Free seed`, `Half seed`, `Full seed` (also `free`, `half`, `full`, `none`) or `0`–`3`, stored as 0–3 like Tabbycat |

A blank seed cell means "no seed", not 0.

## Adjudicators

Setup → Adjudicators → **Import CSV**.

| Column (aliases) | Required | Value |
| --- | --- | --- |
| `name` (`adjudicator`, `judge`) | Yes | Text |
| `email` | No | Valid email address |
| `institution` (`inst`) | No | Name or code. See [below](#institutions-in-team-and-adjudicator-files) |
| `score` (`rating`, `baseScore`) | No | Number. Blank: 5 |
| `trainee` | No | Yes/no |
| `independent` (`indep`) | No | Yes/no |
| `gender`, `region` | No | Text |
| `preformed_panel_id` (`preformedPanelId`) | No | Any label; adjudicators with the same label form one preformed panel (see below) |
| [Venue requirement columns](#venue-requirement-columns) | No | Hard room needs |

```csv
name,email,institution,score,trainee
Eleanor Vance,eleanor@example.org,University of Dhaka,8.5,no
Sam Lee,sam@example.org,Independent,7,no
```

- **Errors:** missing name, invalid email, non-numeric score, invalid yes/no value.
- **Matches** an existing adjudicator by email; without an email, by name and institution. The same name at another institution is a warning, not a match. Default **Skip**; you can choose **Update existing** or **Create**.
- **Update** changes only filled cells. Changing institution keeps the adjudicator's other conflicts.
- An adjudicator linked to an institution gets the automatic institution conflict. One marked independent is not linked (the institution cell is ignored, with a warning). One created without a linked institution is marked independent.
- Imported adjudicators start checked in.
- **Preformed panels:** after importing, Round → Allocation → Preformed panels → **Create from CSV panel ids** builds one panel per `preformed_panel_id` group.

## Institutions in team and adjudicator files

- The `institution` cell is matched to an existing institution by name, then code.
- `Independent`, `Unaffiliated`, `None`, `No institution`, `N/A`, `NA` and `-` mean no institution.
- **Unknown institutions** are listed in the preview with a derived code (the first four letters, made unique with 2, 3, …). You can edit the name and code, or untick it. Ticked ones are created with the import; an unticked one leaves its name on the rows without a link (so no institution conflicts).

## Venue requirement columns

Hard room needs. Accepted on institution, team and adjudicator files.

| Requirement | Columns | Value |
| --- | --- | --- |
| Room category | `required_venue_category`, `venue_category` | Text |
| Minimum capacity | `min_venue_capacity`, `minimum_venue_capacity` | Number ≥ 0 |
| Step-free access | `requires_accessible_venue`, `venue_accessible` | Yes/no |
| Online room | `requires_online_venue`, `venue_online` | Yes/no |
| Near the tab room | `requires_near_tab_room`, `venue_near_tab_room` | Yes/no |

Soft, ranked preferences use the [room preferences](#room-preferences) file instead. See [Venues and constraints](Venues-and-Constraints).

## Conflicts

Setup → Conflicts (visible with `conflicts.view`; importing needs administrator or `conflicts.edit`). Tabbycat's four conflict types in one file. Each row fills **exactly two** of these columns:

| Column | Aliases | Finds |
| --- | --- | --- |
| `adjudicator` | `adjudicator_name`, `judge`, `adjudicator1` | Adjudicator by name or email |
| `team` | `team_name` | Team by name or code name |
| `institution` | `institution_name`, `inst` | Institution by name or code |
| `other_adjudicator` | `adjudicator2`, `conflicted_adjudicator` | Adjudicator by name or email |

| Filled | Conflict |
| --- | --- |
| adjudicator + team | Adjudicator–team |
| adjudicator + other_adjudicator | Adjudicator–adjudicator |
| adjudicator + institution | Adjudicator–institution |
| team + institution | Team–institution (adjudicators from that institution clash with the team) |

```csv
adjudicator,team,institution,other_adjudicator
Eleanor Vance,DU 1,,
Eleanor Vance,,,Sam Lee
Sam Lee,,University of Dhaka,
,DU 1,University of Oxford,
```

- **Errors:** a name matching no record, a name matching two records (use the email or code), an adjudicator paired with themselves, any other combination of filled cells.
- **Skipped (shown):** conflicts already recorded (including an adjudicator's own institution) and repeats within the file.
- The file needs at least one of the four columns; an extra `type` column (from the export) is ignored.

## Room preferences

Setup → Room preferences (administrators). Soft, ranked room-category preferences (Tabbycat venue constraints). One row per preference.

| Column (aliases) | Required | Value |
| --- | --- | --- |
| `team` (`team_name`) | Exactly one of team, adjudicator, institution | Team name or code name |
| `adjudicator` (`adjudicator_name`, `judge`) | | Name or email |
| `institution` (`institution_name`) | | Name or code |
| `category` (`room_category`, `venue_category`) | Yes (column and value) | Room category |
| `priority` | Yes (column and value) | Whole number; higher wins |

```csv
team,adjudicator,institution,category,priority
DU 1,,,Step-free,10
,Eleanor Vance,,Ground floor,5
```

A row for a category the subject already has updates its priority. Unknown or ambiguous names, a non-integer priority and a second row for the same subject and category are errors.

## Venues

Setup → Venues → **Import CSV** (`.csv`, `.txt` or `.tsv`; paste or upload). The page shows the venues read from the file; **Import** adds them all.

| Column (aliases) | Value | Blank |
| --- | --- | --- |
| `name` (`room`, `venue`) | Text | `Room N` |
| `priority` | Whole number; higher = better room | 10 (also for a non-number) |
| `category` (`categories`) | One or more room categories, separated by `;` or `,` (quote the cell for commas) | None |
| `capacity` (`seats`) | Number ≥ 0 | None |
| `accessible`, `online` | Yes/no | Not set |
| `near_tab_room` (`nearTabRoom`) | Yes/no | Not set |
| `url` (`link`, `meeting_url`) | `http` or `https` link only (map or meeting link) | None |

```csv
name,priority,category,capacity,accessible,online
Lecture Theatre 1,20,Main,200,yes,no
Online Room 1,5,Online,50,yes,yes
```

Gotchas: one invalid value (capacity, yes/no, URL) refuses the whole file with the row number. Venue names are **not** checked for duplicates, so importing the same file twice creates every room twice. Imported rooms are available.

## Motions

Setup → Motions → **Upload CSV** (upload or paste). Imported directly, without a preview.

| Column (aliases) | Value | Blank |
| --- | --- | --- |
| `text` (`motion`, `motion_text`, `Motion Text`) | Motion text | Row skipped |
| `reference` (`ref`, `topic`, `tag`) | Short label | `Motion N` (N = data row) |
| `infoslide` (`info_slide`, `info`, `Info Slide`, `context`) | Info slide text | None |
| `round` (`round_abbr`, `round_seq`, `round_name`) | One round: its id, name, abbreviation, `N`, `rN` or `round N` | Not assigned |

```csv
text,reference,infoslide,round
"This House would ban algorithmic feeds.",R1: Tech,"Chronological feeds only.",Round 1
```

Gotchas: an unmatched round is ignored silently (the motion is imported unassigned); only one round per row; motions are not checked for duplicates. Imported motions are unreleased and added after the existing ones.

## Bulk base scores

Results → Feedback → **Update base scores in bulk** (administrators and staff allowed to edit adjudicator scores). Paste text, **no header row**: one line per adjudicator, `name or id,score`.

```csv
Eleanor Vance,8
adj-3f2c…,6.5
```

- The adjudicator is found by id or exact name (case and spaces ignored). Scores must be between 1 and 10.
- Errors: missing score, extra cells, unknown or ambiguous name, invalid score, the same adjudicator twice. **Any error saves nothing.**
- Lines whose score does not change are left out.

## CSV exports

All exports are built in the browser from the tournament on this device, are UTF-8 with a byte-order mark (Excel reads accents correctly), use Windows line endings, and prefix any cell starting with `=`, `+`, `-` or `@` with `'` so spreadsheets do not run it as a formula. File names use the tournament name with spaces and punctuation replaced by `_`.

### Results and draw pages

| Where | File | Columns |
| --- | --- | --- |
| Results → Standings → **Export CSV** (team tab) | `{name}_Standings.csv` | Rank, Team, Institution (code), Points, Total Speaker Score, Average Speaker Score, 1st–4th Places, Wins, Margin |
| Standings → Export CSV (speaker tab) | `{name}_Speaker_Standings.csv` | Rank (blank if not eligible), Speaker, Team, Institution, Categories, Speeches, Total Score, Average Score, one `Round N` column per round |
| Standings → Export CSV (replies tab) | `{name}_Reply_Standings.csv` | As speakers, without Categories |
| Round → Draw → **Export CSV** | `{name}_{round}_Draw.csv` | Room Rank, Venue, one column per side (named with the tournament's side names; N-team debates get one column per position), Chair, Panellists, Trainees, Motion, Notes (bye, postponed). Bye rows come last |
| Results → Feedback → **Feedback CSV** (admins) | `{name}_Feedback_ADMIN_ONLY.csv` | Round, Target, Target Type, Source, Source Type, Score, Agrees With Decision, Confirmed, Ignored, Comments, one column per feedback question, Submitted At |
| Results → Feedback → **Scores CSV** (admins) | `{name}_Adjudicator_Scores_ADMIN_ONLY.csv` | Adjudicator, Institution, Base Score, Test Score, Counted Feedback, Weighted Feedback Average, Score (blended), Trainee, Independent |

Several values in one cell (panellists, categories, multi-select answers) are separated by `; `.

### Data exports page

Admin → **Data exports** (administrators only; Tabbycat's participant, availability, break-eligibility and conflict exports). File name: `{short name}_{export}.csv`. Private URL keys and passcodes are never exported; the participant files do contain email addresses.

| Export | One row per | Columns |
| --- | --- | --- |
| Teams | Team | `id`, `name`, `code_name`, `institution`, `emoji`, `seed`, `speaker1`…`speakerN`, `break_categories`, `swing` |
| Speakers | Speaker | `id`, `name`, `team`, `institution`, `email`, `gender`, `region`, `categories` |
| Adjudicators | Adjudicator | `id`, `name`, `institution`, `email`, `base_score`, `test_score`, `trainee`, `independent`, `adj_core`, `breaking`, `gender`, `region` |
| Institutions | Institution | `id`, `name`, `code`, `region`, `teams`, `adjudicators` (counts) |
| Availability | Team, adjudicator and venue | `type`, `id`, `name`, then one yes/no column per non-cancelled round. Uses the draw's rule (round availability, else check-in, with check-in expiry); venues use their general availability flag |
| Break eligibility | Team × break category where the team is eligible, has an override or meets the speaker-category rule | `team_id`, `team`, `break_category`, `eligible`, `override`, `speaker_category_rule`, `meets_rule`, `broke` |
| Conflicts | Declared conflict | `adjudicator`, `team`, `institution`, `other_adjudicator`, `type` |

The **conflicts** export uses the conflicts import's columns, so it can be edited and imported again. Records are named by name, or by email / code name / code when the name is shared. History conflicts, an adjudicator's or team's own institution and the second copy of a mutual adjudicator conflict are left out. The same file is downloaded by **Export conflicts CSV** on Setup → Conflicts.

**Gotcha:** the other participant exports are not import templates. For example `code_name` and `base_score` are not import column names (the imports use `code` and `score`), and `id`, `emoji` and `swing` are ignored on import. Team references, composite-team fields and pronouns are not in any CSV yet.

## Other files

| File | Where | Page |
| --- | --- | --- |
| DebateXML (Tabbycat-compatible archive) | Account menu → Export DebateXML archive; Tournaments hub → import | [Participants and imports](Participants-and-Imports) |
| JSON tournament backup | Account menu → Export / Restore tournament backup | [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync) |
| JSON settings file | Admin → Configuration → Format & teams → Configuration file and rules presets | [Settings reference](Settings-Reference) |
