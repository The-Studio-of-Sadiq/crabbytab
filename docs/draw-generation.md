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
at random. Two-team brackets group teams by wins; BP brackets group them by team points.

A room's `pulledUp` teams are those with fewer wins (BP: points) than the best team in the
room. The generator stores this on each debate slot. Standings count it as the `pullups`
metric, where fewer pull-ups rank higher. The draw history counts pull-ups and pull-up
debates for later rounds.

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
   - Sum of squared deviations: Σ (count − mean)² after this round. This is 4 × Tabbycat's
     "variance" option, which only rescales it.
3. **Assignment.** One Hungarian assignment over all teams and slots. The cost matrix is
   shuffled first (Tabbycat's `hungarian_preshuffled`), so equally good draws are chosen
   at random. With `bpAssignmentMethod: "random"` or random sides, position costs are
   dropped and teams are placed at random within their brackets.

The result is a minimum-cost assignment for these costs. BP power pairing does not consider
institution or history clashes, as in Tabbycat and the WUDC rules.

## Two-team power pairing

1. **Odd brackets** (`oddBracketMethod`):
   - `pullup_top` / `pullup_bottom` / `pullup_middle` / `pullup_random`: an odd bracket
     takes one team from the next bracket down. Middle is the exact middle, or one of
     the two middle teams at random. `pullupRestriction` first narrows the candidates to
     the teams with the fewest pull-ups, or the lowest draw strength by wins or speaks.
   - `intermediate`: the bottom team of an odd bracket and the top team of the next
     bracket form an intermediate bracket between them.
   - `intermediate_bubble`: intermediate brackets, then each intermediate debate with a
     history or institution clash tries to swap its higher team with the bottom team of
     its bracket ("bubble up"), else its lower team with the top team of the bracket below
     ("bubble down"). A swap is accepted only if the new intermediate pairing is clean.
2. **Pairing** (`pairingMethod`, per bracket, ten-team examples): slide (1 v 6), fold
   (1 v 10), adjacent (1 v 2), random, or fold in the top bracket and adjacent elsewhere.
3. **Conflict avoidance** (`conflictAvoidance`):
   - `one_up_one_down`: Tabbycat's `OneUpOneDownSwapper`. Adjacent rooms may swap their
     second teams. A dynamic programme picks the best set of non-overlapping swaps. Each
     swap's gain is the clash cost it removes. It never adds history conflicts, and when
     gains are equal it prefers fewer swaps and swaps higher in the bracket.
   - `min_cost`: an exact minimum-weight perfect matching per bracket (`weightedMatching.ts`,
     a port of the blossom algorithm behind NetworkX and Tabbycat's graph generators). A
     room costs: previous meetings × team history penalty, + same-institution penalty,
     + Tabbycat's side penalty × `sideBalancePenalty` when both teams lean to the same
     side, + max(pull-up debates) × `previouslySawPullupPenalty` when the room mixes
     brackets, + Tabbycat's pairing-deviation cost × `pairingDeviationPenalty`.
4. **Sides.** Balanced: the team that has been affirmative more often (relative to
   negative) goes negative, and equal records are decided at random. `maxTimesPerSide`
   and `maxAllowedSideImbalance` are hard limits. A side that breaks one is never used,
   and the draw fails with an error naming the room if neither side fits.

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

## Other draw types

- **Random** (and power-paired rounds before any results): two-team rounds shuffle the
  field. Unless conflict avoidance is off, the shuffled field is then paired by
  minimum-cost matching over history and institution clashes, so later random rounds avoid
  rematches. BP random rounds spread institutions across rooms and then balance positions
  within each room.
- **Seeded** (two-team): one bracket ordered by `Team.seed`, highest first. Equal seeds are
  in random order. The bracket is paired with the configured pairing method and conflict
  avoidance. Every team needs a seed. Set seeds on the Draw page.
- **Round robin** and **manual** are unchanged.

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
for checking a draw before release.

Teams can be moved without dragging: **Move** picks a team (from a slot or the unassigned
pool), then **Place here** / **Swap here** on a slot, or **Return picked team to pool**.
Escape cancels. Every move is announced in an ARIA live region, and drag-and-drop uses the
same move logic (`src/lib/draw/drawEditing.ts`): a swap within a room keeps each team's slot
details; a team moved to another room loses its pull-up mark.

## Differences from Tabbycat

- History clashes in `min_cost` are a weighted penalty, not a forbidden pairing, so a
  bracket where every option is a rematch still draws.
- With `pairingDeviationPenalty` at 0, the pairing method still decides between equally
  clash-free matchings. Tabbycat then ignores the method.
- Bubble up/down swaps with the bracket the intermediate team came from, even when win
  counts skip a value.
- The pull-up restriction also applies to allocated-sides pull-ups, falling back to the
  whole side list when too few teams satisfy it.
- `fold_top_adjacent_rest` and `adjacent` with preallocated sides pair the side lists in
  order (Tabbycat has no allocated-sides variant).
- Seeded draws are two-team only, and preallocated sides and sides chosen on the ballot are
  two-team only.
- Swing teams are excluded from standings and breaks automatically (Tabbycat leaves it to
  the tab director).
- Tabbycat's whole-draw "minimum cost matching including pull-ups" generator, which chooses
  pull-ups by cost, is not implemented. `pullupPenalty` applies to BP only.

## Known limitations

- `one_up_one_down` and `intermediate_bubble` are local rules. They can leave conflicts
  that a different pairing would avoid, by design.
- BP pairing (Hungarian) and two-team min-cost matching are O(n³). They run in a Web
  Worker, so a 1000-team round takes a few seconds without freezing the page.
