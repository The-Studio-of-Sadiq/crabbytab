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
- `SideBadge`, which takes `preferences`.

Stored data keeps the codes AFF/NEG and OG/OO/CG/CO. The draw CSV keeps its English
"Affirmative"/"Negative" headers so the export format stays stable. Names other than aff-neg are
not translated yet.

**Motions off (`enableMotions`).** Ballots, the private portal and printed scoresheets stop asking
for the motion or vetoes. Motion management pages are unchanged.

**Round weights.** Team points from a preliminary round are multiplied by `Round.weight`. This is
Tabbycat's `PointsMetricAnnotator`, and it applies to the `points` metric and the displayed total.
Wins, speaks, firsts/seconds and who-beat-whom are not weighted. DebateXML does not carry round
weights; Tabbycat's archive has none either.

## Not done

- Karl Popper's self-declared split ballots (`allow_self_split_ballots`). This is why the Karl
  Popper preset is still not offered.
- Showing per-criterion scores on public scoresheets.
