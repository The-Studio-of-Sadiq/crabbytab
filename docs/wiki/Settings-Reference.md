# Settings reference

Every tournament setting: where to change it, its default and what it does. Settings are stored as tournament preferences (`Tournament.preferences`, type `TournamentPreferences` in `src/types/index.ts`); the debate format is stored on the tournament itself. There are 167 preferences. This page lists all of them.

- [Where settings live](#where-settings-live)
- [Saving, checks and locks](#saving-checks-and-locks)
- [Defaults and format presets](#defaults-and-format-presets)
- Configuration pages: [Draw rules](#draw-rules) · [Round settings](#round-settings) · [Format and teams](#format-and-teams) · [Scoring and ballots](#scoring-and-ballots) · [Standings rules](#standings-rules) · [Public visibility](#public-visibility)
- [Not shown in the configuration pages](#not-shown-in-the-configuration-pages)
- [Details](#details)

## Where settings live

Most settings are under **Admin → Configuration** in the sidebar (owners and admins only). It has six pages, at `/{slug}/config/{page}`:

| Sidebar entry | Page | What it covers |
| --- | --- | --- |
| Draw rules | `/config/draw` | Adjudicator allocation, team clashes, sides, two-team pairing, BP draw rules, byes |
| Round settings | `/config/rounds` | Number of preliminary rounds, feedback per round, points weight per round, deleting a round |
| Format and teams | `/config/format` | Format, speakers, reply speeches, team names, configuration file and rules presets |
| Scoring and ballots | `/config/scoring` | Score ranges, ballot rules, adjudicator feedback |
| Standings rules | `/config/standings` | Ranking precedence, extra columns, trimmed mean, eligibility |
| Public visibility | `/config/visibility` | Public pages, check-ins, language, public site options, search engines |

Some settings sit on the page where they are used (Assistants, Email, Standings, Schedule, and others). They are listed under [Not shown in the configuration pages](#not-shown-in-the-configuration-pages).

## Saving, checks and locks

- Each configuration page has a **Save tournament settings** button. It saves only the settings you changed on the page. Settings you did not touch stay as stored, and a default shown in the form is never written just because you saved.
- Saving is refused, with a message, when:
  - substantive speakers is not a whole number of at least 1;
  - a speaker, reply (when reply speeches are on) or feedback (when feedback is on) minimum is not below its maximum, or one is empty;
  - the speaker score step is not above 0;
  - the minimum adjudicator score to vote is empty;
  - the Rényi order or BP position cost exponent is below 0 or empty;
  - a custom feedback question or a score criterion is invalid.
- Every save (from these pages, other pages or the REST API's `PATCH /preferences`) is also checked against `src/lib/setup/preferenceValidation.ts`: each preference must have the right type, and an option must be one of its listed values. Ranges are given in the tables below.
- **Locks once ballots exist.** After the first ballot is entered, the format, teams per room, substantive speakers, reply speeches, ballot mode (preliminary), "Ballots ask for speaker scores" and score criteria cannot change, because existing ballots would no longer fit. The elimination ballot mode locks once the first elimination ballot is entered.
- **Scoring changes after ballots.** Changing score ranges, ghosts, margins, low-point wins, forfeits, bye results, winner declaration, aggregation, speech ranks, maximum margin, reply step or the reply-speaker rule after ballots exist raises a warning (a soft rule). Where team totals are affected, every entered ballot's totals are recalculated. See [Ballots and results](Ballots-and-Results).
- **Saved here, live after upload.** Saving changes your working copy. Public pages, private URLs and other devices only see the change after you upload to the cloud. After saving, a notice offers to upload and publish. See [Public pages and releases](Public-Pages-and-Releases).

## Defaults and format presets

The **Default** column is the value CrabbyTab uses when the setting has never been saved. The configuration pages show this value.

New tournaments do not always start with these defaults. The setup wizard writes its own values (see [Tournament setup and formats](Tournament-Setup-and-Formats)):

| Setting | Wizard value |
| --- | --- |
| Speaker and reply score ranges | By format: BP 50–100 (reply 25–50, unused); UADC and Australs 70–80, reply 35–40; WSDC 60–80, reply 30–40; custom two-team 68–84, reply 34–42; N teams per room 50–99. Step 1. |
| Team score includes ghosts | On |
| Ballots submitted through private URLs | The tab room confirms |
| Record motion vetoes | On |
| Draw method (`drawRule`) | Chosen in the wizard; always random for N teams per room |
| Public draw | "Current round only" when the wizard's public information option is on |
| Participant data entry | Private URLs, public forms, or tab staff only, as chosen (sets the private-URL and public-form switches) |
| Round robin | Avoid same institution and avoid team history off; team seed column numeric |

A **rules preset** (Tabbycat's preference presets) sets a bundle of these settings. You can pick one in the wizard or later on **Format and teams → Configuration file and rules presets**: Australs, British Parliamentary, Canadian Parliamentary, Australian Easters, NZ Easters (2 vs 2 Impromptu), Joynt Scroll (3 vs 3 Prepared), UADC, World Schools (WSDC), APDA, Karl Popper (Czechia), Public Speaking. Applying a preset shows every change before it is saved.

## Draw rules

`/config/draw`. See [Rounds and draws](Rounds-and-Draws) and [Adjudicator allocation](Adjudicator-Allocation).

### Adjudicator allocation and panel rules

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Adjudicator allocation strategy | `adjudicatorPanelStrategy` | Preset 1 (`crabbytab_v1`) | **Preset 1**: current CrabbyTab strength ranking. **Panel average** (`panel_average`): matches each voting panel's average strength to the debate's priority; the strongest member chairs. **Tabbycat voting** (`tabbycat_voting`): solo chairs in top rooms, panels of three below. **Tabbycat consensus** (`tabbycat_consensus`): spreads voters evenly. The two Tabbycat strategies ignore the panel size setting. |
| Allocate preformed panels as a unit | `usePreformedPanels` | Off | Auto-allocation places each preformed panel (Allocation → Preformed panels) whole, higher importance into higher-priority debates, skipping unavailable members. Other debates are filled normally. |
| Placing preformed panels (shown when the above is on) | `preformedPanelPlacement` | Optimised (`optimise`) | **Optimised**: match panels to debates by importance, conflicts and history. **By room rank** (`direct`): panel ranked 1 goes to the debate ranked 1, and so on, with no optimisation; conflicts are still reported. |
| Minimum adjudicator score to vote | `minAdjScoreToVote` | 1.5 | Only adjudicators at or above this score are given voting seats. Any number. |
| Adjudicator conflict penalty | `adjConflictPenalty` | 1,000,000 | Allocator cost per conflict. ≥ 0. |
| Adjudicator history penalty | `adjHistoryPenalty` | 10,000 | Allocator cost for an adjudicator seeing a team again. ≥ 0. |
| Importance mismatch penalty | `importanceMismatchPenalty` | 10,000,000 | Cost of a priority mismatch when placing preformed panels. ≥ 0. |
| Skip adjudicator check-ins | `skipAdjCheckins` | Off | All adjudicators are available in every round. |
| No panellist adjudicators | `noPanellistAdjs` | Off | Hides panellist positions and does not allocate them. |
| No trainee adjudicators | `noTraineeAdjs` | Off | Hides trainee positions and does not allocate them. |

### Team conflicts and clashes

These apply to two-team draws. BP power-paired draws ignore institutions and history, as Tabbycat and WUDC rules do.

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Avoid same institution | `avoidSameInstitution` | On | Try not to pair teams from the same institution. |
| Avoid team history | `avoidTeamHistory` | On | Try to avoid rematches, including in later random rounds. |
| Team institution penalty | `teamInstitutionPenalty` | 200 | Cost of a same-institution room for one-up-one-down and minimum-cost conflict avoidance. ≥ 0. Tabbycat's default is 1. |
| Team history penalty | `teamHistoryPenalty` | 1000 | Cost per previous meeting. ≥ 0. |
| Previously saw pull-up penalty | `previouslySawPullupPenalty` | 0 | Minimum-cost only: a room mixing brackets costs this much per earlier debate either team had with a pull-up. ≥ 0. |

### Side allocations and balancing

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Side allocations method | `sideAllocationRule` | Balanced | **Balanced**: in two-team draws the team that has been affirmative more often goes negative (ties at random); in BP, positions minimise the position cost. **Random**. **Preallocated** (two-team): sides set per round on the Draw page. **Chosen on the ballot** (`manual_ballot`, two-team only): the draw pairs teams without sides and each ballot records who took which side. |
| Sides in elimination rounds | `eliminationSideRule` | By seed | **By seed**: the higher seed takes the first side (affirmative, or OG in BP) and sides are final. **Random, confirmed later** (Tabbycat's behaviour): sides drawn with the draw's seed; in two-team formats each ballot records the sides. |
| Maximum number of times per side | `maxTimesPerSide` | 5 | Used only by minimum-cost pairing with a side balance penalty: pairings that put a team on one side more often than this are avoided. It never blocks a draw; a team past it is reported as a warning. 0 turns it off. Not used for BP. Whole number ≥ 0. |
| Maximum allowed side imbalance | `maxAllowedSideImbalance` | 0 (no limit) | Hard limit on the gap between a team's most- and least-used sides. A draw that would break it fails with an error. Whole number ≥ 0. |
| Side balance penalty | `sideBalancePenalty` | 0 | Minimum-cost only (two-team, balanced sides): cost when both teams lean to the same side. ≥ 0. |
| Pairing deviation penalty | `pairingDeviationPenalty` | 0 | Minimum-cost only: weight for straying from the pairing method. At 0 the method only breaks ties between equally clash-free pairings. ≥ 0. |

### Two-team bracket pairing and conflict avoidance

| Setting | Key | Default | Options |
| --- | --- | --- | --- |
| Pairing method | `pairingMethod` | Fold | Fold (1 v 10, 2 v 9), Slide (1 v 6, 2 v 7), Adjacent (1 v 2, 3 v 4), Fold top room then adjacent, Random within bracket |
| Conflict avoidance method | `conflictAvoidance` | One-up-one-down | One-up-one-down (swap with the room above or below); Minimum-cost matching (pull-ups chosen first); Minimum-cost matching including pull-ups (`min_cost_with_pullups`: matches the whole field at once and chooses who is pulled up, between adjacent brackets only; ignores intermediate brackets and the pull-up restriction); Off. Random rounds avoid clashes unless this is off. |
| Odd bracket resolution method | `oddBracketMethod` | Pull up the top team (`pullup_top`) | Intermediate brackets with bubble-up-bubble-down; Intermediate brackets; Intermediate brackets 1 / 2 (preallocated sides); Pull up the top / bottom / middle / a random team; Pull up the lowest draw strength by rank; Pull up the least pulled-up, then lowest draw strength by rank. The two draw-strength methods need minimum-cost matching including pull-ups. Tabbycat's default is intermediate brackets with bubble-up-bubble-down. |
| Pull-up restriction | `pullupRestriction` | No restriction | Fewest pull-ups so far; Lowest draw strength (speaks); Lowest draw strength (wins, using opponents' points as Tabbycat). Only for the pull-up methods; no effect on intermediate brackets, min-cost including pull-ups, or BP. |
| Pull-up penalty | `pullupPenalty` | 0 | **BP**: added once per previous pull-up when a team is placed above its bracket, so teams pulled up less often are preferred (set high, e.g. 100000, to outweigh position costs). **Two-team min-cost including pull-ups**: multiplied by the team's place in the odd-bracket order. ≥ 0. |

### British Parliamentary (BP) draw rules

Power-paired BP rounds assign every team to a room and position in one Hungarian assignment, as Tabbycat does.

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| BP pull-up distribution | `bpPullupDistribution` | Anywhere in bracket | Anywhere (WUDC-compliant), top room(s) or bottom room(s) of the bracket. |
| BP position cost | `bpPositionCost` | Rényi entropy | Rényi entropy; sum of squared deviations; simple (times already in the position). |
| Rényi order (BP) | `renyiOrder` | 1.0 | α for Rényi entropy (1 Shannon, 0 Hartley, 2 collision). ≥ 0. |
| BP position cost exponent | `bpPositionCostExponent` | 4.0 | The position cost is raised to this power; higher values prefer fixing a few large imbalances. ≥ 0. |
| BP assignment method | `bpAssignmentMethod` | Hungarian with preshuffling | Hungarian with preshuffling (WUDC-compliant; random among equally good draws); Hungarian without preshuffling (ties by standings order, same draw for every seed; not WUDC-compliant); Random positions within brackets. |

### Scheduling and byes

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Bye team results | `byeTeamResults` | Treat bye teams as absent | Or **Award a win** (no speaker scores) to a team that was available but sat out. |
| Bye team selection method | `byeTeamSelectionMethod` | Don't choose bye teams | With a field that does not divide evenly: lowest ranked team or random team gets the bye. |

## Round settings

`/config/rounds`. These act at once (no Save button) and change rounds, not preferences.

| Control | Effect |
| --- | --- |
| Number of preliminary rounds (0–20) + **Update round count** | Lowering it cancels the extra rounds; their ballots are kept and they come back if you raise the count. Elimination rounds are not affected. |
| Feedback by round | A switch per round (`Round.feedbackEnabled`) overriding the tournament feedback setting. An elimination round without its own value follows *Collect feedback in elimination rounds*. |
| Points weight by round | Team points earned in a round are multiplied by its weight (`Round.weight`, default 1, whole number ≥ 0). Wins, speaks and who-beat-whom are not weighted. |
| Delete an individual round | After confirmation, permanently deletes the round, its debates and ballots, and its motion assignments. |

## Format and teams

`/config/format`. See [Tournament setup and formats](Tournament-Setup-and-Formats).

### Debate format and team structure

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Parliamentary format | `format` (on the tournament) | From the wizard | BP; Asian Parliamentary (UADC); Australs; World Schools (WSDC); N teams per room. Choosing BP sets 4 teams, 2 speakers, no reply; UADC/Australs/WSDC set 2 teams, 3 speakers, reply on; N teams per room sets 6 teams, 1 speaker, no reply. The custom two-team format (from the wizard or a DebateXML import) is not offered here. Locked once ballots exist. |
| Teams per room (N teams per room only) | `teamsInDebate` | 4 (BP), 2 (two-team), 6 (N teams) | Any whole number except 2 and 4. For BP and two-team formats it is fixed by the format. Locked once ballots exist; a configuration file or preset cannot change it once a draw exists. |
| Substantive speakers per team | `substantiveSpeakers` | 2 (BP), 3 (others) | The field allows 1–5; validation accepts 1–10 (the API can store up to 10). |
| Enable reply speech scoring | `replyScoresEnabled` | Off when unset (set by the format) | Adds a reply speech per team. |

### Team names

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Teams with a reference show | `teamNameDisplay` | Long name | For teams with a reference ("1", "A"): **Long** = institution name + reference ("Victoria 1"); **Short** = institution code + reference ("VUW 1"). Saved with **Save and rename**, separately from the main Save button. |

The card also offers **Update team names** (after renaming an institution) and **Convert existing names** (Tabbycat's `convertteamnames`), both with a preview.

### Configuration file and rules presets

Not a setting: **Export settings** downloads the preferences as a JSON file; **Load settings from a file…** and **Rules preset** show a preview of every change before applying it. Settings that are locked (ballots entered, or teams per room once a draw exists) are listed and left unchanged. Tournament state never travels: the current round, release switches, released break categories and the schedule. See [CSV formats](CSV-Formats) and [data-import-export.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/data-import-export.md).

## Scoring and ballots

`/config/scoring`. See [Ballots and results](Ballots-and-Results).

### Speaker scoring parameters

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Minimum speaker score | `minSpeakerScore` | 68 | Lowest substantive score accepted. Must be below the maximum. |
| Maximum speaker score | `maxSpeakerScore` | 84 | Highest substantive score. |
| Score step increment | `stepSpeakerScore` | 1 | Allowed increments, e.g. 1, 0.5 or 0.25. Must be above 0. |
| Minimum reply score (reply on) | `minReplyScore` | 34 | Must be below the maximum. |
| Maximum reply score (reply on) | `maxReplyScore` | 42 | |

### Ballot rules and options

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Ballot introduction/explanation | `ballotIntroExplanation` | Empty | Text shown above the ballot form, e.g. the speaker scale. Up to 20,000 characters. |
| Margin includes dissenters | `marginIncludesDissenters` | Off | Voting ballots: dissenting adjudicators count towards the winning margin. Needed for voting ballots in N-teams-per-room tournaments. |
| Team score includes ghosts | `teamScoreIncludesGhosts` | Off when unset (new tournaments: on) | Duplicate (iron-person) speeches count towards the team total. |
| Require double-entry ballot verification | `ballotDoubleEntry` | Off | A ballot only counts once a second person has checked it. |
| How ballots are checked (double entry on) | `ballotCheckMode` | Review | **Review**: the checker compares with the paper ballot and confirms. **Blind**: the checker re-enters without seeing the first entry. |
| Ballots per debate, preliminary rounds (not BP) | `ballotMode` | Consensus | **Consensus**: one ballot per panel. **Voting**: one sheet per voting adjudicator; majority decides, recorded speaker scores are the majority's average, the chair breaks a tied panel. BP is always consensus. Locked once ballots exist. |
| Ballots per debate, elimination rounds (not BP) | `eliminationBallotMode` | Same as preliminary rounds | Consensus or voting for elimination rounds. Locked once an elimination ballot exists. |
| Record motion vetoes | `enableMotionVetoes` | Off when unset (new tournaments: on) | Ballots record each team's veto; vetoes appear in motion statistics. |
| Allow forfeits (two-team only) | `enableForfeits` | Off | A debate can be recorded as a forfeit: the other team wins, no speaker scores. |
| Allow motion reuse | `enableMotionReuse` | On | Motions can be reused across rounds (the round's motion panel offers other rounds' motions and a copy from the previous round). Tabbycat's default is off. |
| Deciding the winner | `winnersInBallots` | From the scores (`none`) | **From the scores**: higher total wins; totals may not tie. **Declared, as a check** (`high-points`): the declared winner must have the higher total. **Declared, to break ties** (`tied-points`). **Declared, overriding the scores** (`low-points`): low-point wins allowed. In BP these control how ranks and totals relate. Replaces the older `allowLowPointWins`. |
| Ballots ask for speaker scores | `speakersInBallots` | Always | Always; preliminary rounds only; never. Results-only debates count for points and wins but not speaks, margins or the speaker tab. Locked once ballots exist. |
| Speech ranks | `speakerRanks` | Do not rank speeches | Rank every speech independently of scores (`any`), or ranks must follow the scores (`high-points`). Consensus ballots only; adds the "Speech ranks (sum)" speaker metric. Replies are not ranked. |
| Panel score aggregation (voting, two-team) | `scoreAggregation` | Mean | Mean or median (even panels: mean rounded up) of a speech's scores. Team totals are always the mean. |
| Maximum margin (two-team) | `maximumMargin` | 0 (no limit) | Largest winning margin on one scoresheet. ≥ 0. |
| Reply score step (two-team, reply on) | `stepReplyScore` | Half the speaker score step | E.g. 1 or 0.5. Must be above 0. |
| Reply speaker must have given a substantive speech (two-team, reply on) | `requireSubstantiveForReply` | On | The last substantive speaker can never reply. |
| Side names (two-team) | `sideNames` | Affirmative, Negative | Also Government/Opposition, Proposition/Opposition, Pro/Con, Appellant/Respondent, Team 1/Team 2, Plaintiff/Prosecution/Defense. Used on ballots, the draw, printing and public pages. BP positions are not renamed. |
| Record motions on ballots | `enableMotions` | On | Off: ballots and printed scoresheets do not ask for the motion or vetoes. |
| Score criteria | `scoreCriteria` | None | Optional list (up to 20) of criteria with name (≤ 20 characters), speeches (all, substantive, reply), weight, min, max, step and required. Adjudicators score each criterion and the speech score is the weighted sum (e.g. WSDC Style/Content/Strategy). Locked once ballots exist. |

### Adjudicator feedback

See [Feedback](Feedback).

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Enable adjudicator feedback submission | `feedbackEnabled` | On | Turns feedback (and its sidebar entry) on. The settings below show only when it is on. |
| Minimum feedback score | `feedbackMinScore` | 1 | Must be below the maximum. |
| Maximum feedback score | `feedbackMaxScore` | 10 | |
| Feedback score step | `feedbackScoreStep` | 1 | E.g. 0.5 for half points. Must be above 0. |
| Important feedback threshold | `feedbackImportantThreshold` | 2 | Feedback this far from the adjudicator's base score is listed as important. ≥ 0. |
| Feedback introduction | `feedbackIntroduction` | Empty | Shown above every feedback form in the private portals. Up to 2,000 characters in the field. |
| Show unexpected feedback | `showUnexpectedFeedback` | On | Lists submissions no feedback path expected (marked ?) in feedback progress. |
| Custom feedback questions: Team feedback | `teamFeedbackQuestions` | None | Questions teams answer. Types: short text, long text, whole number box, decimal number box, integer scale, number in range, yes/no, checkbox, select one, select many. A question needs a label; select types need options; scales need min < max. |
| Custom feedback questions: Adjudicator feedback | `adjudicatorFeedbackQuestions` | None | Questions adjudicators answer about each other. |
| Feedback paths (preliminary, or all rounds) | `feedbackPaths` | Teams on the chair; chair on panellists and trainees; panellists and trainees on the chair | **Teams give feedback on**: the chair only; the orallist; any voting adjudicator allowed (orallist expected); any adjudicator allowed (orallist expected); every voting adjudicator; every adjudicator; nobody. Plus switches for chair on panellists, chair on trainees, panellists on chair, trainees on chair, panellists on each other, every adjudicator on every other, and feedback on teams (never counted in adjudicator scores). The paths decide what portals offer, what progress expects and which forms are printed. |
| Collect feedback in elimination rounds | `feedbackInEliminationRounds` | On | Default for elimination rounds' feedback switch (Round settings). |
| Use different paths in elimination rounds | `eliminationFeedbackPaths` | Off (same paths) | When ticked, a second set of paths for elimination rounds. |

## Standings rules

`/config/standings`. Metric definitions and format defaults: [Standings and metrics](Standings-and-Metrics). The precedence also drives power-pairing brackets and break qualification ([Breaks and eliminations](Breaks-and-Eliminations)).

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Team ranking precedence chain | `teamStandingsPrecedence` | Format default (shown under the editor) | Up to 8 metrics, most important first. Who-beat-whom may appear more than once. Metrics that do not fit the format are disabled. |
| Extra team metrics (displayed, not ranked on) | `teamStandingsExtra` | None | Extra columns. |
| Speaker ranking precedence chain | `speakerStandingsPrecedence` | Default chain (shown under the editor) | Up to 8 metrics. Team metrics count every debate of the speaker's team. |
| Extra speaker metrics (displayed, not ranked on) | `speakerStandingsExtra` | None | Extra columns. |
| Speaker score trim (for speaks_trimmed_mean) | `speakerTrim` | 1 | Scores dropped from **each** end for the trimmed mean (Tabbycat's high-low drop). With too few scores it is the plain average. Whole number ≥ 0. |
| Speeches a speaker may miss | `standingsMissedDebates` | -1 (no limit) | A speaker who missed more preliminary rounds (with results) than this is listed on the speaker tab but not ranked. |
| Replies a speaker may miss | `standingsMissedReplies` | -1 (no limit) | The same for the replies tab. |

## Public visibility

`/config/visibility`. Nothing is public until it is also released (per round or per item). See [Public pages and releases](Public-Pages-and-Releases).

### Public pages, check-ins and language

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Public results and scores | `publicResults` | On | Released results of non-silent rounds appear on public pages. |
| Public standings tab | `publicStandings` | On | Team and speaker leaderboards on the public pages. |
| Public motions page | `publicMotions` | On | Released motions and info slides appear publicly. |
| Public check-in counts | `publicCheckInStatus` | Off | Publishes round totals only, no names. |
| Self check-in from private URLs | `allowSelfCheckIn` | Off | Teams and adjudicators mark themselves available for the current round from their portal. See [Private URLs and portals](Private-URLs-and-Portals). |
| Check-in expiry (hours; 0 means never) | `checkInExpiresAfterHours` | 0 | Timestamped check-ins older than this stop counting. ≥ 0. |
| Room check-in expiry (hours; 0 means never) | `venueCheckInExpiresAfterHours` | 0 | Older room check-ins show as expired. ≥ 0. |
| Public pages and portals language | `publicLanguage` | Each viewer's browser language | Default language for public pages and portals. Viewers can still pick their own. Machine-drafted languages are marked. See [Languages and translations](Languages-and-Translations). |

Tabbycat difference: Tabbycat's public pages default to off. CrabbyTab's four public switches default to on, because every item also needs an explicit release.

### Draw and tabs

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Public draw | `publicDrawMode` | All released rounds (Off if the older `publicDraw` is off) | Off; current round only; all released rounds. Saving also keeps the older `publicDraw` switch in step. |
| Adjudicator tab shows | `adjudicatorTabShows` | Final (feedback-blended) score only | Base score only (`test`); final only; base, final and per-round feedback (`all`). The tab itself is released on the Standings page. |
| Team tab: top N | `teamTabLimit` | 0 (all) | Public tab shows only the top N ranks. With a limit, ranks below the cutoff cannot be worked out from published results. Whole number ≥ 0. |
| Speaker tab: top N | `speakerTabLimit` | 0 (all) | As above. |
| Replies tab: top N | `repliesTabLimit` | 0 (all) | As above. |
| Break page metrics | `publicBreakMetrics` | -1 (all) | How many precedence metrics the public break page shows; 0 none. |
| Show break categories on the participants page | `publicBreakCategories` | Off | Break eligibility on the public participants page. |
| Motions order | `publicMotionsOrder` | Earliest round first | Or latest round first. |
| Show motions in results | `showMotionsInResults` | Off | The released motion each debate used, on public results and record pages. |

### Names and anonymity

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Team code names | `teamCodeNames` | Off | Real names with code names as tooltips (`all-tooltips`); code names publicly, real names for staff (`admin-tooltips-code`); code names publicly, staff see both (`admin-tooltips-real`); code names everywhere. Code-name modes publish only the code name. |
| Speaker and adjudicator code names | `participantCodeNames` | Off | Or code names on public pages. Code names are set in the participant directory. |
| Show team institutions | `showTeamInstitutions` | On | |
| Show adjudicator institutions | `showAdjudicatorInstitutions` | On | |
| Show which adjudicators are always trainees (unaccredited) | `showUnaccredited` | Off | Adds an "Always trainee" column to adjudicator tables. |
| Show team emoji | `showEmoji` | On | |
| Show speakers in the draw | `showSpeakersInDraw` | On | |
| Show splitting adjudicators | `showSplittingAdjudicators` | Off | Marks voting adjudicators whose sheet chose the losing team. |

Below these are tools (not settings) to generate missing code names (emoji or speakers' last names) and assign missing emoji. Individual speakers and adjudicators are made anonymous in the participant directory.

### Public homepage

| Setting | Key | Default | Effect |
| --- | --- | --- | --- |
| Search engines | `searchEngineIndexing` | Allow every public page to be indexed (`all`) | Or only the public tab homepage (`homepage-only`), or no pages (`none`). Adds a `noindex` flag; search engines may ignore it, so it is not a privacy control. See [Caching, indexing and performance](Caching-Indexing-and-Performance). |
| Welcome message | `welcomeMessage` | Empty | Plain text on the public Home tab, shown while the public homepage is empty. |
| Public homepage | `publicHomepage` | Empty | Markdown for the public page's Home tab (at most 20,000 characters), with maths and YouTube embeds; HTML is removed. |
| Tournament staff | `tournamentStaff` | Empty | Plain-text credits for convenors, adjudication core and tab team. |

## Not shown in the configuration pages

These preferences are changed elsewhere, or have no control at all. "Default" is the value used when unset.

### Set on other pages

| Setting (UI label) | Key | Default | Where | Effect |
| --- | --- | --- | --- | --- |
| Data-entry staff access | `assistantAccess` | All areas | Admin → Assistants | All areas; results entry and draw display; results entry only; no access. See [Staff and roles](Staff-and-Roles). |
| Ballot submissions from adjudicators through private URLs | `privateUrlBallots` | On | Admin → Assistants | Off: private URLs no longer accept ballots. |
| Feedback submissions through private URLs | `privateUrlFeedback` | On | Admin → Assistants | Off: private URLs no longer accept feedback. |
| Ballots submitted through private URLs | `privateBallotConfirmation` | The chair confirms (new tournaments: the tab room) | Admin → Assistants | Chair: a chair's ballot counts at once. Tab room: every private-URL ballot waits for confirmation. |
| Individual ballots from every voting adjudicator | `individualBallots` | Off | Admin → Assistants | Voting rounds: each voting adjudicator submits a sheet; the latest of each is merged. Two-team voting tournaments only. |
| Allow self-split ballots for solo adjudicators | `allowSelfSplitBallots` | Off | Admin → Assistants | A solo adjudicator on a voting ballot may record a 2:1 split (Karl Popper rules). |
| Public ballot form | `publicBallotForm` | Off | Admin → Assistants (Public forms) | Adjudicators enter ballots on a public page without a private URL; these always wait for confirmation. |
| Public feedback form | `publicFeedbackForm` | Off | Admin → Assistants (Public forms) | Feedback from a public page. |
| Require the tournament password | `publicFormsUsePassword` | Off | Admin → Assistants (Public forms) | Public forms need the tournament password (stored server-side as a hash, not in preferences). |
| Draw released / Team results / Motions released / Ballot confirmed / Ballot receipts | `notifyDrawReleased`, `notifyTeamPoints`, `notifyMotionsReleased`, `notifyBallotConfirmed`, `notifyBallotReceipt` | Off | Public → Email | Automatic emails. They take effect after the next cloud upload. See [Email and notifications](Email-and-Notifications). |
| Team tab, Speaker tab, Speaker category tabs, Replies tab, All round results | `releaseTeamTab`, `releaseSpeakerTab`, `releaseSpeakerCategoryTabs`, `releaseRepliesTab`, `releaseAllResults` | Hidden (speaker category tabs follow the speaker tab when unset) | Results → Standings (Public release panel) | Public tabs over completed preliminary rounds; all results releases every completed round, silent and elimination included. |
| Participants list, Institutions list, Adjudication core, Breaking adjudicators | `publicParticipants`, `publicInstitutionsList`, `publicAdjudicatorCore`, `publicBreakingAdjudicators` | Hidden | Standings (Public release panel) | Public lists. |
| Adjudicator tab, Scoresheets, Scoresheets on team private URLs, Break category team tabs | `releaseAdjudicatorTab`, `releaseBallots`, `releasePrivateBallots`, `releaseBreakCategoryTabs` | Hidden | Standings (Public release panel) | |
| Team and adjudicator record pages | `publicRecordPages` | On | Standings (Public release panel) | |
| Pre-allocated sides, Elimination bracket, Diversity statistics, Motion veto statistics, Feedback progress | `publicSideAllocations`, `publicBracket`, `publicDiversity`, `publicVetoStatistics`, `publicFeedbackProgress` | Hidden | Standings (Public release panel) | Veto statistics also need *Record motion vetoes*. |
| Motion statistics | `motionTabReleased` | Follows *Public motions page* | Standings (Public release panel) | |
| *{category}* break | `releasedBreakCategoryIds` | None | Standings (Public release panel) | Which generated breaks are public. The panel also has **Release the tab** (Tabbycat's tab-release preset). |
| Set current round | `currentRoundId` | Latest publicly released draw | Draw page | The round public pages, the projector and portals treat as current. Never makes a draw public by itself. |
| Feedback weighting by source | `feedbackSourceWeights` | 1 for every pair | Results → Feedback | Multiplier per source (team, chair, panellist, trainee) and target (chair, panellist, trainee); ≥ 0. |
| Team seed column | `teamSeedMode` | Off | Teams CSV import dialog | Do not ask; numeric seed; seed title (Unseeded, Free, Half, Full seed). Also shapes the registration form. |
| Speaker categories | `speakerCategories` | None | Setup → Speaker categories | ESL, novice, etc. |
| Room categories | `venueCategories` | None | Setup → Venues | Category descriptions and display options. See [Venues and constraints](Venues-and-Constraints). |
| Record ranked motion preferences | `enableMotionPreferences` | Off | Setup → Motions (Motion settings) | Ballots record each team's ranked motion preferences. |
| Parallel preliminary panels: Rounds per slot | `preliminaryPanels` | 1 | Setup → Schedule | Preliminary rounds per schedule slot (Round 1 (A), Round 1 (B)…). |
| Preparation time (minutes) | `preparationTime` | Off | Setup → Schedule | Minutes from motion release to the round's start; blank turns it off (stored as -1). |
| Publish schedule | `publicSchedule` | Hidden | Setup → Schedule | Public schedule page and calendar feed. |
| Tournament schedule events | `scheduleEvents` | None | Setup → Schedule | Events with type, round, start and end. |
| Return scoresheets to / Ask adjudicators to circle each score's digits / Leave the motion blank on printed scoresheets | `ballotReturnLocation`, `ballotsConfirmDigits`, `ballotsHideMotions` | Empty / Off / Off | Print ballots page (Print options) | Empty or "TBA" hides the return location. See [Printing and display](Printing-and-Display). |
| Return feedback forms to | `feedbackReturnLocation` | Empty | Print feedback page (Print options) | |

### No control in the app

| Key | Default | Notes |
| --- | --- | --- |
| `drawRule` | Power paired | Default draw type for new rounds: power paired, random or round robin (`bracket` is a legacy value treated as random). Set only by the setup wizard. |
| `panelSizingMode` | Fixed | Fixed or by priority. The Allocation page's panel sizing choice starts from this value but does not save it; it can only be stored by a configuration file or the API. |
| `publicDraw` | On | Older on/off switch, kept in step with *Public draw* (`publicDrawMode`). |
| `allowLowPointWins` | Off | Older switch, kept in step with *Deciding the winner*; still read when `winnersInBallots` is unset. |
| `feedbackPath` | Two-way | Older preset (`chairs_to_panel`, `two_way`, `everyone`); used only when `feedbackPaths` is unset. |
| `feedbackQuestions` | None | Older single question list; used only when the team or adjudicator list is unset. |
| `repeatMatchupPenalty`, `institutionClashPenalty` | 1000 / 200 | Older names; used only when the team history / institution penalties are unset. |
| `preliminaryPanelsPerScheduleSlot` | — | Deprecated, never read; a stored value is moved into `preliminaryPanels`. |

## Details

- **Defaults in code.** The values the configuration pages show for unsaved settings come from `configFormDefaults` in `src/lib/setup/configForm.ts` and `getPublicSiteSettings` in `src/lib/publicFeatures.ts`. Validation rules are in `PREFERENCE_RULES` (`src/lib/setup/preferenceValidation.ts`); text fields allow 20,000 characters (welcome message, staff credits, ballot introduction, feedback introduction) or 500 (return locations).
- **Tabbycat differences** in defaults: team institution penalty 200 (Tabbycat 1); odd brackets pull up the top team (Tabbycat intermediate with bubble-up-bubble-down); motion reuse on (Tabbycat off); elimination sides by seed (Tabbycat random, available as an option); public switches on (Tabbycat off, but CrabbyTab also requires a release). BP ballots are always consensus, so Tabbycat's BP voting with margins including dissenters is not offered. See [Comparison with Tabbycat](Comparison-with-Tabbycat) and [tabbycat-parity-plan.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/tabbycat-parity-plan.md).
- **Per-round settings** live on the round rather than the tournament: draw type, feedback switch, points weight, silent round, preallocated sides, preformed panels and seed. See [Rounds and draws](Rounds-and-Draws) and the [Data model](Data-Model).
- **API.** Preferences can also be read and changed through the REST API (`PATCH /tournaments/{slug}/preferences`, a partial update where `null` restores a default) with the same validation and the same save rules. See [API and tokens](API-and-Tokens).
- In-repo references: [draw-generation.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/draw-generation.md), [adjudicator-allocation.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/adjudicator-allocation.md), [results-and-ballots.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/results-and-ballots.md), [standings-and-breaks.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/standings-and-breaks.md), [public-pages-and-notifications.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/public-pages-and-notifications.md), [staff-access.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/staff-access.md), [rounds-schedule-and-motions.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/rounds-schedule-and-motions.md), [tournament-rules-enforcement.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/tournament-rules-enforcement.md).
