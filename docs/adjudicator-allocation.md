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
   member is not placed.
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

## Feedback paths

*Settings → Adjudicator Feedback → Feedback paths* says who gives feedback on whom
(`TournamentPreferences.feedbackPaths`, `src/lib/feedback/paths.ts`), as Tabbycat's
"feedback from teams" and "feedback paths" settings:

- **Teams** give feedback on the chair only, on every adjudicator on the panel, or nobody.
- **Adjudicators:** chair on panellists, chair on trainees, panellists on chair, trainees on
  chair, each switched separately, or *every adjudicator on every other* (trainees included).
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
ones.

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
listed. The page shows it next to the feedback-derived score history by round.
