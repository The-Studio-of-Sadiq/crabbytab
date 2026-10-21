# Draw generation

How CrabbyTab draws preliminary rounds. The code is in `src/lib/draw/`; the entry point
is `generateRoundDraw` in `generator.ts`. The algorithms follow Tabbycat's draw
generators (`tabbycat/draw/generator/`); differences are listed at the end.

## Reproducibility

Every random choice (shuffles, random pull-ups, tie-breaks, bye selection) goes through
one seeded random source (`rng.ts`). Generating a draw records the seed on the round
(`Round.drawSeed`) and in the audit log, so the same inputs and seed reproduce the same
draw.

## Running in the background

Draw generation and adjudicator auto-allocation run in a Web Worker
(`src/features/tournament/compute/`), so the page stays responsive on large fields (a
1000-team BP round takes 1–3 s to draw). The worker gets the same plain inputs, including
the seed, so the result is identical to computing on the page; where a worker cannot start
(no Worker support, a blocked script) the same code runs on the page instead. While a job
runs, the Draw and Allocation pages show what is running, for how long, and a **Cancel**
button, which stops the worker and saves nothing. The organiser can keep working meanwhile:
the result is saved on top of the current records, and if the round itself (its settings,
debates or ballots) changed while computing, nothing is saved and the page asks to try
again. Progress is reported as elapsed time, not as a percentage: the algorithms do not
know in advance how long they will take.

## Ranking and brackets

Teams are ranked by the team standings. Teams that share a standings rank, and teams with
no standing yet, are shuffled with the seeded random source, as Tabbycat breaks draw ties
at random. Brackets group teams by the first metric of the team-standings precedence, as
Tabbycat's draw managers do (`team.points` is the first precedence metric). With the default
precedence that is team points, so round weights and points for byes shape the brackets; a
tournament whose precedence starts with wins is bracketed by wins. A team without a value
counts as 0. This applies to two-team and BP power pairing.

