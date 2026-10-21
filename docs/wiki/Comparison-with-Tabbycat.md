# Comparison with Tabbycat

[Tabbycat](https://github.com/TabbycatDebate/tabbycat) is the established open-source tab system. CrabbyTab is an
independent project, not affiliated with Tabbycat. It follows Tabbycat's rules, algorithms and terms closely, but runs
on free serverless hosting and does its computation in the browser.

This page compares CrabbyTab on the current `beta` branch with **Tabbycat v2.12.1**. The full record, including every
audited row, is in
[`docs/tabbycat-parity-plan.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/tabbycat-parity-plan.md).

## How the comparison was made

- **Source audits.** Tabbycat v2.12.1's preferences, routes, REST API, models, management commands and algorithms were
  extracted from its source and checked one by one against CrabbyTab's code. This was done twice. The second audit was
  run by agents that had not written the fixes, had to cite code paths, and, for algorithms, ran Tabbycat's own Python
  against CrabbyTab on hand-made cases. It found about 60 bugs, which were fixed with regression tests. The rows are
  in [`docs/parity-audit/`](https://github.com/The-Studio-of-Sadiq/crabbytab/tree/beta/docs/parity-audit) (first
  audit) and [`docs/parity-audit/second-pass/`](https://github.com/The-Studio-of-Sadiq/crabbytab/tree/beta/docs/parity-audit/second-pass)
  (second audit). Statuses there are recorded *before* the fixes.
- **Differential tests.** The same tournaments are run through real Tabbycat and through CrabbyTab, and the outputs are
  compared ([below](#differential-test-harness)).

## Architecture

| | Tabbycat | CrabbyTab |
| --- | --- | --- |
| Hosting | Django + PostgreSQL server (Heroku, Docker, etc.) | Next.js on Vercel + Firebase (free tiers) |
| Where computation runs | Server | Browser: draws, allocation, standings and breaks (draws and allocation in a Web Worker) |
| Tab-room data | One shared database | A working copy in each browser. Ballots, debates, teams and adjudicators sync live between administrator devices; everything else goes up with **Upload now**. See [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync). |
| Offline | Needs the server | The tab room keeps working offline; live changes are queued and sent on reconnect |
| Public site | Rendered from the live database | A public snapshot built when you publish, cached on the CDN. See [Public pages and releases](Public-Pages-and-Releases). |

## What matches Tabbycat

Unless a difference is listed in the next section, these follow Tabbycat's behaviour and option names.

- **Formats and presets.** BP, UADC, Australs, WSDC, custom two-team, and *N teams per room* (Tabbycat's
  `teams_in_debate` other than 2 or 4). All eleven Tabbycat rules presets: Australs, BP, Canadian Parliamentary,
  Australian Easters, NZ Easters, Joynt Scroll, UADC, WSDC, APDA, Karl Popper and Public Speaking. Side names
  (Aff/Neg, Gov/Opp, Prop/Opp and others). See [Tournament setup and formats](Tournament-Setup-and-Formats).
- **N teams per room.** The same scope as Tabbycat: random and manual draws, poly ballots (ranked on totals, advancing
  teams, or scores-only voting ballots), byes; power-paired, seeded, round-robin and generated elimination draws are
  refused, as in Tabbycat. See [Rounds and draws](Rounds-and-Draws#n-teams-per-room).
- **Draws.** Two-team power pairing (odd-bracket methods, pull-up restriction, fold/slide/adjacent/random pairing,
  one-up-one-down, minimum-cost and minimum-cost-with-pull-ups), Tabbycat's Hungarian BP draw with its position costs
  and pull-up distribution, random, seeded and manual draws, Berger round robin by seed (two-team) and Tabbycat's BP
  round-robin tables, preallocated sides, sides chosen on the ballot, byes, swing teams, elimination draws with partial
  eliminations, and the draw stages *draft → confirmed → released to teams → released*. See
  [Rounds and draws](Rounds-and-Draws).
- **Adjudicators.** Tabbycat's voting and consensus Hungarian allocators (as options), conflicts of every kind,
  preformed panels including from an anticipated draw, break liveness and prioritise by bracket/liveness, feedback
  weighting, base and test scores, feedback questions and paths. See [Adjudicator allocation](Adjudicator-Allocation)
  and [Feedback](Feedback).
- **Results.** Consensus and voting ballots, per-stage ballot mode, double entry (review or blind), iron-person
  (ghost) speeches, motion selection and vetoes, forfeits, self-split ballots, results-only ballots, postponed debates,
  ballots from private URLs and public forms. See [Ballots and results](Ballots-and-Results).
- **Standings and breaks.** Tabbycat's team and speaker metrics (including who-beat-whom, ballots carried, iron-person
  count, draw strength variants, trimmed mean), standings as of a round, break categories with priority, AIDA 1996 /
  2016 / Easters rules, break ranks with ties shared, reserves and remarks, in-category ranking, speaker categories with
  public tabs, adjudicator break. See [Standings and metrics](Standings-and-Metrics) and
  [Breaks and eliminations](Breaks-and-Eliminations).
- **Public site and participants.** Public draw, results, standings, tabs, break, motions and motion statistics,
  participants, institutions, adjudication core, projector, code names, private URLs, self check-in and barcodes,
  self-registration, email notifications. See [Public pages and releases](Public-Pages-and-Releases),
  [Private URLs and portals](Private-URLs-and-Portals) and [Check-ins and availability](Check-ins-and-Availability).
- **Staff.** Tabbycat's assistant role as *data-entry staff* with permission groups (including Equity and Adjudication
  Core) and custom groups. See [Staff and roles](Staff-and-Roles).
- **REST API.** Tabbycat's v1 read and write resources, except site-wide users, global institutions, web-push
  registration and tournament listing/creation (a token belongs to one tournament). See [API and tokens](API-and-Tokens).
- **Paper ballots.** Printed ballot sheets with barcodes and a ballot intake board (Tabbycat's ballot check-ins). See
  [Printing and display](Printing-and-Display).
- **Data.** DebateXML import and export, compatible with Tabbycat archives.
- **Languages.** The same languages as Tabbycat (25 plus English). Every non-English catalogue is machine-drafted and
  marked so in the language switcher; messages from shared library code, server errors and emails are still English.
  See [`docs/internationalization.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/internationalization.md).

## Still different from Tabbycat

Deliberate differences and things left out:

| Area | Tabbycat | CrabbyTab |
| --- | --- | --- |
| Ties inside a standings tier | Ordered by database order (institution, then reference); this decides byes and pairings among tied teams | Ordered by the draw's seeded random order. Given Tabbycat's order, CrabbyTab pairs the same rooms. |
| Missing standings values | Counted as 0 on its Python sort path (who-beat-whom, draw strength, average individual speaks) | Rank last in every precedence |
| Ties at the break cutoff | All tied teams break (its code then marks them reserves, an upstream bug) | Held out; the tab director resolves them with break overrides |
| Swing teams | Left to the tab director | Excluded from standings, liveness and the break automatically |
| Elimination sides | Random, confirmed later | Default *by seed* for existing tournaments; Tabbycat's random sides are an option |
| BP voting ballots with *margin includes dissenters* | Allowed (stores no points) | Not offered; BP ballots are consensus |
| Teams-only draw release | Also listed on the public draw page, without adjudicators | Shown on team private URLs only |
| N teams per room, short last room | Consensus ballots fail | Scored on the room's own teams |
| N teams per room, anticipated draw | Brute-forces every finishing order | Rooms of more than 8 teams get no bracket range |
| Availability default | Nobody is in until checked in | Anyone without an availability record counts as available |
| Staff membership through API tokens | Writable | Not writable (a leaked token must not grant access) |
| Equity / Adjudication Core groups | Tabbycat's permission sets | Narrower: Equity cannot see participant contact details; Adjudication Core cannot edit motions, feedback questions or releases |
| Notifications | Email and browser push | Email, plus an optional SMS webhook relay; no browser push |
| Audit log | Stores IP addresses | No IP addresses (privacy); hash-chained and publicly verifiable |
| Institutions | Global | Per tournament |
| Anonymous ballot/feedback creation | Through the REST API | Through the public forms, not the REST API |
| Allocating adjudicators on a draft draw | Only after the draw is confirmed | Allowed |

Smaller gaps: CSV and API serializers do not yet carry team references, composite-team fields, pronouns or last names;
checking in a speaker through the API checks in the whole team; slug reservation is checked in the client only.

## Where CrabbyTab goes further

- **Local-first working copy** that keeps the tab room working offline, with explicit cloud sync, conflict review and
  per-record baselines ([Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync)).
- **Publish-time public snapshots** with CDN caching, so a busy public site costs few database reads.
- **Hash-chained audit log** that the public can verify, and a **rule engine** where every overridden rule needs a
  recorded reason, in the UI and the API ([Audit log](Audit-Log)).
- **Draw checks and side caps.** Exact minimum-cost random two-team draws; BP random draws that avoid institution
  clashes and balance positions; side caps enforced for every conflict-avoidance method (Tabbycat only in its graph
  mode, with a bug that checks one team's side count twice); BP eliminations from any even field.
- **Allocation.** An extra panel allocator, an optimal room allocator with hard requirements and ranked soft room
  preferences ([Venues and constraints](Venues-and-Constraints)), and a configurable trimmed mean.
- **Feedback.** More expressive feedback paths and weights per source role.
- **API tokens** scoped per tournament, stored hashed, revocable and rate-limited, with an allocate-adjudicators
  endpoint and transactional, versioned writes ([API and tokens](API-and-Tokens)).
- **A differential test harness against Tabbycat itself** (next section).

## Differential test harness

[`tools/tabbycat-diff`](https://github.com/The-Studio-of-Sadiq/crabbytab/tree/beta/tools/tabbycat-diff) runs the
same tournaments through Tabbycat v2.12.1 and through CrabbyTab's own libraries and compares the outputs by rule.

**Fixtures** (generated from a seed by `fixtures/generate.ts`, stored as DebateXML plus a `config.json`):

| Fixture | Covers |
| --- | --- |
| `bp-uneven` | BP, 26 teams with byes, Open/ESL/EFL break categories with priorities, iron-person speeches, adjudicator conflicts |
| `australs-voting` | Australs rules, uneven institutions, 3-judge voting panels with split decisions, replies |
| `twoteam-odd-ties` | Two-team, 19 teams (a bye every round), ranked on wins only (many ties, including at the break), side cap |

**What is compared.** For each fixture CrabbyTab imports the archive, applies Tabbycat's effective preferences, and
computes standings after every round, a draw for every round (eight seeds), the break for every category and an
adjudicator allocation:

- **Standings and breaks** value by value: every metric both engines compute, ranks, and breaking/reserve sets.
- **Draws and allocations** by the properties the rules constrain, because several answers can be valid: coverage,
  brackets, pull-ups, side imbalance, institution clashes, repeat pairings, side-cap violations, BP position cost and
  byes; for allocation, chairs present, hard conflicts, panel sizes and history repeats. The allocation is compared
  against CrabbyTab's ports of Tabbycat's Hungarian allocators, not CrabbyTab's own default strategy.

Every discrepancy must be classified in `known-differences.json` as a rule difference, a CrabbyTab defect, a
configuration difference or a valid alternative. A difference counts as a valid alternative only when CrabbyTab is no
worse than Tabbycat on average and in its worst seed. The latest
[report](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/tools/tabbycat-diff/report/REPORT.md) shows all
standings checks agreeing (2800/2800, 2496/2496, 2644/2644), no CrabbyTab defect and no configuration difference; the
remaining rule differences are the tie-order and break-cutoff differences above.

**Running it.** Tabbycat's output is committed as golden files, so the comparison needs no Docker or Python and runs as
part of `npm test`:

```sh
npx vitest run tools/tabbycat-diff                       # compare against the golden files
TABBYCAT_DIFF_WRITE=1 npx vitest run tools/tabbycat-diff # regenerate the report after reviewing a change
```

The test fails when a discrepancy has no verdict, or when the set of discrepancies differs from the committed report.
Regenerating the golden files needs Tabbycat itself, through Docker or a native script with Python 3.11 and
PostgreSQL; see the harness
[README](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/tools/tabbycat-diff/README.md). Limits: one
Tabbycat version; elimination rounds, feedback, motions and venues are not compared; debate importance is 0 on both
sides. See also [Testing](Testing).

## Migrating from Tabbycat

1. Export the tournament from Tabbycat as a **DebateXML archive**.
2. In CrabbyTab, as a global administrator: **Tournaments hub → Or import a DebateXML archive**. Choose the file and
   review the preview (errors block the import; warnings explain what was inferred). Set the name and slug, then
   **Create tournament from this file**. The style's rules preset is applied as Tabbycat's importer does.
3. Check the format, speaker counts and score ranges under **Admin → Configuration** (they are inferred from the
   archive), then upload.
4. Generate private URLs and re-enter emails if you need them; DebateXML carries neither.

Imported draws are drafts and motions and results are unreleased, so nothing becomes public until you release it. See
[Participants and imports](Participants-and-Imports#debatexml-import) for exactly what is read.

To go the other way, use the account menu → **Export DebateXML archive**. It uses Tabbycat's DebateXML schema, so
Tabbycat can import it. Emails, private URLs, passcodes and feedback comments are left out.
