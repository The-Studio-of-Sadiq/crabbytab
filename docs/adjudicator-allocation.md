# Adjudicator allocation and feedback scores

How CrabbyTab scores adjudicators and allocates panels. The code is in
`src/lib/draw/allocator.ts`, `src/lib/feedback/scores.ts` and
`src/features/tournament/application/allocation.ts`.

## Adjudicator score

- **Pre-feedback score:** the test score when one is set, otherwise the base score
  (both on the 1–10 scale).
- **Feedback average:** a weighted average of the counted submissions about the
  adjudicator. A submission counts when it is confirmed and not ignored. Its weight comes
  from *Feedback weighting by source* (source role × the role the rated adjudicator held
  in that debate, default 1). The average is mapped linearly from the feedback scale
  (`feedbackMinScore`–`feedbackMaxScore`) onto 1–10.
- **Blended score:** `(1 − w) × pre-feedback + w × feedback average`, where `w` is the
  allocated round's `feedbackWeight` (0–1; edit it on the allocation page). If the round
  has no usable weight, the old fixed 60% blend applies. An adjudicator with no counted
  feedback keeps their pre-feedback score.

New rounds default to `feedbackWeight = 1`, so once an adjudicator has counted feedback
it replaces their base/test score entirely. Lower the weight if you want base scores to
keep influence.

## Allocation cost model

Allocation is a heuristic. It finds a good allocation, not a proven optimum.

1. Debate priority comes from the bracket, break liveness, the manual importance and,
   with a smaller weight, venue priority.
2. **Preformed panels** (when *Allocate preformed panels as a unit* is on and the round
   has panels) are placed first as whole units. Panels are ranked by importance and then
   by their average voting score, and the i-th panel is steered towards the i-th
   highest-priority debate. Members' team conflicts and history add to the cost.
   Members who are unavailable this round are left out. A panel with no available voting
   member is not placed. *Placing preformed panels: by room rank* (Configuration →
   Adjudicators) instead ports Tabbycat's direct allocator: the panel with the lowest room
   rank goes to the debate with the lowest room rank, and so on, with no optimisation
   (panels without a room rank, such as ones made by hand, follow in their stored order).
   Extra panels are left unplaced; conflicts are still reported after allocation.
3. Voting panels for the remaining debates are sized as follows:
   - *Same size everywhere:* every debate gets the chosen size. Seats that cannot be
     filled are dropped from the lowest-priority panels first.
   - *Larger in priority rooms:* every debate gets a chair. Then panels grow to 3, 5, …
     (odd sizes only, up to the chosen maximum) in priority order while voting
     adjudicators remain.
4. A Hungarian assignment fills the seats. A seat's cost is:
   - **strength:** `importanceMismatchPenalty × 0.05 × (distance / 10)²`. In the default
     strategy, distance is measured from the score the seat's rank would ideally hold. In
     the panel-average strategy, it is measured between the panel average and the debate
     priority.
   - **team conflicts:** `adjConflictPenalty` per own-institution or personal team
     conflict, and 80% of it per declared extra-institution conflict.
   - **team history:** `adjHistoryPenalty` per team the adjudicator has already judged.
     This is a soft penalty.
5. A local search then improves the costs that depend on pairs of adjudicators: an
   adjudicator–adjudicator conflict costs `adjConflictPenalty`, and each previous
   co-panelling costs 40% of `adjHistoryPenalty`. The search does at most 50 passes and at
   most 4,000,000 move evaluations, so large tournaments stay responsive.
6. Trainees are placed one at a time, starting with the lowest-scored. Each goes to the
   debate with the lowest conflict cost (team conflicts, history, and conflicts with
   anyone already on that panel), then the debate with the fewest trainees, then the
   lowest-priority debate.
7. The strongest panel member without a team clash becomes chair. Every remaining clash is
   listed on the result and in the audit log.

With the default weights (conflict 1,000,000, history 10,000, mismatch 10,000,000):

- Even a full ten-point strength mismatch (500,000) costs less than one conflict.
- A one-point mismatch (50,000) costs more than one repeat-team history.

The weights are used exactly as configured, so a low conflict penalty can let a conflict
through. Any such conflict is reported. A penalty of 0 turns that check off.

Team conflicts include **team-declared institution conflicts** (Tabbycat's team–institution
conflicts, `Team.institutionConflictIds`): adjudicators from an institution the team declared
clash with that team, beyond its own institution. They are edited on Setup → Conflicts (or
imported by CSV) and count like declared extra-institution conflicts.

