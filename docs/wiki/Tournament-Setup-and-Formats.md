# Tournament setup and formats

This page covers creating a tournament, the debate formats, Tabbycat rules presets and moving settings between tournaments. Every individual setting is listed in the [Settings reference](Settings-Reference).

## Who can create tournaments

Only **global administrators** (see [Staff and roles](Staff-and-Roles)) can create tournaments. On the Tournaments hub (`/tournaments`) they see three ways to start:

| Option | Page | Creates |
| --- | --- | --- |
| **Create a new tournament** | `/tournaments/new` | An empty tournament from the setup wizard (below). |
| *Or import a DebateXML archive (from Tabbycat or CrabbyTab)* | `/tournaments/import` | A new tournament from a DebateXML file. See [Participants and imports](Participants-and-Imports#debatexml-import). |
| *Or load a demo tournament for a rehearsal* | `/tournaments/demo` | A seeded practice tournament (BP with 24 teams, or WSDC with 16 teams). See [First tournament walkthrough](First-Tournament-Walkthrough#option-a-rehearse-with-a-demo-tournament). |

The same choices are in the tournament switcher in the top bar (*New tournament*, *Import tournament*, *Load demo tournament*). Other users see the tournaments they are assigned to.

A new tournament is saved **on this device only** ("Upload it to Firestore only when you choose to"). It reaches the cloud, the public pages, registration and other staff after the first **Upload now** (cloud status menu in the top bar).

## Supported formats

| Format | Teams per room | Speakers | Replies | Default speaker / reply scale | Default team precedence |
| --- | --- | --- | --- | --- | --- |
| British Parliamentary (BP) | 4 | 2 | No | 50–100 | Points, total speaks, firsts, seconds, thirds |
| Asian Parliamentary (UADC) | 2 | 3 | Yes | 70–80 / 35–40 | Points, total speaks, total margin |
| Australs | 2 | 3 | Yes | 70–80 / 35–40 | as UADC |
| World Schools (WSDC) | 2 | 3 | Yes | 60–80 / 30–40 | as UADC |
| Custom two-team | 2 | 3 (any 1–6) | Yes (optional) | 68–84 / 34–42 | as UADC |
| N teams per room (public speaking) | any whole number except 2 and 4 (default 6) | 1 | No | 50–99 | Average speaks |

All score steps default to 1. New tournaments start with a power-paired draw, balanced sides, no double entry, motion vetoes on, the draw / results / standings / motions public, and feedback on (1–10).

### What the format decides

- **BP** uses its own position-balancing draw (Hungarian assignment), one consensus ballot per debate (BP voting ballots are not offered), and elimination rounds where two of four teams advance.
- **Two-team formats** add voting ballots, forfeits, seeded and round-robin draws with team seeds, preallocated sides, sides chosen on the ballot (coin toss), and Tabbycat's AIDA break rules.
- **N teams per room** follows Tabbycat's scope for these counts: random and manual draws only, ballots that record scores (and, in elimination rounds, which teams advance), no side rules, and no generated elimination draws. The setup wizard creates no elimination rounds; add them later and draw them by hand. When the field does not divide evenly, a random draw puts the remainder in a short last room (or gives byes, with an automatic bye method). See [Rounds and draws](Rounds-and-Draws#n-teams-per-room).

## The setup wizard

**Create a new tournament** opens a seven-step wizard. **Next** checks each step; **Create tournament** re-checks every step.

1. **Basics** — *Tournament name* (at least 3 characters), *Short name* (optional, up to 15) and *URL slug*. The slug is suggested from the name. It must be 3–40 lowercase letters, numbers and single hyphens, must not be a reserved word (`account`, `api`, `forgot-password`, `invite`, `login`, `register`, `tournaments`, `public`, `display`, `private`, `new`, `admin`) or already used on this device, and **cannot be changed later**. It becomes the tournament's address, e.g. `/my-open-2026/public`.
2. **Format** — one of the six formats above (for *N teams per room*, also *Teams per room*), and an optional **Tabbycat rules preset** (next section).
3. **Scoring** — *Substantive speakers per team* (1–6), speaker score range and step, whether reply speeches are scored, and the reply range.
4. **Rounds** — *Number of preliminary rounds* (1–20); *Draw method*: Power-paired (Swiss), Random or Round robin; *Side allocation*: Balanced, Random, or *Chosen on the ballot* (two-team only); *Require double entry of ballots*. With power pairing, Round 1 is created as a random draw (or seeded, under the APDA preset). *N teams per room* always uses random draws and skips the side choice. Choosing round robin also turns off history and institution avoidance and sets the team import to numeric seeds, as Tabbycat's round-robin presets do.
5. **Breaks** — break categories with *Name*, *Teams that break*, *Reserve size* and *General (open) break*. Default: *Open*, 8 teams, 2 reserves. No categories means preliminary rounds only. BP break sizes must be even and at least 4.
6. **Public & feedback** — which of the draw, motions, results and standings are public; **Public information options** (Tabbycat's preset for online events: the current round's draw, break categories, results, motions and team standings); **Participant data entry** (how adjudicators and teams submit ballots and feedback: *Default*, *Private URLs*, *Public forms* or *Tab staff only*); and whether to collect adjudicator feedback, with its score range.
7. **Review** — a summary and the list of rounds that will be created.

The wizard creates the preliminary rounds plus the elimination rounds needed for the largest break: two-team ⌈log₂(break size)⌉ rounds, BP ⌈log₂(break size / 4)⌉ + 1 rounds (none for *N teams per room*). They are named Grand Final, Semifinals, Quarterfinals, Octofinals, Double and Triple Octofinals, then *Elimination N*. Break sizes that do not halve cleanly (for example 12) start with a partial elimination round in which the top seeds get byes.

Everything except the slug can be changed later under **Admin → Configuration**.

## Rules presets

A rules preset applies the settings that the Tabbycat preset of the same name sets: format, speakers, score scale, ballot mode, motion settings, draw rules, standings precedence and, for some, feedback paths and public options. Settings you edit in the wizard afterwards win.

| Preset (Tabbycat name) | Format | Highlights |
| --- | --- | --- |
| Australs (Australs Rules) | Australs | Voting ballots, motion vetoes, intermediate brackets with bubbles, slide pairing, one-up-one-down, wins then total speaks |
| British Parliamentary (British Parliamentary Rules) | BP | Consensus ballots, no motion selection, WUDC draw (Rényi entropy, exponent 4, pull-ups anywhere), 15 min preparation |
| Canadian Parliamentary | Custom two-team, 2 speakers | Consensus ballots, unscored replies, Gov/Opp, fold pairing, no conflict avoidance |
| Australian Easters | Australs, no replies | Consensus prelims, voting elims, maximum margin 15 |
| NZ Easters (2 vs 2 Impromptu) | Custom two-team, 2 speakers | Sides chosen on the ballot, who-beat-whom in the precedence |
| Joynt Scroll (3 vs 3 Prepared) | Custom two-team | Preallocated sides (public), intermediate2 brackets, who-beat-whom |
| UADC (UADC Rules) | UADC, 67–83 | Gov/Opp, teams rate every adjudicator, public feedback progress |
| World Schools (WSDC Rules) | WSDC, step 0.5 | Prop/Opp, Style/Content/Strategy score criteria, min-cost pairing with pull-ups |
| APDA (APDA Rules) | Custom two-team, 2 speakers, 15–40 | Seeded first round, byes as wins, min-cost pairing, speech ranks, seed titles on import |
| Karl Popper (Czechia) | Custom two-team, no replies | Median scoring, self-split ballots, forfeits, public feedback form, penalty-weighted draw |
| Public Speaking | N teams per room (6) | One speech each, random draws, voting ballots that record scores only, ranked on average speaks |

The full bundles are in `src/lib/setup/presets.ts`. The preset is applied once, when the tournament is created; it is not stored, so later changes are yours.

## Changing settings later

**Admin → Configuration** has six pages: *Draw rules*, *Round settings*, *Format & teams*, *Scoring & ballots*, *Standings rules* and *Public visibility*. Saving a page writes only the settings you changed on it. Changes are saved on this device; **Upload now** sends them to staff, portals and the public pages.

### Changing the format

*Format & teams* offers BP, UADC, Australs, WSDC and N teams per room (not *Custom two-team*; use one of the two-team formats and adjust speakers and replies). Switching resets teams per room, speakers per team and reply scoring to the new format's shape.

Once any live (not discarded) ballot exists, the format, teams per room, speakers per team, reply speeches, ballot mode and score criteria are **locked** ("Ballots have been entered…"). Score ranges, steps and similar scoring rules can still change, but only with a recorded reason. Change the format before the first draw: existing debates are not converted.

### Team names

*Format & teams → Team names* chooses whether teams named Tabbycat-style (a reference with the institution prefix) show their long name ("Victoria 1") or short name ("VUW 1"), refreshes names after an institution is renamed (**Update team names**), and converts existing names (**Preview conversion**). See [Participants and imports](Participants-and-Imports#team-names-references-and-prefixes).

## Configuration file and rules presets for an existing tournament

*Admin → Configuration → Format & teams → Configuration file and rules presets* (Tabbycat `exportconfig` / `importconfig`):

- **Export settings** downloads the tournament's format and preferences as a JSON file. Tournament-specific state is never included: the current round, released tabs, ballots, break categories and the schedule.
- **Load settings from a file…** checks the file (kind, version, a known format, every value of the right type) and previews the changes.
- **Rules preset → Preview preset** previews applying any preset from the table above to this tournament.

Every option shows a table of each setting that would change (*Now* / *After*). Nothing is saved until **Apply these changes** is confirmed. Settings fixed because ballots exist stay as they are and are listed; a different number of teams per room after a draw exists, or a format fixed by ballots, refuses the whole file or preset rather than applying half of another format. Settings unknown here or specific to the source tournament are skipped and listed. Participants, rounds, the schedule and releases are never changed. Upload afterwards so staff and participants get the new settings.

## Details

- **Slug reservation.** The wizard only refuses a slug already used on this device. The cloud slug registry (`tournamentSlugs/{slug}`) is claimed at the first upload, so a slug taken by another tournament in the cloud is found then. Use a distinctive slug.
- **Defaults stored at creation.** New tournaments store *Team score includes ghosts* = on, private-URL ballots waiting for the tab room, and motion vetoes on, matching Tabbycat. Older tournaments without these fields keep their previous behaviour.
- **Unsupported Tabbycat presets.** None remain; Tabbycat has no "Japan BP" preset (Japanese BP tournaments use the BP preset).
- Logic: `src/lib/setup/presets.ts`, `src/lib/setup/configTransfer.ts`, `src/components/setup/TournamentWizard.tsx`. Developer details: [`docs/data-import-export.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/data-import-export.md).

## Next

- [Participants and imports](Participants-and-Imports)
- [First tournament walkthrough](First-Tournament-Walkthrough)
