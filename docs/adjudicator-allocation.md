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

## Feedback progress

The progress panel expects each team to rate the chair. Adjudicators are expected to rate
each other according to the feedback path:

- *chairs → panel:* the chair rates the panel.
- *two-way:* the chair and the panel rate each other.
- *everyone:* every adjudicator rates every other adjudicator.

Any submission from that source about that target in the round counts as received,
including ignored ones.