### Speed (wave 4)

The allocator returns exactly the same panels as before the wave 4 speed work; seeded fixtures in
`src/lib/draw/allocator.golden.test.ts` (golden output captured before the change) prove it.

- The local search skips a move without computing its pair costs when a lower bound shows it
  cannot beat the best move found so far (group costs are never negative, and IEEE rounding is
  monotone, so the bound holds for the floating-point values too). Pair costs (adjudicator
  conflicts and past co-panels) are precomputed sparsely; panel members are gathered into a
  reused buffer instead of new arrays.
- A debate's team-conflict costs are computed once and shared by all its seats.
- The Hungarian solver works on flat typed arrays with the same operations in the same order, so
  ties still resolve identically.

On the 300-room golden fixture the allocation went from ~21 s to ~1.3 s, and the 60-room
panel-average fixture from ~16 s to ~2.4 s. The remaining cost at 1000 teams is the Hungarian
matching itself, which is O(n³): with ~1000 seats it takes ~1.5 s when adjudicator scores vary
and much longer when every adjudicator has the same score (every matching is then tied, and the
algorithm explores the most). Making that degenerate case faster would change which of the tied
allocations is returned, so it was left alone.

## Allocation strategies

Configuration → *Adjudicator allocation strategy*:

| Strategy | Behaviour |
| --- | --- |
| Preset 1 (`crabbytab_v1`, default) | The cost model above: seat ranks matched to adjudicator ranks. |
| Panel average (`panel_average`) | As above, but the strength cost compares each panel's average with the debate priority. |
| Tabbycat voting (`tabbycat_voting`) | Tabbycat's `hungarian-voting`. With D debates and V voters, `max(D − ⌊(V − D)/2⌋, 0)` of the strongest voters chair the most important debates alone; the rest form panels of three in the other debates (the third seat in the top half of those may be a point weaker). Trainees (and voters below the minimum score) go one per solo debate. |
| Tabbycat consensus (`tabbycat_consensus`) | Tabbycat's `hungarian-consensus`. Every voter is used; panels are as even as possible, the most important debates getting the extra member, and each further seat may be a point weaker. Trainees go one per debate. |

The Tabbycat strategies use Tabbycat's seat cost (`lib/draw/tabbycatHungarian.ts`): conflicts and
history, plus `1000·e^(diff−0.25)` when `diff = 5 + importance − score > 0.25`, plus `5 − score`,
with scores normalised to 0–5 and the 0–10 debate priority to Tabbycat's 1–5 importance. They
ignore the panel size setting. Differences from Tabbycat: voters are not shuffled before sorting
(ties break by score, then id, so the result is reproducible), and conflict and history costs use
CrabbyTab's configured penalties. As in Tabbycat's code, the voting strategy gives the *solo*
chairs the top rooms. Their warnings (too few voters or panellists) are shown on the allocation
page and stored in the audit event. Preformed panels are still placed first with any strategy.

## Editing panels by keyboard and touch

Every drag on the allocation page has a button equivalent. **Move** on any judge (in the pool or
on a panel) picks it; each debate then offers **Place as chair** (**Replace chair** when one is
set; the old chair returns to the pool, as when dragging), **Add as panellist** and **Add as
trainee**, and a placed judge can be sent back with **Return to pool**. Focus moves to the first
target, arrow keys / Home / End move between targets, Escape cancels, and the clash preview shown
while dragging is also shown for the picked judge. Picks, placements and refusals (for example a
trainee dropped on a chair slot) are announced in an ARIA live region. Drops and buttons run the
same code path.

## Preformed panels from an anticipated draw

Allocation → Preformed panels → *Create from anticipated draw* ports Tabbycat's
`preformed/anticipated.py`: from the previous preliminary round's draw and each team's points
before it (confirmed ballots), every possible result of that round gives each team a lowest and
highest possible total; these are sorted and cut into rooms, giving each room a bracket range and
the number of teams that may still be live for the open break (Tabbycat's live thresholds from
`breakqual/liveness.py`, ported in `lib/draw/anticipatedDraw.ts`). One panel per room is created,
or updated (keeping its members) when a panel with that room rank exists. In the first round,
before the previous draw exists, and in elimination rounds, panels are created without brackets.

