# Standings and metrics

The **Standings** page (sidebar → **Results** → **Standings**) ranks teams, speakers and, when reply speeches are scored, reply speakers. The ranking rules are set in sidebar → **Admin** → **Configuration** → **Standings rules**. Staff need the `standings.view` permission to see Standings, Break and Analytics (see [Staff and roles](Staff-and-Roles)).

Developer reference: [standings-and-breaks.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/standings-and-breaks.md). Code: `src/lib/standings/`.

## What counts

- Only **preliminary**, non-cancelled rounds. Elimination rounds never count.
- Only **confirmed**, non-discarded ballots whose teams still match the debate's teams. A ballot for a debate whose teams were changed afterwards is ignored.
- Postponed debates are skipped.
- **Byes** count only when *Bye team results* (Configuration → Draw rules) is *Award a win (no speaker scores)*. A bye win is worth **1 point** in every format (in BP that is a 3rd place), with no speaker scores or margin, as in Tabbycat.
- **BP records no wins.** As in Tabbycat, BP preliminary results never set a win, so *Wins* (and draw strength by wins) is 0 for every BP team; BP ranks on points.
- **Round weights** (Configuration → Round settings → *Points weight by round*) multiply the team points earned in that round. Wins and who-beat-whom are not weighted.
- Forfeits and results-only ballots count for the result but not for speaker scores or margins. Ghost (iron-person) speeches never count on the speaker tab.
- A drawn debate whose result is not confirmed yet still counts for **draw strength** and **pull-ups**, as Tabbycat counts every preliminary debate for those; it adds nothing else.
- **Swing teams** are not ranked (their results still count for their opponents). This is a deliberate difference from Tabbycat.

The admin Standings page is **live**: it uses every confirmed ballot as soon as it is confirmed, without waiting for the round to be completed. Public tabs are different: they use **completed** preliminary rounds only and appear only once released (see [Public pages and releases](Public-Pages-and-Releases)).

## Missing data is "no value", not zero

A metric with no data has **no value**, shown as "—", not 0. This follows Tabbycat, where sums, averages and standard deviations over no results are `NULL`, while counts are 0.

- A team with no confirmed results yet has no points, speaker scores or margins, but 0 wins.
- A speaker with no speeches has no total, average, standard deviation, trimmed mean or speech-rank sum, but 0 speeches.
- **No value ranks below every value**, whichever direction the metric ranks in, and teams with no value tie with each other. So a standard deviation of 0 is the best value, but a team with no scores ranks last on it.
- Power-pairing brackets read "no value" as 0, as Tabbycat's draw does.

## Team metrics

