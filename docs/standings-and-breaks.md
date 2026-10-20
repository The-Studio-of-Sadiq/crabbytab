# Standings and breaks

How CrabbyTab ranks teams and speakers and picks breaking teams, and where it follows or differs
from Tabbycat 2.x (checked against Tabbycat v2.12.1: `standings/`, `breakqual/base.py`,
`options/preferences.py`, `options/presets.py`). Code: `src/lib/standings/{calculator,metrics,precedence}.ts`
and `src/lib/breakqual/calculator.ts`.

## What counts

Only confirmed, non-discarded ballots in non-cancelled **preliminary** rounds count. A bye awarded
as a win counts as a win with no speeches. **BP records no wins** (wave 4/5): as in Tabbycat, whose
BP preliminary results leave `TeamScore.win` unset, `wins` (and the draw strength built on it) is 0
for every BP team; BP ranks on points, and `wins` / `draw_strength_wins` are offered for two-team
formats only. Before wave 4/5 a BP 1st or 2nd counted as a win. Forfeits and results-only ballots
(`speakersInBallots`) count for the result but not for speaks or margins. Ghost (iron-person)
speeches never count on the speaker tab. Team points are multiplied by the round's weight
(`Round.weight`, Tabbycat's `PointsMetricAnnotator`); wins and who-beat-whom are not. See
`results-and-ballots.md`.

## Standings as of a round

The admin Standings page has a **Standings as of round** selector (Tabbycat's admin standings are
per round). "After all rounds" is the default and is the shared tournament-wide standings. Choosing
a round computes the standings from that round and every earlier non-cancelled round only
(`calculateStandingsAsOf`, `src/lib/standings/asOfRound.ts`): debates and ballots of later rounds
are left out of every metric, CSV exports use the same rounds, and the break-liveness column is
hidden (it describes the next round from all results). Public standings, the break and the draw
always use the full standings.

## Team precedence

Teams are ranked by the configured precedence (Configuration → Standings), falling back to the
format default (BP: points, total speaks, 1sts, 2nds, 3rds; two-team: points, total speaks, total
margin). Teams level on every metric share a rank (1, 1, 3, …); within a shared rank they are
listed by name, which never decides anything (see ties at the cutoff below).

| Metric | Id | Better | Notes |
|---|---|---|---|
| Wins, points | `wins`, `points` | higher | wins: two-team only |
| Total / average speaks, average individual speaks, speaks std. dev. | `speaks_*` | higher (std. dev.: lower) | |
| Total / average margin | `margin_sum`, `margin_avg` | higher | two-team only |
| **Draw strength** (opponents' points) | `draw_strength` | higher | Tabbycat's `draw_strength`: each opponent's points, multiplied by round weights once rounds have them (`Round.weight`, default 1). Ends the British Parliamentary preset's precedence, as in Tabbycat |
| Draw strength by opponents' wins / speaks | `draw_strength_wins`, `draw_strength_speaks` | higher | wins: two-team only, unweighted |
| **Draw strength by rank** | `draw_strength_rank` | lower | mean standings rank of the opponents; display only (Tabbycat's `extra_only`), "—" with no opponents |
| 1sts, 2nds, 3rds | `firsts`, … | higher | BP only |
| Times pulled up | `pullups` | higher | Tabbycat's `npullups` is not ascending (wave 4/5 corrected this; it ranked lower first before) |
| **Debates with a pull-up** | `pullup_debates` | higher | debates the team was in where some team was pulled up (Tabbycat's `pullup_debates`) |
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
reply total, average, std. dev. (lower is better) and count. Default: total, then average.

**Team metrics on the speaker tab (wave 4/5)**, as Tabbycat's `standings/speakers.py`: team
points (`team_points`, unweighted like Tabbycat's), team wins (`team_wins`, two-team only), team
1sts/2nds/3rds (`firsts`, `seconds`, `thirds`, BP only) and votes/ballots carried (`num_adjs`,
two-team only). They count every preliminary debate of the speaker's team, whether or not the
speaker spoke in it. **Speech ranks** (`srank`) are the sum of the speaker's speech ranks, lower is better; they
need `speakerRanks` (see `results-and-ballots.md`).

**Trimmed mean (changed in wave 2).** Tabbycat's "trimmed mean (high-low drop)" leaves out a
speaker's highest *and* lowest score when they have more than two, otherwise it is the plain
mean. CrabbyTab now does the same. `speakerTrim` sets how many are dropped from *each* end
(absent = 1, Tabbycat's behaviour; 0 = plain mean). Before wave 2 it dropped only the N lowest
scores and defaulted to 0, so a tournament ranking on the trimmed mean will see different values
after upgrading; nothing stored changes.

**Eligibility** (Tabbycat's `standings_missed_debates` / `standings_missed_replies`):
`standingsMissedDebates` is the number of substantive speeches a speaker may miss and still be
ranked; absent or negative means no limit (the default). A speaker needs at least
*(preliminary rounds with results − limit)* speeches; rounds whose ballots carry no speaker scores
are not counted. Ineligible speakers stay on the tab, listed
after everyone ranked, with no rank (`ineligible: true`, `rank: 0`; shown as "—"). Only rounds
that have at least one result count, so a round in progress never makes anyone ineligible
(Tabbycat counts every preliminary round up to the tab's round). `standingsMissedReplies` does
the same for the replies tab.

## Extra columns

`teamStandingsExtra` and `speakerStandingsExtra` are calculated and shown on the admin Standings
page and the released public team and speaker tabs, but are not used to rank.

## Breaks

**Break eligibility** (*Breaks → Edit eligibility*, `/break/eligibility`, Tabbycat
`breakqual-edit-eligibility`) is a team × category checkbox grid with a "whole column" checkbox
per category (for the teams shown by the search). Changes are a draft until saved in one write;
regenerate a break for it to use them. **Breaking adjudicators** (`/break/adjudicators`) lists every
adjudicator with an inline breaking toggle (also on the feedback overview); releasing the public
list stays a separate step.

Categories are processed from highest priority down; a team breaks in at most one. Manual
overrides either force a team in ("Manually included", which takes a break place first) or
remove it (ineligible, withdrawn, different break, disqualified, lost coin toss). The
qualification rule (Standard, AIDA 1996, AIDA 2016 Australs/Easters, AIDA 2019 Australs open) then orders the remaining
eligible teams and applies any institution cap.

**AIDA 2019 Australs (open)** (`aida_2019_australs_open`, Tabbycat's `aida-2019-australs-open`,
`breakqual/aida.py`) is the AIDA 2016 Australs procedure (wins cutoff at the last breaking place,
teams below the natural cutoff capped at one per institution, reinsertion in rank order) with an
institution cap of `3 + floor(max(0, break size − 16) / 8)`: 3 up to a 23-team break, 4 for 24–31,
5 for 32–39, and so on. The break size is the category's, including manually included teams. Like
the AIDA 2016 rules it needs wins, so it is refused for BP. (WADL is not a Tabbycat break rule and
is not offered.)

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

### Eligibility and ranking within a category

As in Tabbycat (`breakqual/base.py`):

- **General categories** rank every team on the overall standings and keep overall ranks. Tabbycat
  makes every team a member of a general category when it is created and lets the tab director
  remove one; CrabbyTab does not store general membership on the team (every team is in), so a
  team is removed with the *Ineligible* override, which excludes it with the "ineligible" remark.
- **Non-general categories** rank only their own teams (teams marked eligible plus manually
  included ones) among themselves. Ranks restart within the category (the Break page heads the
  column "Category rank"), and who-beat-whom compares the teams tied *within the category*, so the
  category order can differ from the order of the same teams on the overall tab. Teams that broke
  in a higher-priority category stay in the ranking, as in Tabbycat, so the first ESL breaker can
  be ranked 2nd. Every other metric (draw strength included) is the tournament-wide value.
- **Too few eligible teams.** When fewer teams can take a place (manually included teams plus
  eligible teams with no exclusion that did not break in a higher-priority category) than the
  break size, the result carries `tooFewEligible`, the Break page shows the error and generating
  the break is refused (`break_too_few_eligible`, a hard rule), like Tabbycat's "There are too few
  teams eligible for this break category".

### Public tab limit per category

Each category has an optional **public tab limit** (`BreakCategory.limit`, Tabbycat's `limit`;
absent or 0 = none), set in the category editor. The public break category team tab shows only
teams ranked at or above it (ties at the limit are kept) and says "Showing the top N only". The
category tab lists the category's teams ranked within the category (every team not marked
ineligible for a general category).

## Break liveness

Tabbycat's live/safe/dead thresholds (`breakqual/liveness.py`, `breakqual/utils.py`) are computed
for **every** break category in `src/lib/breakqual/liveness.ts`, before a preliminary round, from
the points teams earned in the earlier preliminary rounds:

- **General categories**: from the number of (non-swing) teams, preliminary rounds and the break
  size only (`liveness_twoteam` / `liveness_bp` with `is_general`).
- **Other categories**: the general safe score is lowered when the first team outside the break
  can no longer catch the teams inside it, and a team is dead when it can no longer catch the team
  in the last breaking place (both from the category's own teams' points).
- A team is **safe** at or above the safe score, **dead** at or below the dead score and **live**
  in between. A category with a break of one team or less has no status. A category with no more
  teams than its break makes everyone safe.
- Rounds remaining are counted from the round's position among the non-cancelled preliminary
  rounds (Tabbycat uses the round's sequence number, which is the same when no round is cancelled).
- These are strict mathematical bounds: they ignore institution caps, overrides and teams breaking
  in a higher-priority category, as Tabbycat's do.

Shown as text badges ("Open: live", "ESL: safe"):

- **Standings → Teams** has a "Break liveness" column for the next preliminary round that is not
  completed (hidden once every preliminary round is completed).
- **Draw** (preliminary rounds): each team's status per category, and each room's number of live
  (team, category) pairs, Tabbycat's debate liveness.

**Prioritise debates** (Allocation page, next to the priority blend): Tabbycat's one-click
auto-prioritise, on CrabbyTab's 0–10 importance scale. *By bracket* splits the rooms into quarters by
bracket (10, 7, 3, 0). *By liveness* uses the general category's thresholds before the round: a
room whose lowest team is safe gets 7, a room whose highest team is dead gets 0, every other room
10; it needs a preliminary round and a general category. Both replace the round's importances
(after a confirmation) and are audited. The importance is the manual 20% of the allocator's
priority blend, whose own liveness component remains CrabbyTab's heuristic.

## Speaker categories in standings and breaks

Speaker categories are entities (see [data-import-export.md](data-import-export.md#speaker-categories)).

- **Standings → Speakers** filters by speaker category id (older label data resolves by name). A
  filtered list is ranked within the category, as Tabbycat's category tabs are: equal overall ranks
  stay tied and unranked speakers stay unranked. The CSV export writes category names.
- **Public speaker tab**: once the speaker tab is released, every *public* category with speakers
  gets its own view, ranked within the category and cut at the category's limit. The public data
  only carries public category ids, so membership of a private category (e.g. novice) is never
  published.
- **Break eligibility**: a non-general break category can carry a rule — every speaker, or at least
  N speakers, in a speaker category (e.g. an ESL break). The Break page shows how many teams would
  gain or lose eligibility and applies it only on confirmation, as one batch with an audit event.
  The rule is not re-applied automatically, so manual eligibility edits are kept until the next
  apply. Speakers without their own categories use the team's legacy labels.

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
WSDC (with its Style/Content/Strategy score criteria), APDA and Karl Popper (Czechia: median
scoring, individual voting ballots and self-split ballots). Each sets the team/speaker counts,
score scale and the preferences the Tabbycat preset sets that CrabbyTab supports, including side
names, motions on/off, maximum margin, reply step, speech ranks, declared winners and speaker
scores only in preliminary rounds; what it cannot apply is listed in the wizard. Not offered:
Public Speaking (six teams per room). There is no Tabbycat "Japan BP" preset; use British
Parliamentary.