*Prioritise by bracket* sets importance in four levels by the middle of each bracket range
(Tabbycat's 1, 0, −1, −2 become 10, 7, 3, 0); *Prioritise by liveness* gives panels with a live
team 10, panels whose lowest bracket is already safe 7, and the rest 0. Empty panels may be saved;
allocation skips them.

## Shards

The allocation board can be split into 2–6 shards (Tabbycat's sharding) to work on part of the
draw: sort by bracket, priority or venue (category, then name), and mix *top to bottom* (shard A
has the top of the order) or *interleaved* (debates dealt out in turn, so every shard has a
similar spread). Shards are balanced (Tabbycat can produce lopsided shards, e.g. 1, 1 and 6 for
8 debates in 3). A shard is only a view: auto-allocation and the conflict checks always cover the
whole round. Logic: `lib/draw/sharding.ts`.

## Rooms

Rooms are allocated after the draw, and again after auto-allocation when any adjudicator has room
requirements or preferences (`lib/draw/venueAllocator.ts`), with a minimum-cost matching:

- **Hard requirements** (category, capacity, step-free, online, near the tab room) from teams,
  institutions, adjudicators or the debate must hold; otherwise allocation fails with an error.
- **Room preferences** (Tabbycat venue constraints; Setup → Room preferences): a team,
  adjudicator or institution prefers rooms of a category with a priority. They are met where
  possible with lexicographic costs: missing one preference of a priority costs more than missing
  every lower-priority preference together, and any preference outweighs room ranking (if those
  weights would be too large for exact arithmetic, each priority level weighs its rank instead).
  Tabbycat assigns these greedily, debate by debate; CrabbyTab finds the best assignment. Unmet
  preferences appear as warnings in the draw check.
- Then higher-ranked debates (bracket, importance) get higher-priority rooms.
- **Per-round availability:** a room can be taken out of (or put into) one round on the Venues
  page; otherwise its default availability applies.
- **Room check-in expiry:** room check-ins record their time and lapse after *Room check-in
  expiry* hours (Tabbycat `checkin_window_venues`); expired rooms show as such on the check-ins page.
- **Room links:** a room may have an http(s) link (online meeting or map). It is shown on the
  admin draw, in private portals (read only for debates of rounds still running, about one read
  per round), with the public draw data, and in emails as `{{venue_url}}`.
- **Room categories** (Venues page): a description (tooltip "This room …", always on admin pages,
  on public pages only when marked) and whether the category is shown as a prefix or suffix of
  room names. A room can be in several categories, as in Tabbycat (`Venue.categories`; the
  older single `Venue.category` keeps the first and is still read, so older data and clients
  keep working). Type them comma-separated on the Venues page or in the venues CSV
  (`"Large; Accessible"`). A required category, a room preference and the category filters match
  any of a room's categories; prefixes, suffixes and tooltips combine every category that has one.

## Feedback paths

*Settings → Adjudicator Feedback → Feedback paths* says who gives feedback on whom
(`TournamentPreferences.feedbackPaths`, `src/lib/feedback/paths.ts`), as Tabbycat's
"feedback from teams" and "feedback paths" settings:

- **Teams** (all of Tabbycat's `feedback_from_teams` modes; *allowed* = may be rated, *expected* =
  counted as owed):

  | Mode | Allowed | Expected |
  |---|---|---|
  | The chair only | chair | chair |
  | The orallist (Tabbycat "orallist") | voting adjudicators, with a prompt to pick whoever gave the oral | one submission |
  | Any voting adjudicator allowed | voting adjudicators | one submission |
  | Any adjudicator allowed | every adjudicator, trainees too | one submission |
  | Every voting adjudicator | voting adjudicators | each of them |
  | Every adjudicator on the panel | every adjudicator | each of them |
  | Nobody | — | — |

  "One submission" is the orallist: CrabbyTab does not record who gave the oral, so a team's first
  submission on any allowed adjudicator of the debate settles it; further ones are *unexpected*.
- **Adjudicators:** chair on panellists, chair on trainees, panellists on chair, trainees on
  chair, *panellists on each other* (trainees excluded; Tabbycat "with-p-on-p"), each switched
  separately, or *every adjudicator on every other* (trainees included).
- **Feedback on teams** (teams and adjudicators rating teams) can be allowed. It is never
  expected and never counts towards adjudicator scores.
- **Elimination rounds** can have their own paths (`eliminationFeedbackPaths`); without them the
  preliminary paths apply. *Collect feedback in elimination rounds* and the per-round switch still
  turn feedback off entirely.

The same resolved paths (`feedbackPathsForRound`) decide what the team and adjudicator portals
offer, what the private sync route accepts, which sources the tab-room form lists, what the
progress panel expects and which forms the print page produces (one per expected submission,
teams' and adjudicators'). The data-entry assistant route checks only that source and target sat
in the debate, not the paths (a known gap).

Tournaments from before the explicit paths keep their preset (`feedbackPath`):

| Preset | Teams on | Adjudicators |
|---|---|---|
| chairs → panel | chair | chair on panellists and trainees |
| two-way (default) | chair | chair on panel, panellists and trainees on chair |
| everyone | every adjudicator | every adjudicator on every other; feedback on teams allowed |

Teams were always expected to rate only the chair, so the presets keep that. **Behaviour change:**
before, a team's portal and the tab-room form also accepted team feedback on panellists and
trainees under the first two presets; now they follow the paths. Choose *Every adjudicator on the
panel* to restore that. Under *everyone* teams are now also expected to rate every adjudicator.

## Feedback progress

The progress panel lists, per round, the feedback the round's paths expect. Any submission from
that source about that target in the round counts as received, including unconfirmed and ignored
ones. With **Show unexpected feedback** (default on; Tabbycat `show_unexpected_feedback`) it also
lists, marked "?", submissions no path expected; they still count towards scores unless ignored.

## Feedback options

*Settings → Adjudicator Feedback*:

- **Feedback score step** (Tabbycat `adj_score_step`, default 1): scores are the minimum plus a
  whole number of steps, checked in the forms and again by the private sync and data-entry routes
  (`validateFeedbackScore`); forms start in the middle of the scale, on a step.
- **Feedback introduction** (Tabbycat `feedback_introduction`): plain text shown above every feedback
  form in the private portals.
- **Important feedback threshold** (default 2, Tabbycat's fixed value): *Individual feedback forms →
  Important only* lists feedback whose score differs from the rated adjudicator's current base score
  by more than the threshold (Tabbycat's "important feedback" view).

## Feedback questions

Besides the overall score, each questionnaire (teams' and adjudicators') can ask questions of
these types, matching Tabbycat's: short text, long text, whole-number box and decimal box (optional
minimum and maximum), integer scale (pick one whole number between required bounds, at most 21
choices), number in range (the pre-wave-3 "scale": any number between required bounds), yes/no,
checkbox (a required checkbox must be ticked), select one and select many. Answers are validated in
the browser and again by the private sync and data-entry routes. Answers never change the feedback
score: `scores.ts` uses only the overall score of confirmed, non-ignored feedback.

The per-adjudicator page summarises the answers of counted feedback per question: average and range
for numeric questions, yes/no tallies for yes/no and checkbox questions, option counts for selects,
the responses for text, and the agree/disagree tally.

## Base and test score history

Every change to an adjudicator's base or test score is appended to `Adjudicator.scoreHistory`
(`src/lib/feedback/scoreHistory.ts`): which score, old → new value, when, who and an optional reason
(entered on the per-adjudicator page). Changes from the participant editor and bulk edits are
recorded too, without a reason. The history travels with the adjudicator record, so it is in backups
(a malformed history is a backup warning) and it is private like the scores. It is written as one
field, so if two devices change the same adjudicator's scores at the same moment, one entry can be
lost (the audit log keeps both changes as `scoreChanges`). Changes made before this existed are not
listed. The page shows it next to the feedback-derived score history by round. Each entry also
records the tournament's current round when the score was set (`roundId`, Tabbycat
`AdjudicatorBaseScoreHistory.round`: the first unfinished preliminary round, else the current
elimination round); entries made before any round, and older entries, have none.

## Testers

Tabbycat's `Adjudicator.is_tester` is `Adjudicator.isTester`, set from the **Tester** column of the
feedback overview (or the adjudicator's edit dialog). Members of the adjudication core are always
testers (their checkbox is ticked and locked). An adjudicator counts as *tested* in a round when a
tester other than themselves sat on their panel (`src/lib/adjudicators/testers.ts`, Tabbycat
`adjfeedback/testers.py`); the per-adjudicator page marks those rounds "Tested". The feedback
overview also has an inline **Breaking** column, as Tabbycat's.

## Duplicate feedback

*Feedback → Duplicate feedback* (`/feedback/duplicates`) lists feedback submitted more than once by
the same team or adjudicator on the same target in the same debate (Tabbycat's
`printmultiplefeedback` command), with the usual confirm / ignore controls on each copy. It changes
nothing by itself.