| Metric | Id | Better | Notes |
| --- | --- | --- | --- |
| Wins | `wins` | higher | Two-team only (always 0 in BP). |
| Points | `points` | higher | Multiplied by round weights. |
| Total speaker score | `speaks_sum` | higher | Sum of the team's totals. |
| Average speaker score (per round) | `speaks_avg` | higher | Over rounds actually spoken. |
| Average individual speaker score | `speaks_ind_avg` | higher | Per speech. |
| Speaker score standard deviation | `speaks_stddev` | **lower** | Population SD of the team's totals. |
| Total margin / Average margin | `margin_sum` / `margin_avg` | higher | Two-team only; byes, forfeits and results-only ballots excluded. |
| Draw strength (opponents' points) | `draw_strength` | higher | Opponents' round-weighted points. Tabbycat's `draw_strength`. |
| Draw strength (opponents' wins) | `draw_strength_wins` | higher | Two-team only, unweighted. |
| Draw strength (opponents' speaks) | `draw_strength_speaks` | higher | |
| Draw strength (opponents' mean rank) | `draw_strength_rank` | lower | Display only (extra column), never ranked on; "—" with no opponents. |
| 1sts / 2nds / 3rds | `firsts` / `seconds` / `thirds` | higher | BP only. |
| Times pulled up | `pullups` | higher | As in Tabbycat (more ranks higher). |
| Debates with a pull-up | `pullup_debates` | higher | Debates the team was in where some team was pulled up. |
| Who-beat-whom | `wbw` | higher | Tiebreak only; see below. |
| Votes/ballots carried | `num_adjs` | higher | Two-team only; see below. |
| Iron-person speeches | `num_iron` | **lower** | Debates in which the team gave a duplicate speech. |

**Who-beat-whom.** For each `wbw` in the precedence, teams are grouped by every metric before it. When exactly two teams share a group, each gets the points it earned against the other in preliminary debates; everyone else gets "n/a". It may appear more than once in the chain (Tabbycat's NZ Easters and Joynt presets do this) and is never offered as an extra column.

**Votes carried.** Each voting ballot contributes *votes for the team ÷ panel size × 3*, so a 4–1 win on a panel of five carries 2.4. Consensus ballots carry none, as in Tabbycat.

## Speaker metrics

| Metric | Id | Better | Notes |
| --- | --- | --- | --- |
| Total score | `speaks_sum` | higher | Substantive speeches; ghosts excluded. |
| Average score | `speaks_avg` | higher | |
| Standard deviation | `speaks_stddev` | lower | |
| Trimmed mean (high-low drop) | `speaks_trimmed_mean` | higher | Drops the *speaker score trim* highest **and** lowest scores when more than twice that many remain; otherwise the plain mean. Default trim 1 (Tabbycat's behaviour); 0 = plain mean. |
| Speeches given | `speeches_count` | higher | |
| Speech ranks (sum) | `srank` | lower | Needs speech ranks on ballots (see [Ballots and results](Ballots-and-Results)). |
| Total / average reply score | `reply_sum` / `reply_avg` | higher | |
| Reply score standard deviation | `reply_stddev` | lower | |
| Replies given | `reply_count` | higher | |
| Team points | `team_points` | higher | The speaker's team, unweighted. |
| Team wins | `team_wins` | higher | Two-team only. |
| Team 1sts / 2nds / 3rds | `firsts` / `seconds` / `thirds` | higher | BP only. |
| Team votes/ballots carried | `num_adjs` | higher | Two-team only. |

The team metrics on the speaker tab count every preliminary debate of the speaker's team, whether or not the speaker spoke in it.

The **replies tab** always ranks on the average reply score alone (Tabbycat's fixed precedence).

## Precedence (tie-breaking order)

Set in **Configuration → Standings rules**:

| Setting | Meaning |
| --- | --- |
| Team ranking precedence chain | Up to 8 metrics, most important first. Metrics that do not apply to the format are greyed out. Who-beat-whom can be repeated. |
| Extra team metrics (displayed, not ranked on) | Extra columns on the Standings page and the released public team tab. |
| Speaker ranking precedence chain | Up to 8 speaker metrics. |
| Extra speaker metrics | Extra columns, not ranked on. |
| Speaker score trim | How many scores the trimmed mean drops from each end (default 1). |
| Speeches a speaker may miss | Blank/−1 = no limit (default). Otherwise a speaker needs at least *(preliminary rounds drawn so far − limit)* speeches to be ranked. |
| Replies a speaker may miss | The same for the replies tab. |

Defaults when no chain is set:

| Standings | Default precedence |
| --- | --- |
| BP teams | Points → Total speaker score → 1sts → 2nds → 3rds |
| Two-team teams | Points → Total speaker score → Total margin |
| N teams per room | Average speaker score |
| Speakers | Total score → Average score |

Rule presets in the setup wizard may set other chains (for example British Parliamentary ends with draw strength, as in Tabbycat). The team precedence is also used for power-pairing brackets and for the break.

**Ties.** Teams or speakers level on every precedence metric share a rank (1, 1, 3). Within a shared rank they are listed by name, but the name never decides anything: the draw orders tied teams with its seeded random order, and the break refuses to split a tie at the cutoff (see [Breaks and eliminations](Breaks-and-Eliminations)).

**Speakers who missed too many speeches** stay on the tab, listed after every ranked speaker, with "—" for a rank and an *unranked* badge. Every drawn preliminary round counts towards the minimum whether or not its results are in, so with a limit set a speaker can show as unranked while a round is in progress. A round whose confirmed ballots carry no speaker scores at all (results-only) is not counted.

## Using the Standings page

1. Open **Results → Standings**. Choose the **Teams**, **Speakers** or **Replies** tab.
2. **Standings as of round** (shown once there is more than one preliminary round): *After all rounds* is the default. Choosing a round recomputes every metric from that round and earlier rounds only; the CSV export follows the selection and the liveness column is hidden. Public standings, the break and the draw always use the full standings.
3. **Category filter.** On Teams it lists break categories: the category's teams are ranked among themselves (ranks restart at 1, who-beat-whom compares teams tied within the category), as on the public break-category tabs. A general category includes every team not marked ineligible. On Speakers it lists speaker categories: the list is ranked within the category (tied speakers stay tied, unranked stay unranked).
4. **Search** filters the rows without changing ranks.
5. **Export CSV** downloads the open table (speaker categories by name); **Print** prints the page.
6. The **Public release** panel (administrators) switches public tabs and breaks on and off; see [Public pages and releases](Public-Pages-and-Releases).

Columns:

- **Teams:** rank, team, institution, points, total and average speaks, then 1sts–4ths (BP) or wins and margin (other formats), any extra metrics, per-round results, and **Break liveness** when shown.
- **Speakers:** rank, speaker (with category badges), team, institution, speeches, total, average, extra metrics, per-round scores.
- **Replies:** rank, reply speaker, team, number of replies, total, average.

## Break liveness

Before each preliminary round CrabbyTab computes Tabbycat's live / safe / dead thresholds for **every** break category, from points earned in earlier preliminary rounds:

- **Safe**: at or above the safe score (certain to break). **Dead**: at or below the dead score (cannot break). **Live**: in between.
- A general category's thresholds come from the number of non-swing teams, rounds and break size. Other categories also use their own teams' points.
- A category with a break of one team or less has no status; one with no more teams than its break makes everyone safe.
- These are strict mathematical bounds, as in Tabbycat: they ignore institution caps, overrides and teams breaking in a higher-priority category. Treat them as a guide.
- Points are raw (not multiplied by round weights), as in Tabbycat.

Where it shows, as text badges such as "Open: live":

- **Standings → Teams**: a *Break liveness* column for the next preliminary round that is not completed (hidden once all are completed, and when viewing standings as of a round).
- **Draw** page (preliminary rounds): each team's status per category, and each room's number of live team-category pairs.
- **Allocation** page → *Prioritise debates* → *By liveness*: sets room importance from the general category's thresholds (safe-only rooms 7, dead-only rooms 0, others 10). See [Adjudicator allocation](Adjudicator-Allocation).

## Analytics

**Results → Analytics** shows:

- ballot completion per round;
- a speaker score histogram over confirmed ballots (fixed 68–84 bins; scores are rounded and scores outside the range are not shown);
- side balance: average points and wins (1sts in BP) per side or position;
- motion balance per motion and round: debates, wins per side, vetoes when recorded, and a χ² p-value with a *low expected count* warning. Not shown for N-teams-per-room formats.

## Details

- **Speaker categories.** Filtering speakers uses speaker category ids (older label data resolves by name). On the public site, each *public* speaker category gets its own released tab, cut at the category's limit; private category membership is never published.
- **Draw strength by rank** is the mean standings rank of a team's opponents; it is computed from the ranking, so it can only be an extra column.
- **Tabbycat differences:** null values rank last in every precedence (Tabbycat's Python sort path, used with who-beat-whom, draw strength or `speaks_ind_avg`, counts them as 0); swing teams are not ranked; tied teams in a draw bracket are ordered by the draw's seeded random order rather than database order. See [Comparison with Tabbycat](Comparison-with-Tabbycat).
- Changed behaviour from early versions: the trimmed mean now drops from both ends (default 1); BP byes are 1 point and a 3rd, not 3 points; BP no longer counts 1st/2nd as wins; *Times pulled up* ranks more as higher.
