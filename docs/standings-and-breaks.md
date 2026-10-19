# Standings and breaks

How CrabbyTab ranks teams and speakers and picks breaking teams, and where it follows or differs
from Tabbycat 2.x (checked against Tabbycat v2.12.1: `standings/`, `breakqual/base.py`,
`options/preferences.py`, `options/presets.py`). Code: `src/lib/standings/{calculator,metrics,precedence}.ts`
and `src/lib/breakqual/calculator.ts`.

## What counts

Only confirmed, non-discarded ballots in non-cancelled **preliminary** rounds count. A bye awarded
as a win counts as a win with no speeches. Forfeits count for the result but not for speaker-score
averages. Ghost (iron-person) speeches never count on the speaker tab.

## Team precedence

Teams are ranked by the configured precedence (Configuration → Standings), falling back to the
format default (BP: points, total speaks, 1sts, 2nds, 3rds; two-team: points, total speaks, total
margin). Teams level on every metric share a rank (1, 1, 3, …); within a shared rank they are
listed by name, which never decides anything (see ties at the cutoff below).

| Metric | Id | Better | Notes |
|---|---|---|---|
| Wins, points | `wins`, `points` | higher | |
| Total / average speaks, average individual speaks, speaks std. dev. | `speaks_*` | higher (std. dev.: lower) | |
| Total / average margin | `margin_sum`, `margin_avg` | higher | two-team only |
| Draw strength by opponents' wins / speaks | `draw_strength_wins`, `draw_strength_speaks` | higher | |
| 1sts, 2nds, 3rds | `firsts`, … | higher | BP only |
| Times pulled up | `pullups` | lower | |
| **Who-beat-whom** | `wbw` | higher | see below |
| **Votes/ballots carried** | `num_adjs` | higher | two-team only |
| **Iron-person speeches** | `num_iron` | lower | debates in which the team had a duplicate speech |

**Who-beat-whom** (Tabbycat's `WhoBeatWhomMetricAnnotator`): for each `wbw` in the precedence,
teams are grouped by every metric before it (earlier `wbw` values included). Where exactly two
teams share a group, each gets the points it earned in preliminary debates against the other;
everyone else gets "n/a". It may appear more than once (Tabbycat's NZ Easters and Joynt presets
use `wins, wbw, speaks_sum, wbw, draw_strength, wbw`). It is never offered as an extra column.

**Votes carried** (Tabbycat's `num_adjs`): each voting ballot contributes
`votes for the team ÷ panel size × 3`, so a 4–1 win on a panel of five carries 2.4. Consensus
ballots record no votes and carry none, as in Tabbycat.

## Speaker precedence

Speaker metrics: total, average, std. dev. (lower is better), **trimmed mean**, speeches given,
reply total and average. Default: total, then average.

**Trimmed mean (changed in wave 2).** Tabbycat's "trimmed mean (high-low drop)" leaves out a
speaker's highest *and* lowest score when they have more than two, otherwise it is the plain
mean. CrabbyTab now does the same. `speakerTrim` sets how many are dropped from *each* end
(absent = 1, Tabbycat's behaviour; 0 = plain mean). Before wave 2 it dropped only the N lowest
scores and defaulted to 0, so a tournament ranking on the trimmed mean will see different values
after upgrading; nothing stored changes.

**Eligibility** (Tabbycat's `standings_missed_debates` / `standings_missed_replies`):
`standingsMissedDebates` is the number of substantive speeches a speaker may miss and still be
ranked; absent or negative means no limit (the default). A speaker needs at least
*(preliminary rounds with results − limit)* speeches. Ineligible speakers stay on the tab, listed
after everyone ranked, with no rank (`ineligible: true`, `rank: 0`; shown as "—"). Only rounds
that have at least one result count, so a round in progress never makes anyone ineligible
(Tabbycat counts every preliminary round up to the tab's round). `standingsMissedReplies` does
the same for the replies tab.

## Extra columns

`teamStandingsExtra` and `speakerStandingsExtra` are calculated and shown on the admin Standings
page and the released public team and speaker tabs, but are not used to rank.

## Breaks

Categories are processed from highest priority down; a team breaks in at most one. Manual
overrides either force a team in ("Manually included", which takes a break place first) or
remove it (ineligible, withdrawn, different break, disqualified, lost coin toss). The
qualification rule (Standard, AIDA 1996, AIDA 2016 Australs/Easters) then orders the remaining
eligible teams and applies any institution cap.

### Ties at the cutoff

When teams level on every precedence metric (the same tab rank) straddle the last breaking place,
or the last reserve place, the result reports them in `cutoffTies` (`cutoff: "break" | "reserve"`,
the tied teams, and how many places they share). This applies under every qualification rule,
after the institution cap (a capped team is never part of a tie).

- Tabbycat lets every tied team through (the break grows past its size) and leaves it to the tab
  director. CrabbyTab instead **holds the whole tied group out** of the break (or reserves) and
  **refuses to generate the break** (`break_cutoff_tie` / `reserve_cutoff_tie`, a hard rule)
  until the tab director resolves it. It never settles a tie by name or any other arbitrary order,
  and never makes a break larger than its configured size, which the elimination bracket depends on.
- Resolve it with overrides: *Manually included* for the team(s) that go through (the others stay
  in the running for reserve places), or *Lost coin toss* for the others (removes them from the
  category).
- Reserve places after a tied group are counted from the end of the group, as Tabbycat does: a
  break of 3 + 2 reserves with three teams tied for 2 places leaves one reserve place.

The Break page lists the tied teams with a "Tied" status and explains how to resolve it; the
Generate button stays disabled until it is resolved.

## Ballot mode per stage

Like Tabbycat's `ballots_per_debate_prelim` / `ballots_per_debate_elim`, two-team tournaments can
use consensus or voting ballots separately for preliminary and elimination rounds. `ballotMode`
is the preliminary mode and the default for both stages; `eliminationBallotMode` overrides it for
elimination rounds. Read it only through `ballotModeFor(round, { format, preferences })` in
`src/lib/ballots/result.ts`. BP is always consensus. `ballotMode` is locked once any ballot
exists; `eliminationBallotMode` only once an elimination ballot exists.

## Presets

The tournament wizard offers Tabbycat's rule presets (`RULES_PRESETS` in
`src/lib/setup/presets.ts`): Australs, British Parliamentary, Canadian Parliamentary, Australian
Easters, NZ Easters (Tabbycat's "2 vs 2 Impromptu"), Joynt Scroll ("3 vs 3 Prepared"), UADC and
WSDC. Each sets the team/speaker counts, score scale and the preferences the Tabbycat preset sets
that CrabbyTab supports; what it cannot apply is listed in the wizard. Not offered: APDA (needs
speech ranks and winner selection), Public Speaking (six teams per room), Karl Popper (median
aggregation and self-split ballots). There is no Tabbycat "Japan BP" preset; use British
Parliamentary.