A room's `pulledUp` teams are those in a lower bracket than the best team in the
room. The generator stores this on each debate slot. Standings count it as the `pullups`
metric (more ranks higher, as Tabbycat's `npullups`) and every team in such a room in the
`pullup_debates` metric. The draw history counts pull-ups and pull-up debates for later rounds.

## BP power pairing

Tabbycat's `BPHungarianDrawGenerator`:

1. **Rooms.** Walking down from the top bracket, each bracket is completed to a multiple of
   four with teams from the bracket below. If the whole lower bracket is needed, the two
   merge. `bpPullupDistribution`:
   - `anywhere` (WUDC): pulled-up teams may go into any room of the bracket.
   - `top` / `bottom`: they are confined to the top or bottom ⌈k/4⌉ rooms of the bracket,
     where k is the number of teams from below. `bottom` matches Tabbycat's `one_room`.
2. **Costs.** Each team × (room, position) slot costs `C(position)^exponent`, plus
   `pullupPenalty × previous pull-ups` when the room's bracket is above the team's points.
   Slots in a room whose bracket does not allow the team's points are forbidden.
   - Rényi entropy: `C = n·(2 − H_α(p))`, with p the team's position distribution after
     this round, n its number of rounds, and entropy in bits (α = 1 Shannon, α = 0 Hartley).
   - Variance (stored as `sum_squared_deviations`): Tabbycat's "variance" option, the population
     variance Σ (count − mean)² / 4 of the four position counts after this round (until this
     release CrabbyTab used 4 × that, which re-weighted it against the pull-up penalty).
   - Simple (`simple`): the number of times the team has already held that position
     (Tabbycat's `_position_cost_simple`, before this round).
3. **Assignment.** One Hungarian assignment over all teams and slots. The cost matrix is
   shuffled first (`bpAssignmentMethod: "hungarian"`, Tabbycat's `hungarian_preshuffled`), so
   equally good draws are chosen at random. `hungarian_unshuffled` (Tabbycat's `hungarian`, not
   WUDC-compliant) skips the shuffle: rows are teams in standings order and columns rooms then
   positions, so ties are settled by that order and the draw is the same for every seed. With
   `bpAssignmentMethod: "random"` or random sides, position costs are dropped and teams are
   placed at random within their brackets.

The result is a minimum-cost assignment for these costs. BP power pairing does not consider
institution or history clashes, as in Tabbycat and the WUDC rules.

## Two-team power pairing

1. **Odd brackets** (`oddBracketMethod`):
   - `pullup_top` / `pullup_bottom` / `pullup_middle` / `pullup_random`: an odd bracket
     takes one team from the next bracket down. Middle is the exact middle, or one of
     the two middle teams at random. `pullupRestriction` first narrows the candidates to
     the teams with the fewest pull-ups, or the lowest draw strength by wins or speaks
     ("wins" reads `draw_strength`, opponents' points, as Tabbycat's `lowest_ds_wins` does).
   - `pullup_lowest_ds_rank` / `pullup_lowest_ds_rank_npulls`: only with
     `min_cost_with_pullups` (below); any other conflict avoidance refuses them, as in Tabbycat.
   - `intermediate`: the bottom team of an odd bracket and the top team of the next
     bracket form an intermediate bracket, labelled the lower bracket + 0.5 (Tabbycat
     `points+0.5`, also when a points level in between is empty: 3 and 1 give 1.5).
   - `intermediate_bubble`: intermediate brackets, then each intermediate debate with a
     history or institution clash tries to swap its higher team with the bottom team of
     the bracket half a point above ("bubble up"), else its lower team with the top team of
     the bracket half a point below ("bubble down"). A swap is accepted only if the new
     intermediate pairing is clean. When a points level is empty there is no bracket half a
     point above, so only bubbling down is possible, as in Tabbycat.
   - Intermediate methods (including `intermediate1`/`intermediate2`) are refused when any
     team's first standings metric is not a whole number, with Tabbycat's message ("Intermediate
     brackets require the first team standings metric to be an integer").
2. **Pairing** (`pairingMethod`, per bracket, ten-team examples): slide (1 v 6), fold
   (1 v 10), adjacent (1 v 2), random, or fold in the top bracket and adjacent elsewhere.
3. **Conflict avoidance** (`conflictAvoidance`):
   - `one_up_one_down`: Tabbycat's `OneUpOneDownSwapper`. Adjacent rooms may swap their
     second teams. A dynamic programme picks the best set of non-overlapping swaps. Each
     swap's gain is the clash cost it removes. It never adds history conflicts, and when
     gains are equal it prefers fewer swaps and swaps higher in the bracket.
   - Pairing deviations in `min_cost` use Tabbycat's `subrank`: a team's rank within its own
     bracket on the standings (teams tied on every metric share one; a pulled-up team counts as
     last), not its position after the random tie-break.
   - `min_cost`: an exact minimum-weight perfect matching per bracket (`weightedMatching.ts`,
     a port of the blossom algorithm behind NetworkX and Tabbycat's graph generators). A
     room costs: previous meetings × team history penalty, + same-institution penalty,
     + Tabbycat's side penalty × `sideBalancePenalty` when both teams lean to the same
     side, + max(pull-up debates) × `previouslySawPullupPenalty` when the room mixes
     brackets, + Tabbycat's pairing-deviation cost × `pairingDeviationPenalty`.
     With balanced sides and a side penalty, `maxTimesPerSide` (Tabbycat `max_times_per_side`,
     default 5, 0 = off) also applies here as in Tabbycat's graph matching: rooms with a team
     already more than that many times on one side are not offered. Unlike Tabbycat it is never
     a failure: if no pairing avoids them, they are allowed, and the draw check reports the team
     as a warning (`max_times_per_side`). The same applies to `min_cost_with_pullups`.
   - `min_cost_with_pullups`: Tabbycat's `graph_one` (`SingleGraphPowerPairedDrawGenerator`,
     `singleGraphPairing.ts`). Steps 1–3 become one minimum-cost perfect matching over the whole
     field. Teams may meet within a bracket or across adjacent brackets (no non-empty bracket
     between). A cross-bracket room costs, besides the `min_cost` costs, the pulled-up team's
     place in its bracket's odd-bracket order × `pullupPenalty` (Tabbycat's `pullup_magnitude`,
     including its quirk that the count lags by one when the first key is 0, as with
     `pullup_middle` and `pullup_random`), and its pairing deviation as one place below the
     higher bracket. Odd-bracket orders: top (subrank), bottom, middle, random (all equal),
     `pullup_lowest_ds_rank` (teams with no opponents first, then the highest mean opponent
     rank, i.e. the weakest opponents) and `..._npulls` (fewest pull-ups first, then the same).
     Intermediate brackets are refused and `pullupRestriction` is not used, as in Tabbycat.
     With preallocated sides it is the per-bracket `min_cost`, as in Tabbycat.
     Ties Tabbycat leaves to NetworkX are broken deterministically, below every Tabbycat cost
     (so the draw is always one of Tabbycat's optimal draws): fewest cross-bracket rooms, then
     (pull-up penalty 0) the odd-bracket order, then (pairing deviation penalty 0) the pairing
     method, applied by re-pairing each resulting bracket with `min_cost` while pulled-up teams
     may not meet each other. As in Tabbycat, `fold_top_adjacent_rest` is scored as adjacent
     everywhere here (graph_one passes no bracket index).
4. **Side limits as a pairing constraint.** Pairing methods and one-up-one-down pair before
   sides are known. `repairSideLimits` checks every room; if two teams cannot take opposite
   sides within `maxAllowedSideImbalance` (CrabbyTab's own hard limit, off by default), the
   bracket is re-paired by a
   minimum-cost matching that forbids such rooms, widening to the neighbouring bracket(s) (below
   first) when the bracket alone cannot fit. Within the window a room costs, in strict order:
   the win gap between its teams, its clashes, then whether it differs from the rooms already
   chosen. Brackets that fit are untouched. `maxTimesPerSide` is not repaired here: as in
   Tabbycat it only steers minimum-cost matching, so with one-up-one-down a team can get one
   more debate on a side than the setting (the harness's `twoteam-odd-ties` round 5 now matches
   Tabbycat), and the draw check shows a warning.
5. **Sides.** Balanced: the team that has been affirmative more often (relative to
   negative) goes negative, and equal records are decided at random.
   `maxAllowedSideImbalance` is a hard limit: a side that breaks it is never used, and the
   draw fails with an error naming the room if neither side fits. `maxTimesPerSide` is never
   a hard limit (with the old hard default of 5, an 11th two-team preliminary round could not
   be drawn) and does not apply to BP, as in Tabbycat.

### Preallocated sides

When side allocation is `preallocated` (two-team only), each team's side for the round
comes from `Round.preallocatedSides`, set on the Draw page. Brackets are odd when they have
more teams on one side. Tabbycat's allocated-sides methods resolve them:

- `pullup_top` / `pullup_bottom` / `pullup_random` pull teams of the short side from as
  many brackets below as needed.
- `intermediate1`: the excess teams start one intermediate bracket, filled from the top of
  the short side below.
- `intermediate2`: as intermediate1, but each lower bracket that contributes teams forms
  its own intermediate bracket.

Pairing pairs the affirmative list with the negative list. Fold reverses the negative
list, and random shuffles both. `min_cost` is a Hungarian assignment of affirmative to
negative teams. Missing or uneven allocations are reported, not guessed.

The Draw page shows every preliminary round's pre-allocations in one team × round grid
(Tabbycat's *Side Pre-Allocations* page). Rounds without a draw are editable; drawn rounds
show the side each team took. Two bulk actions fill the grid:

- **Generate random sides for every round without a draw** (Tabbycat's
  `generatesideallocations` command). Each round gives exactly half its teams the
  affirmative; teams that have affirmed least in the earlier generated rounds affirm first,
  ties broken by a seeded shuffle, so every team's affirmative count stays within one of
  the others' (Tabbycat shuffles each round independently). The seed is recorded in the
  audit log, and the same seed and field give the same sides. A round with an odd number of
  teams is reported, not filled. If any open round already has sides, or the grid has
  unsaved edits, the action asks for confirmation before replacing them; drawn rounds are
  never touched.
- **Copy sides from a previous round** (Tabbycat's bulk apply, same or opposite sides):
  from a confirmed or released round into a round without a draw. Teams with no known side
  in the source round (a bye, absent, or sides still to be recorded on the ballot) are
  skipped and counted; their entries are left as they were. The result is saved with *Save
  sides*.

## Other draw types

- **Random** (and power-paired rounds before any results): two-team rounds shuffle the
  field, then by conflict avoidance:
  - `one_up_one_down` (the default; Tabbycat picks its `SwapRandomDrawGenerator` for it): the
    shuffled teams are paired in order and each room with a history or institution clash tries
    up to 20 swaps of its second team with a random room, keeping a swap that removes the clash
    (or improves it without leaving the other room clashing). A room that runs out of attempts
    is flagged *Too many swaps* (`max_swapped`). A zero penalty switches that clash check off.
  - `min_cost` / `min_cost_with_pullups` (CrabbyTab's explicit minimum-cost option, Tabbycat's
    `graph` random generator): the shuffled field is paired by minimum-cost matching over
    history and institution clashes, so later random rounds avoid rematches whenever they can.
  - `off`: the shuffled teams are paired in order.
  BP random rounds spread institutions across rooms and then balance positions within each room.
- **Seeded**: teams ordered by `Team.seed`, highest first; equal seeds are in random order.
  Two-team: one bracket paired with the configured pairing method and conflict avoidance.
  BP (Tabbycat's `SeededDrawManager` with 4 teams): every team counts as 0 points, so the
  whole field is one bracket and the BP assignment places teams by position history alone
  (with the unshuffled assignment method, rows follow seed order). Every team needs a seed.
  Set seeds on the Draw page.
- **Round robin**, two-team (Tabbycat's Berger schedule): teams are ordered by seed,
  ascending (seed 1 first), equal seeds by team id; every team needs a seed. The round's
  index is the position of its schedule slot among the preliminary round-robin slots
  (parallel panels share it). The first team stays fixed and the rest rotate by index − 1.
  An index past N − 1 (more round-robin rounds than a single cycle has) is an error, not a
  silent wrap to the start of the schedule. Sides follow the side rule.
- **Round robin**, BP (Tabbycat's `BPRoundRobinDrawGenerator`): Tabbycat's preset tables,
  which exist for 16 teams (5 rounds) and 28 teams (9 rounds). Seeds must be exactly 1..N,
  each once. Seats come from the table. Other team counts, round indices past the table,
  and invalid seeds are reported as errors. Unlike Tabbycat, the side-imbalance limit
  (`maxAllowedSideImbalance`) stays hard: a table seat that would break it is reported instead
  of drawn.
- **Manual** is unchanged.

Each two-team round-robin round drawn with the Berger schedule is marked
(`Round.roundRobinAlgorithm: "berger_seed"`). If an earlier preliminary round-robin round
was drawn without the marker (before this schedule existed, when teams rotated in stored
order), the cycle keeps that legacy rotation for its later rounds, and those rounds are not
marked. The schedule therefore never changes mid-cycle, which could repeat pairings. The
legacy rotation also reports an index past N − 1 as an error. Changing seeds within a
Berger cycle changes its schedule, so keep a cycle's seeds fixed.

## Elimination sides

*Sides in elimination rounds* (Configuration → Sides) chooses how knockout sides are set:

- **By seed** (the default, and what existing tournaments keep): the higher seed takes the
  first side (affirmative; BP: OG, OO, CG, CO by seed) and sides are confirmed.
- **Random, confirmed later** (Tabbycat): pairings are the same, but each room's teams are
  shuffled over its seats with the draw's seed and the debate is left with
  `sidesConfirmed: false`, as Tabbycat's elimination generators shuffle sides and leave
  them unconfirmed. In two-team formats the debate uses the manual-ballot side machinery
  (see *Sides chosen on the ballot*): the ballot records which team took which side (for
  example after a coin toss), and bracket positions travel with the teams. BP ballots
  cannot record sides (neither can Tabbycat's), so a BP room keeps its drawn seats, which
  the draw editor can swap.

By seed stays the default because changing it would change the sides of knockouts in
tournaments that already rely on it; choose Random for Tabbycat's behaviour.

## Byes

With an automatic bye method, the remainder teams get a bye. A bye counted as a win gives
the team its points and a win (BP: 3 points and a first) but, as in Tabbycat, no speaker
scores. Speaker tabs and speaker-score averages ignore it, and so does the margin average.
A swing team never takes the bye.

### Sides chosen on the ballot

The `manual_ballot` side rule (Tabbycat's "manual-ballot", two-team formats only; the NZ
Easters preset uses it) pairs teams without fixing sides, e.g. for a coin toss before the
debate. Code: `src/lib/draw/manualSides.ts`.

- Every generated or hand-built room gets the flag `manual_ballot_sides` and
  `sidesConfirmed: false`. The slots' sides are then only the order the draw listed the teams
  in. Byes and debates drawn under other rules are never affected (their `sidesConfirmed`
  was never meaningful), and changing the rule later does not change existing draws.
- Pairing ignores side history, side balance and the side limits, since no side is assigned.
  The draw check skips `side_limit` for these rooms.
- The draw, public draw, projector, private portals and printed ballots show the teams with
  "sides chosen at the debate" instead of a side. Printed ballots ask the adjudicator to tick
  each team's side.
- The ballot records the sides: `teamScores[side].teamId`. Tab-room entry asks which team
  was Affirmative before scores are entered; the chair's portal ballot does the same, and the
  server (`privateBallot.ts`) accepts any arrangement of the debate's own teams and refuses a
  ballot without one while the sides are open.
- Confirming a ballot moves the teams to the recorded sides and sets `sidesConfirmed: true`.
  A later confirmed version may record other sides (the ballot is the authority for these
  rooms); discarding the confirmed version reopens the sides.
- Side history, standings, motion statistics and elimination advancement read the sides of
  confirmed ballots (`resolveRecordedSides` / `applyBallotSides`), so a chair's portal ballot
  counts before anyone rearranges the debate record. A room whose sides are still open counts
  as a meeting with no side.
- Draw edits still go through the normal draw commands, so live sync and the state rules
  (no matchup change once a ballot exists) apply.

### Swing teams

When the available teams do not fill the last room, the Draw page offers swing teams next
to the automatic byes (`SwingTeamPanel`, `application/swingTeams.ts`). A swing team is a
composite team formed for a round: its speakers are reserves or registered speakers of other
teams, each with a new speaker id (`Speaker.swingSourceSpeakerId` names the speaker it
stands in for), so swing speeches never mix with the speaker's own record.

- `Team.isSwing` and `Team.swingRoundIds`: the team is eligible, and marked available, only
  in those preliminary rounds. An earlier swing team can be reused in a later round.
- It is drawn like any team and never takes a bye. Its results count for its opponents
  (wins, points, opponent strength).
- It is left out of team standings, the speaker and reply tabs, and therefore the break.
  Tabbycat has a swing team type but leaves this to the tab director (break eligibility,
  duplicate speeches, "speeches missable"); CrabbyTab does it automatically.

## Draw release stages

A round's draw moves through Tabbycat's stages (`src/lib/draw/drawStatus.ts`, controls in
`DrawStageControls` on the Draw page):

| Stage | Stored `drawStatus` | Who sees it |
| --- | --- | --- |
| No draw | `none` | — |
| Draft | `draft` | Tab room only; freely edited. |
| Confirmed (Tabbycat "confirmed") | `locked` | Tab room only. Regenerating it or changing its matchups is an overridable `draw_confirmed` violation; **Back to draft** unlocks it. |
| Released to teams only (Tabbycat `draw-teams-release`) | `teams_released` | Each team's private URL shows its own room, side and opponents, **without the panel**; teams may be emailed their draw. Not on public pages or the projector, not on adjudicators' private URLs, and no remote or public ballots yet. |
| Released | `confirmed` (or the legacy `released`) | Public pages (per the draw mode), projector, adjudicators' private URLs, remote ballots. |

**Compatibility.** Before these stages existed, the stored `confirmed` already meant the public
release (and `released` was its synonym), so both keep that meaning and no stored data changes:
nothing public became hidden or the reverse. A public release still writes `confirmed`, so the v1
API and older app versions read it as before; the new stages use new values (`locked`,
`teams_released`) that older versions treat as unpublished. Unknown values count as a draft.

A draft can still be released in one step (as before) or confirmed first. Releasing to teams or to
everyone runs the draw check (`draw_invalid`, `draw_empty`, `concurrent_round_clash`); going on from
a teams-only release to the full release does not re-check what teams already saw. **Unrelease**
returns the draw to the confirmed stage, as in Tabbycat. Releases and unreleases go through
`ReleaseActionDialog`, which uploads and republishes; confirming and unconfirming are saved locally.

**Difference from Tabbycat:** Tabbycat's public draw page also lists teams-only-released rounds
(without adjudicators); CrabbyTab keeps them off public pages and shows them only on team private
URLs.

## Position balance report (BP)

With **Details** open on a BP preliminary round after the first, the Draw page shows Tabbycat's
position balance report (`draw-position-balance`, `src/lib/draw/positionBalance.ts`): each team's
position counts (OG / OO / CG / CO) before and after the round, the cost of its position this round
under the configured position cost (`bpPositionCost`, `renyiOrder`, `bpPositionCostExponent`, the
same function the draw minimises), and a status: went from balanced to imbalanced, was imbalanced
and still is, best improvement possible, or went from imbalanced to balanced ("balanced" = the four
counts differ by at most one). By default only teams with a status are listed, highest cost first.
Debates whose sides are chosen on the ballot are left out until their sides are known. Unlike
Tabbycat, the cost has no pull-up penalty term (CrabbyTab's BP draw has none) and the "annotated
draw" table (permitted points per room) is not reproduced.

## Draw editor

The Draw page shows, for each debate, its bracket, room rank, whether sides are chosen on the
ballot, and the draw check's problems and warnings. Each team carries inline flags
(`src/lib/draw/drawFlags.ts`; hover or focus a flag for the full sentence):

- **Met R2, R4**: a rematch, with the rounds the teams met in.
- **Same institution**.
- **AFF ×2, NEG ×1** (BP: each position): sides so far, including sides recorded on ballots.
- **AFF ×3** (warning): the side this round would leave the team that many times on it, two or
  more above its least-used side (or above `maxAllowedSideImbalance` when larger). Not shown
  while sides are chosen on the ballot or in elimination rounds.
- **Pulled up** in this round, and **Pulled up ×N before**.
- **Swing**.

"Draw details" lists every team with points, this round's room and opponents, sides by
round (TBC when not yet recorded), previous opponents with rounds, side counts and pull-ups,
for checking a draw before release. It also shows Tabbycat's draw flags, which the generator
records on the debate (`Debate.flags`) and the team (`DebateTeamSlot.flags`): one-up-one-down
(history / institution / to accommodate, on every room a swap changed), bubble up and bubble down
(history / institution / to accommodate), *Can't bubble up/down*, and *Too many swaps*.

Teams can be moved without dragging: **Move** picks a team (from a slot or the unassigned
pool), then **Place here** / **Swap here** on a slot, or **Return picked team to pool**.
Focus jumps to the first target; arrow keys, Home and End move between targets, Enter or Space
places, and Escape cancels (`usePlaceTargetNavigation`). The same buttons work on touch screens,
where HTML5 drag does not. Every move is announced in an ARIA live region, and drag-and-drop uses the
same move logic (`src/lib/draw/drawEditing.ts`): a swap within a room keeps each team's slot
details; a team moved to another room loses its pull-up mark.

## N teams per room (public speaking)

Tabbycat's `teams_in_debate` may be any whole number; 2 and 4 are its two-team and BP formats.
CrabbyTab has a format for every other count, **N teams per room** (`format: "poly"`,
`preferences.teamsInDebate`, any whole number of at least 1 except 2 and 4; Tabbycat's Public
Speaking preset uses 6). A room's positions are `P1` … `PN` (Tabbycat sides 0 … N−1) and are
named "Team 1", "Team 2", … as Tabbycat's `get_side_name` does. Stored data of two-team and BP
tournaments is unchanged. The format exposes exactly what Tabbycat does for these counts
(`DRAW_MANAGER_CLASSES[(None, …)]`):

- **Random** (`RandomPolyDrawGenerator`): the field is shuffled with the draw's seed and dealt
  into rooms of N in order, so when the field does not divide the last room holds the
  remainder (a room may have fewer than N teams, even one). Positions follow the deal order.
  No conflict avoidance, history, institution or side rule applies (Tabbycat's poly draw takes
  no options). With an automatic bye method the remainder takes byes instead (Tabbycat's
  `n_byes`), and a bye counted as a win is worth 1 point, as in Tabbycat.
- **Manual**: empty rooms of N positions; fill as many as a room needs. The draw editor shows
  N slots per room; a room's teams must sit in P1 … Pk without gaps, and a room may not hold
  more than N teams (draw checks report both).
- **Refused**, with a clear error, as Tabbycat refuses them: power-paired, seeded and
  round-robin draws ("can't be used with N teams per debate"), generated elimination draws
  (Tabbycat's elimination generators exist only for 2 and 4 teams; its `EliminationDrawManager`
  fails for other counts), preallocated sides and sides chosen on the ballot. Elimination
  rounds are drawn manually; setup plans none, and a break assigns every break category to the
  elimination rounds the tab room has added.

## Rooms

Rooms are allocated after the draw (see adjudicator-allocation, "Rooms"). Too few rooms no longer
stops a draw: as Tabbycat's VenueAllocator, the rooms that fit are allocated, the lowest-ranked
debates are left without a venue, the draw page says so before generating, and the draw check lists
each debate without one. *Auto-allocate rooms* on the draw page never uses a room booked by a
concurrent round and reports debates it could not give a room.

## Differences from Tabbycat

- History clashes in `min_cost` are a weighted penalty, not a forbidden pairing, so a
  bracket where every option is a rematch still draws.
- With `pairingDeviationPenalty` at 0, the pairing method still decides between equally
  clash-free matchings. Tabbycat then ignores the method.
- `intermediate_bubble` checks only the clashes whose avoidance is switched on, and two teams
  without an institution do not clash (Tabbycat compares `None == None` as a clash).
- The pull-up restriction also applies to allocated-sides pull-ups, falling back to the
  whole side list when too few teams satisfy it.
- `fold_top_adjacent_rest` and `adjacent` with preallocated sides pair the side lists in
  order (Tabbycat has no allocated-sides variant).
- Preallocated sides and sides chosen on the ballot are two-team only.
- Random side pre-allocation balances each team's affirmatives across rounds (Tabbycat
  shuffles every round independently).
- Elimination sides default to *by seed*; Tabbycat's random, unconfirmed sides are an option.
- N teams per room: Tabbycat's consensus ballots crash on a short room (its sides come from the
  tournament's count); CrabbyTab scores a short room on its own teams (see results-and-ballots).
  The anticipated draw for preformed panels gives rooms of more than 8 teams no bracket range
  (Tabbycat brute-forces every finishing order of a mixed room).
- Swing teams are excluded from standings and breaks automatically (Tabbycat leaves it to
  the tab director).
- `min_cost_with_pullups` breaks Tabbycat's arbitrary ties deterministically (see above) and,
  like `min_cost`, treats history as a penalty and the side-imbalance limit as hard.
- `maxAllowedSideImbalance` (CrabbyTab's own) is hard for every conflict avoidance method;
  `maxTimesPerSide` follows Tabbycat (minimum-cost matching only, never blocking).

## Known limitations

- `one_up_one_down` and `intermediate_bubble` are local rules. They can leave conflicts
  that a different pairing would avoid, by design.
- BP pairing (Hungarian) and two-team min-cost matching are O(n³). They run in a Web
  Worker, so a 1000-team round takes a few seconds without freezing the page.
