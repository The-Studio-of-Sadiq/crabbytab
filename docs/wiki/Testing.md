# Testing

CrabbyTab's tests are [Vitest](https://vitest.dev/) unit tests. They run in Node, need no browser, no Firebase
project and no credentials, and are deterministic. This page covers how to run them, where they live, the
differential harness against Tabbycat, the translation checks, and what is not covered.

## Running the checks

The scripts in `package.json`:

| Command | What it runs |
|---|---|
| `npm run test` (or `npm test`) | `vitest run`: every `*.test.ts` file once |
| `npm run lint` | `next lint` with `.eslintrc.json` (`next/core-web-vitals`) |
| `npm run build` | `next build`, the production build |
| `npm run i18n:check` | the translation catalogue tests (see [below](#translation-checks)) |
| `npm run i18n:new -- <code>` | creates a new language catalogue from English |

Other useful commands (not scripts, run through `npx`):

```sh
npx vitest                                   # watch mode
npx vitest run src/lib/draw                  # one folder
npx vitest run src/lib/ballots/result.test.ts   # one file
npx vitest run -t "low-point"                # tests whose name matches
npx tsc --noEmit                             # full type check, tests included
```

`tsconfig.json` includes every `.ts` and `.tsx` file, so `tsc --noEmit` type-checks the tests and the `tools/`
folder too.

### Continuous integration

[`.github/workflows/ci.yml`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/.github/workflows/ci.yml)
runs on every push and pull request, on Node 22:

`npm ci` → `npm run lint` → `npx tsc --noEmit` → `npm run test` → `npm run build`

All five must pass. CI needs no Firebase project, Docker or Python.

## Setup

`vitest.config.ts`:

- `environment: "node"` (there is no DOM; nothing renders React),
- `globals: true` (`describe`, `it`, `expect` without imports, though most files import them from `vitest`),
- the `@` alias points to `src/`, as in the app.

There is no include pattern, so Vitest's default applies: every `*.test.ts` file in the repository outside
`node_modules`, including `tools/`. There are about 250 test files.

## Where tests live

Tests sit next to the code they test, named `<module>.test.ts`. The main groups:

| Folder | Covers |
|---|---|
| `src/lib/draw/` | draw generation: two-team and BP power pairing, brackets and pull-ups, conflict avoidance, minimum-cost and blossom matching, side allocation, round robin, eliminations, N teams per room, venue and adjudicator allocation, seeded reproducibility |
| `src/lib/standings/`, `src/lib/breakqual/` | standings, precedence and tie handling, break qualification rules |
| `src/lib/ballots/`, `src/lib/scoring/` | ballot validation and aggregation, winner rules, voting and individual ballots |
| `src/lib/csv/`, `src/lib/participants/`, `src/lib/registration/` | CSV import and export, participant validation, registration |
| `src/lib/publicView/`, `src/lib/seo/` | the public projection, release rules, caching, sitemap and robots rules |
| `src/lib/email/`, `src/lib/api/v1/` | email recipients and templates, the REST API |
| `src/lib/*.test.ts` | private URLs and passcodes, rate limits, staff permissions, tournament access, audit chain, security headers, Firestore rule text (below) |
| `src/features/tournament/application/` | the application commands: draws and regeneration, ballots and confirmation, breaks, round completion, live sync, cloud sync and conflicts, backups, DebateXML import and export, whole-tournament lifecycles (`lifecycle.bp.test.ts`, `lifecycle.wsdc.test.ts`) |
| `src/features/tournament/infrastructure/` | Firestore repositories against an in-memory fake, including `uploadScale.test.ts` (a synthetic 1000-team upload) |
| `src/app/api/**/` | a few route handlers, with Firebase Admin mocked |
| `src/lib/i18n/`, `tools/i18n/` | translations |
| `tools/tabbycat-diff/` | the differential test against Tabbycat |

Sample CSV files for manual testing of the import pages are in `testdata/` (institutions, teams, adjudicators,
venues, motions). No automated test uses them.

## Writing tests

[AGENTS.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/AGENTS.md) section 11 sets the expectations.
In practice:

- Test pure functions and application commands with explicit inputs. Keep tournament logic out of React components
  so it can be tested here.
- Mock external services. Commands take a repository or dependencies object; tests pass in-memory fakes or
  `vi.mock` the Firebase modules. Never require a live Firebase project.
- For anything random, pass a fixed seed and assert that the same inputs and seed give the same output.
- Test invalid and infeasible cases, not only the happy path: no feasible draw, side limits, duplicate records,
  missing results (not zero), malformed CSV, quoted fields and embedded newlines.
- Keep tests independent of execution order and of the clock; inject timestamps.
- When a test pins a Tabbycat behaviour, say so in the test name or a comment and point at the Tabbycat source.

## Differential testing against Tabbycat

`tools/tabbycat-diff/` runs the same tournaments through the official
[Tabbycat](https://github.com/TabbycatDebate/tabbycat) (v2.12.1) and through CrabbyTab's own libraries, and compares
the results rule by rule. Full documentation:
[tools/tabbycat-diff/README.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/tools/tabbycat-diff/README.md);
latest findings:
[report/REPORT.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/tools/tabbycat-diff/report/REPORT.md).

### What it compares

For each fixture, `tabbycatDiff.test.ts` imports the fixture's DebateXML with CrabbyTab's importer, applies
Tabbycat's effective preferences (from the golden file), and computes through the real libraries:

| Area | Compared |
|---|---|
| Standings | every team and speaker metric both engines compute, ranks and the reply tab, after every round. Tabbycat's `null` (no results) never equals a CrabbyTab `0`. |
| Draws | a draw for every round from the rounds before it, over eight seeds: room count, coverage, bracket composition, pull-ups, side imbalance, institution clashes, repeat pairings, side-cap violations, BP position cost and byes. Draws often have several valid answers, so they are compared by these properties, not room by room. |
| Breaks | breaking and reserve teams per category, in priority order, and break ranks |
| Adjudicator allocation | hard conflicts, chairs, panel sizes, history repeats and the sum of chair scores, using CrabbyTab's ports of Tabbycat's Voting and Consensus Hungarian allocators |

Every discrepancy must have a human verdict in `known-differences.json`: *rule difference*, *CrabbyTab defect*,
*configuration difference* or *valid alternative*. The test fails when a discrepancy has no verdict, or when the
set of discrepancies or verdicts differs from the committed `report/report.json` (something was fixed or
something regressed). It also fails if a fixture has no golden file.

Two smaller tests sit beside it: `compare.test.ts` (the comparison rules themselves) and `tieOrder.test.ts`
(given Tabbycat's fixed tie order, CrabbyTab pairs exactly Tabbycat's rooms and byes in the `twoteam-odd-ties`
fixture).

Not compared: elimination rounds, feedback, motions and venues. Debate importance is 0 on both sides.

### Fixtures and golden files

| Path | What it is |
|---|---|
| `fixtures/<name>/tournament.xml`, `config.json` | the tournament (DebateXML) plus what DebateXML cannot carry |
| `fixtures/generate.ts` | the seeded generator that writes the fixtures |
| `golden/<name>.tabbycat.json` | Tabbycat's output, committed so CI needs no Docker or Python |
| `tabbycat/` | the Tabbycat runner (`run_tabbycat.py`), `Dockerfile`, `docker-compose.yml`, `run-native.sh` |

The three fixtures are `bp-uneven` (BP, 26 teams with byes, three break categories, iron-person speeches),
`australs-voting` (Australs two-team rules, voting panels with splits, replies) and `twoteam-odd-ties` (19 teams,
wins only, many ties).

### Regenerating

All commands run from the repository root. In order:

1. **Fixtures** (only after editing `FIXTURES` in `fixtures/generate.ts`):

   ```sh
   node tools/tabbycat-diff/fixtures/generate.ts
   ```

   This runs a TypeScript file directly, so it needs a Node version with type stripping on by default (22.18 or
   later). The output is byte-identical for the same seed. Node prints a harmless `MODULE_TYPELESS_PACKAGE_JSON`
   warning.

2. **Golden files** (Tabbycat's side; after changing fixtures or the Tabbycat version). With Docker:

   ```sh
   docker compose -f tools/tabbycat-diff/tabbycat/docker-compose.yml run --rm --build tabbycat
   docker compose -f tools/tabbycat-diff/tabbycat/docker-compose.yml down -v
   ```

   Without Docker you need Python 3.11, git and the PostgreSQL binaries:

   ```sh
   PG_BIN="/c/Program Files/PostgreSQL/18/bin" tools/tabbycat-diff/tabbycat/run-native.sh
   ```

   The native script clones Tabbycat into `~/.cache/crabbytab-tabbycat-diff` (override with `TABBYCAT_DIFF_WORK`)
   and runs a throwaway local PostgreSQL cluster on port 54329, deleted afterwards. The first run takes about seven
   minutes. The committed golden files came from the native route; the Docker route has not been run yet.

3. **Report** (after reviewing a change in the discrepancies, and adding verdicts for new ones to
   `known-differences.json`):

   ```sh
   TABBYCAT_DIFF_WRITE=1 npx vitest run tools/tabbycat-diff
   ```

   This rewrites `report/REPORT.md` and `report/report.json`. Do not edit them by hand. On PowerShell, set the
   variable first: `$env:TABBYCAT_DIFF_WRITE = "1"; npx vitest run tools/tabbycat-diff`.

None of these is an npm script.

## Translation checks

`npm run i18n:check` runs `vitest run src/lib/i18n`:

- `catalogues.test.ts`: every catalogue has every English key and no unknown keys, every plural category the
  language needs, and the same `{placeholders}` and `<tags>` as English;
- `config.test.ts`: locale matching, selection order, text direction and the pre-paint script;
- `translate.test.ts`: loading, fallback, interpolation, plurals, rich text and formatting.

The same tests run in `npm test`, so adding an English string without adding the key to every other catalogue
fails CI. `npm run i18n:new -- <code>` writes `src/lib/i18n/messages/locales/<code>.json` through
`tools/i18n/newLanguage.test.ts`; in a normal test run that file only checks the template builder. See
[Languages and translations](Languages-and-Translations).

## Firestore rules

There is **no Firestore emulator setup** and the rules are not executed in CI (the emulator needs Java and
`firebase-tools`). Two tests read `firestore.rules` as text instead:

- `src/lib/liveRules.test.ts` keeps the field lists data-entry staff may write directly (live ballots, check-ins)
  equal to `ASSISTANT_LIVE_BALLOT_FIELDS` / `ASSISTANT_LIVE_CHECK_IN_FIELDS` in `src/lib/dataEntrySync.ts`;
- `src/lib/serverOnlyRules.test.ts` checks that the `serverOnly` namespace (invitations, registration, custom
  permission groups) is excluded from the administrator rule and denied to every client.

Before deploying rule changes, check them by hand in the Firebase console's Rules Playground with the cases listed
in [live-collaboration.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/live-collaboration.md#firestore-rules).

## Not covered

- No React component tests (the environment is Node, and no DOM testing library is installed).
- No end-to-end browser tests. Check UI changes by hand with `npm run dev`.
- No executed Firestore rules tests (see above).
- Tabbycat differential coverage is limited to the three fixtures and the areas listed above.

A passing build and test run do not prove tournament logic is correct or fair; add a test for the rule you changed.
