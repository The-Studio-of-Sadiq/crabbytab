# Rounds and draws

This page is the organiser's guide to rounds, the schedule and the draw. The algorithms follow Tabbycat's draw generators; the full description, with every difference from Tabbycat, is in [`docs/draw-generation.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/draw-generation.md) and [`docs/rounds-schedule-and-motions.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/rounds-schedule-and-motions.md).

## Rounds

The setup wizard creates the preliminary rounds plus the elimination rounds needed for the largest break (Grand Final, Semifinals, Quarterfinals, Octofinals, Double and Triple Octofinals, then *Elimination N*). Afterwards:

- **Add a round:** round menu in the top bar → **New round…** (*Round name*, *Abbreviation*, *Round stage*: preliminary or elimination). Rounds are added after the existing ones.
- **Change the number of preliminary rounds:** *Admin → Configuration → Round settings → Number of preliminary rounds* (0–20) → **Update round count**. Lowering it **cancels** rounds (a round with ballots cannot be cancelled; one with a draw needs a reason); raising it restores cancelled rounds first. Cancelled rounds are ignored by standings, completion and the public pages.
- **Delete a round:** *Round settings → Delete an individual round*. This permanently deletes its debates and ballots and unassigns its motions. It needs a reason if the round has ballots or a later round was drawn after it, and is refused for an advanced elimination round.
- *Round settings* also has **Feedback by round** (switch feedback on or off per round) and **Points weight by round** (team points earned in the round are multiplied by its weight; default 1).

Elimination rounds always use the elimination draw type, and only elimination rounds can; a round where stage and draw type do not fit is refused.

## The schedule and concurrent rounds

Setup → **Schedule** has four parts:

- **Rounds and start times:** each round's *Slot* and *Starts at*. Rounds of the same stage in the same slot run **concurrently** (for example "Round 1 (A)" and "Round 1 (B)").
- **Parallel preliminary panels:** *Rounds per slot* → **Group preliminary rounds** groups the preliminary rounds into slots of that size, renaming default names to "Round k (A)", "Round k (B)". Existing rounds are only regrouped when you press the button; rounds added later follow the setting.
- **Preparation time** (minutes): releasing a round's motions sets its start to release time plus preparation time.
- **Debate times:** give individual debates their own start time.
- **Tournament schedule:** events with types, published with **Publish schedule** to `/{slug}/schedule/public`, as JSON and as an iCalendar feed.

Rules for concurrent rounds:

- Power pairing waits only for rounds in **earlier** slots. History (rematches, sides, adjudicator history) comes from earlier slots only.
- Draw generation leaves out rooms already used by a concurrent round; auto-allocation leaves out adjudicators and rooms already used by one.
- Publishing a draw that shares a team, adjudicator or room with a concurrent round needs a recorded reason (`concurrent_round_clash`).
- Draw, Allocation, Results and Availability show a **Running at the same time** bar to switch between concurrent rounds and see their progress and clashes.
- The projector shows every concurrent round of the shown slot together.

## The current round

By default the **current round** is derived: the latest round whose draw is released to the public. The Draw page shows *Current round: … (automatic)*. **Make {round} current** sets it by hand; public pages (the "current round only" draw mode, the round they open on, public ballot forms), the projector and private URLs then use that round and the rounds of its slot. **Use automatic current round** clears it. Setting it never publishes an unreleased draw and, unlike Tabbycat, does not mark rounds complete or incomplete.

