# Results and ballots

How a ballot turns into a result. These rules were checked against Tabbycat v2.12.1:
`results/result.py`, `results/scoresheet.py`, `results/forms.py`, `options/preferences.py` and
`standings/`. Code:

- `src/lib/ballots/ballotRules.ts` reads each preference and gives its default.
- `src/lib/ballots/result.ts` does aggregation, validation and assembly.
- `src/lib/sideNames.ts` holds the side names.
- `src/lib/standings/` covers the effects on standings.

Every ballot path uses the same logic: tab-room entry, data-entry assistants, the private-URL
portal (`src/lib/privateBallot.ts`, re-validated on the server), and the simulated ballots in tests.

## Settings

All settings are under **Settings → Scoring & Ballots**. A setting that was never set keeps the
behaviour CrabbyTab had before it existed.

| CrabbyTab | Tabbycat | Default |
| --- | --- | --- |
| `winnersInBallots` | `winners_in_ballots` | `allowLowPointWins` on gives "low-points"; otherwise "none" |
| `speakersInBallots` | `speakers_in_ballots` | "always" |
| `speakerRanks` | `speaker_ranks` | "none" |
| `scoreAggregation` | `score_aggregation_function` | "mean" |
| `scoreCriteria` | `ScoreCriterion` | none |
| `maximumMargin` | `maximum_margin` | 0, meaning no limit |
| `stepReplyScore` | `reply_score_step` | half the speaker score step (CrabbyTab's earlier rule) |
| `requireSubstantiveForReply` | `require_substantive_for_reply` | on |
| `sideNames` | `side_names` | "aff-neg" |
| `enableMotions` | `enable_motions` | on |
| `Round.weight` | `Round.weight` | 1, edited under Settings → Round Settings |

## Deciding the winner (`winnersInBallots`)

These rules match Tabbycat's scoresheet classes, for every scoresheet, voting sheets included.

- **none**: the higher total wins and tied totals are invalid. The entry form shows the winner it
  reads from the scores, and saved ranks always follow the totals (`effectiveRanks`).
- **high-points**: a winner is declared and must have the higher total. Ties are invalid.
- **tied-points**: a winner is declared. Equal totals are allowed, but the declared winner may not
  have the lower total.
- **low-points**: the declared winner wins whatever the scores.

On voting ballots each adjudicator's sheet votes, in the same way, for its own declared winner.
The portal ballot an adjudicator submits becomes their declared winner when the tab room uses
"Fill from private-URL ballots".

`allowLowPointWins` is deprecated. It is still read when `winnersInBallots` is absent, and the
settings form keeps it in step (on only for "low-points").

**BP.** Tabbycat does not support declared winners in BP; it ranks BP teams by total and rejects
tied totals. CrabbyTab does the same for "none" and "high-points". This is a change: CrabbyTab
used to accept tied BP totals. The other two modes are CrabbyTab extensions:

- "tied-points" lets the entered ranks order teams that have equal totals.
- "low-points" (the old `allowLowPointWins`) accepts any ranks.

## Ballots without speaker scores (`speakersInBallots`)

- "prelim" drops speaker scores from elimination-round ballots, as Tabbycat's `get_result_class`
  does.
- "never" drops them from every ballot.

A results-only ballot records:

- two-team: the winner, or each adjudicator's declared winner on voting ballots;
- BP: the ranks. Tabbycat's scoreless BP prelim ballot records no points, so CrabbyTab records the
  ranks instead.

It is stored with `noSpeakerScores: true`. Team totals are stored as 0 but mean "no score", and no
margin is stored.

Standings treat such a ballot like a forfeit, matching Tabbycat's null `TeamScore.score`:

- points and wins count;
- team speaks averages, margin sums and averages, and the speaker tab leave the debate out.

**Speeches missable.** Tabbycat counts every preliminary round towards "speeches missable", so one
results-only round makes every speaker ineligible. CrabbyTab counts only rounds that have speaker
scores.

## Speech ranks (`speakerRanks`) and the `srank` metric

Consensus ballots that have speaker scores rank every substantive speech in the debate from 1 to
the number of speeches. Ranks may not tie. With "high-points", a higher score may never be ranked
below a lower one; equal scores may be ranked either way. This is Tabbycat's `ranks_high` check.

Voting ballots have no ranks, as in Tabbycat.

**Deviation: reply speeches are not ranked.** Tabbycat asks for a rank on reply speeches as well,
but its `srank` metric never reads it.

**`srank`** is the sum of a speaker's ranks over their counted substantive speeches. A lower sum
ranks higher. A speaker with no ranked speeches gets 0, as Tabbycat sorts a missing sum.

DebateXML has no attribute for speech ranks, so they are not exported or imported.

## Panel aggregation (`scoreAggregation`)

On voting ballots each speech's score combines the scores of the "relevant" adjudicators:

- with `marginIncludesDissenters` on, the whole panel;
- otherwise, the majority.

The combination is one of:

- **mean**: exact, never rounded to 0.01 (see PR #43);
- **median**: Tabbycat's `median_or_rounded_up_mean`. An odd panel takes the median; an even panel
  takes the mean rounded up to a whole number (75 and 76 give 76).

Team totals and margins are always the mean of the relevant sheets' own totals, whichever
aggregation is chosen. This is how Tabbycat computes `TeamScore.score`.

**Fixed: dissenters.** CrabbyTab used to average speaker scores and team totals over the majority
even when `marginIncludesDissenters` was on. They now come from the whole panel, as in Tabbycat.

## Score criteria (`scoreCriteria`)

Each criterion has:

- a name;
- the speeches it applies to: all, substantive or reply;
- a weight;
- a minimum, maximum and step;
- whether it is required. An optional criterion left blank counts as 0.

Adjudicators score each criterion. A speech's score is Σ weight × criterion score, and only the
criterion scores are range-checked, as in Tabbycat.

On voting ballots each criterion is aggregated separately and the speech score is their weighted
sum. With medians this differs from the median of the sheet totals, exactly as Tabbycat stores it.

Criteria change the shape of a ballot, so they are locked once ballots exist. The WSDC preset
installs Tabbycat's WSDC criteria.

## Other ballot rules

**Maximum margin.** In two-team formats, no scoresheet may have a margin above `maximumMargin`.
This is checked per adjudicator on voting ballots.

**Reply speeches.**

- Reply scores use `stepReplyScore`.
- The last substantive speaker never replies.
- With `requireSubstantiveForReply` (the default), the reply speaker must also have given a
  counted substantive speech.
- With it off, any other speaker on the team may reply.
- **Change:** because the last speaker may not reply, an iron person who gave the last speech
  cannot reply either, as in Tabbycat. CrabbyTab used to allow this.

**Side names.** `sideLabel(side, preferences, kind)` is the one helper for every side label:

- ballot entry, the private portals, printed ballots, results and dashboard tables, analytics, the
  public draw and the projector display;
- `SideBadge`, which takes `preferences`;
- the public veto statistics, side-allocations page, scoresheets and team record pages, the admin
  team record, the draw setup panel and the side pre-allocation grid (`translatedSideName`).

Stored data keeps the codes AFF/NEG and OG/OO/CG/CO. The draw CSV headers use the tournament's
side names (unchanged "Affirmative"/"Negative" for the default aff-neg). Names other than aff-neg are
not translated yet.

**Motions off (`enableMotions`).** Ballots, the private portal and printed scoresheets stop asking
for the motion or vetoes. Motion management pages are unchanged.

**Round weights.** Team points from a preliminary round are multiplied by `Round.weight`. This is
Tabbycat's `PointsMetricAnnotator`, and it applies to the `points` metric and the displayed total.
Wins, speaks, firsts/seconds and who-beat-whom are not weighted. DebateXML does not carry round
weights; Tabbycat's archive has none either.

## Self-split ballots (`allowSelfSplitBallots`)

Tabbycat's `allow_self_split_ballots` (Karl Popper rules), set on the Staff page. A solo
adjudicator may declare their decision a 2:1 split. It applies only to a two-team voting ballot of
a debate with exactly one voting adjudicator (trainees do not count), as in Tabbycat
(`selfSplitAllowed` in `src/lib/ballots/result.ts`).

- The tab-room ballot page shows **This was a 2:1 split decision (self-declared)** under the
  voting sheet. The ballot stores `selfSplit: true`. The winner is recorded with 2 votes and the
  loser with 1. Scores, winner and margin do not change.
- In standings, such a ballot counts 3 possible votes (`ballotVotesPossible`), so `num_adjs`
  credits the winner 2/3 and the loser 1/3 of a panel, as Tabbycat's
  `teamscore_field_votes_given/possible` does.
- With *Show splitting adjudicators* on, the public site marks the solo adjudicator as splitting.
- Validation rejects a declared split when the setting is off, the panel has more than one voting
  adjudicator, or the round uses consensus ballots. Double-entry comparison reports a changed
  declaration.
- **Private URLs:** the checkbox appears for a debate's only voting adjudicator, whose sheet
  becomes the voting ballot (merged with individual ballots, or directly without them; see
  `staff-access.md`). The sync route checks the flag again and refuses it otherwise. *Fill from
  private URLs* carries a solo adjudicator's split over.
- Turning the setting off does not change ballots already saved.

## Confirming a ballot

As in Tabbycat (`Submission.save`, `BallotSetForm.save`), confirming a version only **unconfirms**
the debate's previously confirmed version; drafts and other versions are kept as they are (before,
every other version was discarded). A double-entry check that confirms a re-entry discards the
entry it checked (`checksVersion`), which it replaces. Only versions newer than the confirmed
result count as waiting for a check (`resolveCheckState`, `pendingBallots`). Confirming records
the confirmer (`confirmedBy` / `confirmedById`).

## The panel's casting vote

A voting panel split evenly is decided by the chair's sheet, as in Tabbycat. With no chair sheet
the result is refused ("the chair's scoresheet is missing"): Tabbycat has no result until every
voting adjudicator's sheet, the chair's included, is in. Before, the first sheet decided.

## Recalculating stored ballots (Tabbycat `resaveballots`)

Team totals, margins and voting aggregates are stored on each ballot when it is entered. When a
setting that feeds them changes after ballots exist (`teamScoreIncludesGhosts`,
`marginIncludesDissenters`, `scoreAggregation`; `STORED_TOTAL_PREFERENCES` in
`src/lib/ballots/resave.ts`), saving the settings needs the tab director's confirmation (the
"scoring changed after ballots" rule says the totals will be recalculated) and then recalculates
every live ballot under the new setting, updates the debates' cached totals and records a
`ballots.resaved` audit entry listing the ballots changed, those whose **result** changed (a
total-decided winner can flip) and those skipped (forfeits, results-only ballots, adjudicators'
own individual sheets, and ballots whose shape no longer fits the round's ballot mode). The REST
API's settings route does not recalculate yet.

## Rehearsal results (Tabbycat `generateresults`)

Simulated ballots satisfy every ballot rule in force: speech ranks (by score), score criteria,
declared winners on voting sheets (the higher total), the reply step (`stepReplyScore`) and the
validator's default score ranges. Before, such debates were skipped.

## N teams per room (`format: "poly"`)

Rooms with a team count other than 2 or 4 follow Tabbycat's poly result classes
(`results/result.py` `get_result_class` and `results/scoresheet.py`). A ballot covers the
debate's own positions, so a short last room (see draw-generation) is scored on its own teams.

| Ballot | Tabbycat class | What is recorded |
|---|---|---|
| Consensus with speaker scores | `ConsensusDebateResultWithScores` + `PolyScoresheet` | Teams are ranked on their totals, highest first; tied totals are refused. Points = teams in the room − rank (5 … 0 for six teams). Nobody "wins" (`win: false`) and there is no margin. Entered ranks and `winnersInBallots` are ignored: ranks always follow the totals. |
| Consensus without speaker scores (`speakersInBallots`) | `ConsensusDebateResult` + `PolyEliminationScoresheet` | The ballot names the advancing teams: exactly two, or one in the tournament's last round. They are stored with `win: true`; no points or ranks. A room with fewer teams than must advance is refused. |
| Voting (one sheet per adjudicator) | `DebateResultByAdjudicatorWithScores` + `PolyNoWinScoresheet` | Allowed only with *margins include dissenters* on (Tabbycat raises an error otherwise; CrabbyTab refuses the ballot with that reason). Scores only: each speech is the panel's mean or median (criteria aggregated separately), each team total the mean of the sheets' totals; no ranks, points, winner or votes, and totals may tie. Voting ballots without speaker scores are refused (Tabbycat has no form for them). |

Where Tabbycat stores no points (`None`), CrabbyTab stores 0, which standings treat the same.
Forfeits and self-split ballots are two-team only. Through private URLs each adjudicator's sheet
in a voting round records scores only (`polyScoresOnly`) and individual ballots merge into the
score-only voting ballot. Elimination rooms advance their declared teams, or the top two by rank
(one in the final) on a scored ballot; a score-only voting ballot cannot decide who advances and
is refused for that. Standings add the points each room's rank earned; wins count only advancing
teams; the format's default team precedence is average speaks (Tabbycat's Public Speaking
preset, and its default precedence with wins always 0). As in Tabbycat, the 1sts/2nds/3rds
metrics count rooms worth 3, 2 and 1 points. Motion statistics are not computed for these
tournaments (Tabbycat computes none). DebateXML archives of these tournaments carry every
team of a room; importing an archive whose largest room is neither 2 nor 4 teams creates an
N-teams-per-room tournament.

The *Public Speaking* rules preset is Tabbycat's: six teams, one speech each (50–99), voting
ballots with margins including dissenters, results-only elimination ballots, side names
"Team 1, Team 2", no motions or vetoes, no institution or history avoidance, standings on average
speaks, and random preliminary draws.

## Not done

- Showing per-criterion scores on public scoresheets.
