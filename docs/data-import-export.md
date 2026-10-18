# Data import and export

How CrabbyTab moves tournament data in and out. The logic is pure and tested:

- DebateXML export: `src/features/tournament/application/debateXml.ts`
- DebateXML import: `src/features/tournament/application/debateXmlImport.ts`
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

## CSV exports

All CSVs use PapaParse with formula escaping (cells starting with `=`, `+`, `-` or `@` are prefixed
with `'`) and a UTF-8 BOM for Excel.

| Where | File | Audience |
| --- | --- | --- |
| Standings → Export CSV | Team, speaker or reply standings (the open tab); per-round columns for speakers | Tab room |
| Draw → Export CSV | The round's draw with adjudicators and motion | Tab room |
| Feedback → Feedback CSV (admin only) | Every submission with source, comments and answers | Admins only |
| Feedback → Scores CSV (admin only) | Base, test, feedback and blended adjudicator scores | Admins only |

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