Self check-in uses its own rule (the earliest round that is neither cancelled nor completed); see [Check-ins and availability](Check-ins-and-Availability#self-check-in).

## Round lifecycle

| Step | Where | Effect |
| --- | --- | --- |
| Generate draw | Draw page | The draw is a **Draft**; the seed is recorded. |
| Allocate adjudicators | Allocation page | See [Adjudicator allocation](Adjudicator-Allocation). |
| Allocate venues | Draw page → **Allocate venues** | See [Venues and constraints](Venues-and-Constraints). |
| **Confirm draw** (optional) | Draw page | *Confirmed, not released*: tab room only; regenerating or re-pairing needs a reason. |
| **Release to teams only** (optional) | Draw page | Each team's private URL shows its room, side and opponents without the panel. |
| **Release draw to public** | Draw page | Public pages (if *Public draw* is on), projector, adjudicators' private URLs and remote ballots. |
| **Reveal Adjudicators** | Allocation page | Panels become visible to teams and the public. |
| Release motions | Setup → Motions | *Not released*, *Info slides released* or *Motions released*. |
| Enter and confirm ballots | Results | See [Ballots and results](Ballots-and-Results). |
| Publish round results / team speaks | Results | Separate switches; need every debate finished. |
| Complete round (prelims) / Proceed to next round (elims) | Results | See below and [Breaks and eliminations](Breaks-and-Eliminations). |

Releases go through a dialog that uploads and republishes in one step. Draft edits are saved on this device and, for cloud tournaments, sent live to other administrator devices (debates are live; the round's stage travels with the upload).

## The Draw page

Sidebar → *Round · R1* → **Draw** (administrators). Pick the round with *Select round*.

Below the stage controls, the **Draw setup for {round}** panel offers:

- **Draw type** for this round: *Power-paired*, *Random*, *Seeded (by team seed)*, *Round robin* or *Manual (empty rooms)*. It applies the next time the draw is generated. Power-paired rounds with no results yet are drawn at random.
- **Team seeds** (seeded and round-robin draws; seed titles when the team import uses them) → **Save seeds**.
- **Preallocated sides** for this round, when the side rule is *Preallocated* → **Save sides**.
- **Division** (when teams have divisions): "This round will draw only teams in the selected division".

The **Side pre-allocations, all preliminary rounds** grid (two-team formats with preallocated sides, on preliminary rounds) shows every team × round: rounds without a draw are editable, drawn rounds show the side each team took. **Generate random sides for every round without a draw** fills it (each round half affirmative, each team's affirmative count within one of the others'; the seed is in the audit log), and **Copy sides from a previous round** applies the same or opposite sides from a drawn round.

The **Swing teams** panel appears when the available teams do not fill the last room (see [Swing teams](#swing-teams)).

**Generating:** **Generate {round} draw**, or **Manually build rooms** for empty rooms. Draws run in a background worker, so the page stays usable; a **Cancel** button stops a long job and saves nothing. If the round changed while computing, nothing is saved and you are asked to try again.

**After generating**, each room card shows the venue (with its link), bracket, live teams, room rank, *Sides on ballot* when applicable, the draw check's problems and warnings, a *Postponed* switch (with optional reason) and the debate's venue requirements. Header actions: **Add room**, **Allocate venues**, **Draw details**, **Export CSV** (draw with adjudicators and motion), **Print draw sheet**, and a filter by room or team.

### Draw check and flags

The **draw check** lists problems (must fix or override to release) and warnings. Each team carries flags; hover or focus one for the full sentence:

| Flag | Meaning |
| --- | --- |
| **Met R2, R4** | Rematch, with the rounds they met in |
| **Same institution** | Both teams share an institution (composite teams count all their institutions) |
| **AFF ×2, NEG ×1** (BP: each position) | Sides so far, including sides recorded on ballots |
| **AFF ×3** (warning) | This round would leave the team that many times on one side, two or more above its least-used side |
| **Pulled up**, **Pulled up ×N before** | Pulled up into this bracket; earlier pull-ups |
| **Swing** | A swing team, not ranked |

**Draw details** lists each team's points, this round's room and opponents, sides by round (*TBC* when chosen on the ballot), previous opponents, side counts and pull-ups, plus Tabbycat's generator flags: *One-up-one-down (history / institution / to accommodate)*, *Bubble up / Bubble down (…)*, *Can't bubble up/down* and *Too many swaps*. For BP rounds after the first it also shows the **position balance report**: each team's OG/OO/CG/CO counts before and after, the position cost, and whether the team became balanced or imbalanced.

### Editing a draw

Drag teams between slots, rooms and the **Unassigned teams pool**, or use the keyboard and touch equivalent: **Move** picks a team, then **Place here** / **Swap here** on a slot, or **Return picked team to pool**. Arrow keys, Home and End move between targets; Escape cancels. Every move is announced to screen readers. A team moved to another room loses its pull-up mark.

Once a debate has a live ballot, its teams and sides cannot change (discard the ballot first), and its panel changes need a reason. Re-pairing a confirmed or released draw needs a reason too. Changing rooms and venue requirements never does. Manual venue choices refuse rooms that are unavailable, already used or unsuitable.

## Draw stages

| Stage | Who sees it | Controls |
| --- | --- | --- |
| No draw | — | Generate, or build manually |
| **Draft** | Tab room only; freely edited | **Confirm draw**, **Release to teams only**, **Release draw to public** |
| **Confirmed, not released** | Tab room only; regenerating or re-pairing needs a reason | **Back to draft**, **Release to teams only**, **Release draw to public** |
| **Released to teams only** | Each team's private URL shows its room, side and opponents, without the panel; teams can be emailed their draw. Not on public pages, the projector or adjudicators' private URLs; no remote ballots yet. | **Release draw to public**, **Unrelease draw** |
| **Released to public** | Public pages (per the public draw mode), projector, adjudicators' private URLs, remote ballots | **Unrelease draw** (back to *Confirmed*) |

Releasing to teams or to the public runs the draw check: errors need a recorded reason, warnings never block. Going on from teams-only to public does not re-check what teams already saw. Releases and unreleases upload and republish; confirming and unconfirming are saved on this device and reach other devices with the next upload.

**Difference from Tabbycat:** Tabbycat's public draw page also lists teams-only releases without adjudicators; CrabbyTab shows them only on team private URLs.

## Draw types

| Draw type | Formats | Notes |
| --- | --- | --- |
| **Power-paired** | Two-team, BP | Brackets by the first team-standings metric (team points by default). Before any results, drawn as random. |
| **Random** | All | Two-team: shuffled, then clashes removed by swaps or minimum-cost matching (per conflict avoidance). BP: institutions spread across rooms, positions balanced. N teams per room: dealt into rooms in order. |
| **Seeded** | Two-team, BP | Teams ordered by seed, highest first. Two-team: one bracket with the configured pairing and conflict avoidance. BP: one bracket placed by position history. Every team needs a seed. |
| **Round robin** | Two-team, BP | Two-team: Tabbycat's Berger schedule by seed (seed 1 first). BP: Tabbycat's tables for 16 teams (5 rounds) and 28 teams (9 rounds); seeds must be exactly 1..N. More rounds than one cycle, or other team counts, are reported as errors. |
| **Manual** | All | Empty rooms to fill by hand. |
| **Elimination** | Two-team, BP | Generated from the break; see [Elimination draws](#elimination-draws). |

### Two-team power pairing

Settings are on *Configuration → Draw rules → Two-team bracket pairing and conflict avoidance*:

1. **Odd bracket resolution method**: pull a team up from the bracket below (*top*, *bottom*, *middle*, *random*, or *lowest draw-strength rank*, the last two only with min-cost pairing with pull-ups), or form intermediate brackets (*intermediate*, *intermediate with bubble-up/bubble-down*; *intermediate1* / *intermediate2* for preallocated sides). **Pull-up restriction** can limit candidates to the least-pulled-up teams or the lowest draw strength.
2. **Pairing method** within a bracket (ten-team examples): fold 1 v 10, slide 1 v 6, adjacent 1 v 2, random, or fold at the top and adjacent elsewhere.
3. **Conflict avoidance method**: *one-up-one-down* (default; swaps second teams between adjacent rooms to remove clashes), *minimum cost* (exact minimum-weight matching per bracket over history, institution, side-balance, pull-up and pairing-deviation penalties), *minimum cost with pull-ups* (Tabbycat's single-graph matching over the whole field), or *off*.
4. **Sides**, below.

*Team conflicts and clashes* sets *Avoid same institution*, *Avoid team history* and their penalties. Pulled-up teams are marked on the debate and counted by the `pullups` standings metric.

### BP power pairing

Tabbycat's Hungarian BP draw (*Configuration → Draw rules → British Parliamentary (BP) draw rules*): brackets are completed to multiples of four from the bracket below, then one assignment of teams to (room, position) minimises position imbalance. *BP pull-up distribution* (anywhere, top or bottom rooms), *BP position cost* (Rényi entropy, variance or simple), *Rényi order*, *BP position cost exponent* and *BP assignment method* (shuffled Hungarian, unshuffled, or random within brackets) match Tabbycat's options. BP power pairing does not consider institution or history clashes, as in Tabbycat and the WUDC rules.

### Side allocation

*Configuration → Draw rules → Side allocations and balancing → Side allocations method*:

- **Balanced** (default): the team that has been affirmative more often goes negative; ties are decided by the seeded random source.
- **Random.**
- **Preallocated** (two-team): sides come from the Draw page (per round, or the all-rounds grid). Missing or uneven allocations are reported, not guessed.
- **Chosen on the ballot** (two-team; for example a coin toss): rooms are paired without sides; the draw, portals and printed ballots say "sides chosen at the debate", and the ballot records which team took which side. Confirming the ballot fixes the sides.

**Maximum allowed side imbalance** (off by default) is a **hard** limit for every method: if neither side fits, the draw fails and names the room. **Maximum number of times per side** (default 5) only steers minimum-cost pairing and never blocks a draw; an excess shows as a warning in the draw check. Neither applies to BP.

### Elimination side rule

*Sides in elimination rounds*:

- **By seed** (default): the higher seed takes the first side (affirmative; in BP OG, OO, CG, CO by seed) and sides are final.
- **Random, confirmed later** (Tabbycat's behaviour): each room's teams are shuffled over its seats with the draw's seed and left unconfirmed. In two-team formats the ballot records which team took which side. BP ballots cannot record sides, so a BP room keeps its drawn seats, which you can swap in the editor.

## Byes

When the field cannot fill every room, *Bye team selection method* (*None*, *Lowest ranked* or *Random*) chooses who sits out; with *None* the draw needs a full field (or swing teams). *Bye team results* sets whether a bye is **absent** (no standings result) or a **full win** (two-team: a win; BP: 3 points and a first; N teams per room: 1 point). A bye never awards speaker scores, and speaker tabs and averages ignore it. Lowest-ranked ties are broken with the draw's seed. A swing team never takes a bye.

### Swing teams

When the available teams do not fill the last room, the Draw page's **Swing teams** panel says how many teams are short and offers a swing team instead of byes: give it a name and speakers (reserves, or registered speakers of other teams, who get separate speaker records so their own tab is unaffected). A swing team is available only in the rounds it is used in, is drawn like any team, never takes a bye, and its results count for its opponents. It and its speakers are left out of team standings, speaker and reply tabs and the break. Earlier swing teams can be reused in a later round.

## Elimination draws

Generate the break first (Results → **Break**). Then, on the Draw page for the first elimination round, **Generate draw** builds a seeded bracket from the break. Break sizes that are not a full bracket start with a **partial elimination**: the top seeds advance directly and the rest are folded (best remaining seed against the weakest). BP eliminations work from any even field. Later rounds keep bracket positions, so teams stay in their half. **Proceed to next round** (Results) marks losing teams eliminated and activates the next elimination round. A round's elimination draw needs its break generated and every earlier elimination round of the category advanced. See [Breaks and eliminations](Breaks-and-Eliminations).

## N teams per room

For the *N teams per room* format (Tabbycat's Public Speaking preset uses 6):

- **Random**: the field is shuffled with the draw's seed and dealt into rooms of N; the last room holds the remainder (or the remainder gets byes with an automatic bye method). No conflict avoidance, history, institution or side rule applies.
- **Manual**: empty rooms of N positions (*Team 1* … *Team N*); fill as many as a room needs, without gaps.
- Power-paired, seeded and round-robin draws, generated elimination draws, preallocated sides and sides chosen on the ballot are refused with a clear message, as in Tabbycat. Elimination rounds are added and drawn by hand.

## Regenerating a draw

- **No ballots yet:** you confirm that the existing draw will be overwritten.
- **The round has ballots:** you are warned that regenerating will **discard** them; they stay in each ballot's history but no longer count. Only do this if the round was not debated as drawn.
- A **confirmed** or **released** draw, or one with a later round drawn after it, needs a recorded reason. A completed, cancelled or advanced round cannot be regenerated.
- Each generation creates debates with new ids, so old ballots never attach to new pairings. For cloud tournaments the replaced debates are soft-deleted live.
- Generating a preliminary draw while an earlier slot's round is unfinished needs a reason: unfinished results do not count towards power pairing.

## Reproducibility

Every random choice (shuffles, random pull-ups, tie-breaks, bye selection, random sides) uses one seeded random source. The seed is stored on the round and in the audit log, so the same inputs and seed reproduce the same draw, also in the background worker. Teams with equal standings, and teams with no standing yet, are ordered randomly with that seed.

## Differences from Tabbycat

- Teams tied in a standings tier are ordered by the draw's seeded random order, not by database order (institution, then reference).
- In minimum-cost pairing, rematches are a weighted penalty, not forbidden, so a bracket where every option is a rematch still draws.
- *Maximum allowed side imbalance* (CrabbyTab's own) is a hard limit for every method; *maximum times per side* never blocks.
- Random side pre-allocation balances each team's affirmatives across rounds (Tabbycat shuffles each round independently).
- Elimination sides default to *by seed*; Tabbycat's random, unconfirmed sides are an option.
- Swing teams are excluded from standings and the break automatically.
- Teams-only draw releases are not listed on the public draw page.
- N teams per room: a short last room is scored on its own teams; the anticipated draw gives rooms of more than 8 teams no bracket range.

## Limitations

- *One-up-one-down* and *intermediate with bubbles* are local rules and may leave clashes that a different pairing would avoid.
- With one-up-one-down, pairing happens before sides are known; if two teams cannot take opposite sides within the side-imbalance limit, the bracket is re-paired, and if that fails the draw stops with an error naming them.
- BP and minimum-cost pairing are O(n³); they run in a Web Worker, so a 1000-team round takes a few seconds without freezing the page.
- Divisions only restrict which teams a round draws; there are no per-division standings.
