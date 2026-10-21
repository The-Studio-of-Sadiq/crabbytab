# Adjudicator allocation and preformed panels

The **Allocation** page (sidebar → *Round · R1* → **Allocation**, administrators and staff with the allocation permission) assigns adjudicators to the round's debates automatically and lets you adjust panels by hand. Assignments stay private until you reveal them. Exact formulas: [`docs/adjudicator-allocation.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/adjudicator-allocation.md).

Allocation is a **heuristic**: it finds a good allocation, not a proven optimum.

## Step by step

1. Check adjudicator availability on the round's **Availability** page ([how](Check-ins-and-Availability)).
2. On the Allocation page, choose the round and, under **Allocation engine**, the panel sizing (*Same size everywhere* with a *Panel size*, or *Larger in priority rooms* with a *Largest panel*) and the round's **Feedback weight (%)**.
3. Optionally set room importance: per debate (0–10), or for every room with **Prioritise by bracket** or **Prioritise by liveness** (below).
4. Press **Auto-Allocate All**. Warnings (clashes, rooms short of adjudicators, unavailable preformed-panel members) are listed under *Allocated with warnings*.
5. Adjust by hand. Clashes show on each panel.
6. Allocate rooms on the Draw page (**Allocate venues**) if you have not yet; see [Venues and constraints](Venues-and-Constraints).
7. Release the draw, then press **Reveal Adjudicators** so teams and the public see the panels (after the release uploads).

Other controls: **Clear Allocations** (with confirmation), **Priority Info** (each debate's priority and panel strength), **Diversity** (gender and region badges and a per-panel summary), **Shards** (below), and the **Preformed panels** link.

## Who is allocated

- Adjudicators available for the round, unless *Skip adjudicator check-ins* is on. Adjudicators busy in a concurrent round are left out.
- Adjudicators scoring below *Minimum adjudicator score to vote* (default 1.5) are placed as trainees, never left out, as in Tabbycat.
- Trainees are seated after the voting panels unless *No trainee adjudicators* is on; *No panellist adjudicators* allocates chairs (and trainees) only. With either switch on, the editor hides and refuses that position.
- Auto-allocation is refused, leaving existing panels untouched, when no adjudicator is available or none may vote.
- Allocating a draft draw is allowed. Re-allocating a draw already released, or a round with live ballots or that is completed, needs a recorded reason.

These switches and the penalties below are on *Admin → Configuration → Draw rules → Adjudicator allocation and panel rules*.

## Adjudicator scores

- **Pre-feedback score:** the test score if set, otherwise the base score (1–10).
- **Feedback average:** weighted average of counted feedback (confirmed and not ignored), mapped from the feedback scale onto 1–10. Weights come from *Feedback weighting by source* on the Feedback page.
- **Blended score:** `(1 − w) × pre-feedback + w × feedback average`, where `w` is the round's **feedback weight**. Adjudicators without counted feedback keep their pre-feedback score.

> New rounds start with feedback weight **100%**, so once an adjudicator has counted feedback it *replaces* their base or test score. Lower the weight if base scores should keep influence. A round without a weight blends at 60% (CrabbyTab's strategies) or uses the base score (Tabbycat strategies).

## Debate priority and liveness

CrabbyTab's own strategy ranks debates by a blend of the bracket (40%), **break liveness** (40%) and the manual importance (20%), then, with less weight, room priority.

Liveness follows Tabbycat: per break category, a team is *live*, *safe* or *dead* from the completed rounds. It shows in standings, on the Draw page (*Live teams: N* per room) and on the Allocation page (*N% live* per debate).

Two buttons set every room's importance at once (replacing importances already set in the round):

- **Prioritise by bracket**: splits the rooms into quarters by bracket and sets importance 10, 7, 3 and 0, highest brackets first.
- **Prioritise by liveness**: uses the general break's live thresholds before the round: rooms where every team is safe get 7, rooms where every team is dead get 0, every other room 10. Available in preliminary rounds with a general break category of more than one team.

## Allocation strategies

*Configuration → Draw rules → Adjudicator allocation strategy*:

| Strategy | Behaviour |
| --- | --- |
| **Preset 1 — Current CrabbyTab allocation** (`crabbytab_v1`, default) | Seat ranks matched to adjudicator ranks by priority; panel size from the Allocation page. |
| **Panel average** (`panel_average`) | As Preset 1, but each panel's average strength is matched to the debate priority. |
| **Tabbycat voting** (`tabbycat_voting`) | Port of Tabbycat's `hungarian-voting`: the strongest adjudicators chair the most important rooms alone; the rest form panels of three. Ignores panel size. |
| **Tabbycat consensus** (`tabbycat_consensus`) | Port of Tabbycat's `hungarian-consensus`: every voter is spread as evenly as possible; the most important rooms get the extra member. Ignores panel size. |

The Tabbycat ports use Tabbycat's cost function, its 0–5 score scale (mapped from CrabbyTab's 1–10) and each debate's own importance; debates are taken by importance, then room rank. Tabbycat itself always uses its voting allocator for per-adjudicator ballots and its consensus allocator otherwise; in CrabbyTab you choose.

### How CrabbyTab's own strategies work

1. **Preformed panels** are placed first (below).
2. **Panel sizes:** *Same size everywhere* gives every debate the chosen size, dropping seats from the lowest-priority debates when adjudicators run out; *Larger in priority rooms* gives every debate a chair, then grows panels to 3, 5, … in priority order.
3. A **Hungarian assignment** fills the seats, with costs for strength mismatch (*Importance mismatch penalty*), team conflicts (*Adjudicator conflict penalty*) and teams already judged (*Adjudicator history penalty*, soft).
4. A **local search** reduces adjudicator–adjudicator conflicts and repeated co-panelling (bounded so large tournaments stay responsive).
5. **Trainees** go, lowest-scored first, to the debate with the lowest conflict cost, then fewest trainees, then lowest priority.
6. The strongest panel member without a team clash becomes **chair**.

With the default penalties (conflict 1,000,000, history 10,000, mismatch 10,000,000), one conflict always costs more than any strength mismatch, and a one-point mismatch more than one repeat. Penalties are used exactly as configured: a low conflict penalty can let a conflict through (it is reported), and 0 turns that check off. Every remaining clash is listed on the result and in the audit log.

Allocation runs in a background worker; a **Cancel** button stops a long run and saves nothing.

## Conflicts

Conflicts are edited in the adjudicator dialog (Setup → **Adjudicators**: *Team conflicts*, *Adjudicator conflicts*, *Other institution conflicts*) and on Setup → **Conflicts** (CSV import, team–institution conflicts, full list). An adjudicator clashes with a team when:

- **institutional**: the adjudicator's own institution (unless independent) or a declared institution matches the team's institution, a composite team's other institutions, or an institution the **team** declared a conflict with;
- **personal**: the adjudicator declared a conflict with that team;
- **history** (soft): the adjudicator has judged the team before.

Two adjudicators clash when either declared a personal conflict with the other, or they share a conflicted institution. Clashes are shown on the panel ("Institutional", "Personal", "Adjudicator", "History") and in the draw check. Conflicts are never shown publicly. See [Participants and imports](Participants-and-Imports#conflicts).

## Editing panels by hand

Drag judges from **Available Adjudicators** (searchable by name or institution) onto a chair, panellist or trainee slot, or use the keyboard and touch equivalent: **Move** picks a judge, then each debate offers **Place as chair** (**Replace chair** when one is set; the old chair returns to the pool), **Add as panellist** and **Add as trainee**, or **Return to pool**. Arrow keys, Home and End move between targets; Escape cancels. A clash preview shows while a judge is picked, and refusals (for example a trainee dropped on a chair slot) are announced.

Changing a panel after **Reveal Adjudicators** hides the adjudicators again; reveal once you are done. For cloud tournaments, panels are written live: another administrator device sees each change within seconds. Two devices editing the same panel: the last full panel written wins (panels are never mixed).

### Shards

For large rounds, **Shards** splits the board into 2–6 parts to work on: sort by *Bracket*, *Priority* or *Venue*, and mix *Top to bottom* or *Interleaved*. A shard is only a view: auto-allocation and the conflict checks always cover the whole round.

## Preformed panels

Preformed panels let the adjudication core build panels before the draw exists (**Preformed panels** link on the Allocation page, `/{slug}/allocation/panels`).

1. Turn on *Allocate preformed panels as a unit* (Configuration → Draw rules); otherwise auto-allocation ignores the panels.
2. Pick the round and create panels: **Add panel**, **Create from CSV panel ids** (from the adjudicator import's `preformed_panel_id`), or **Create from anticipated draw**: one panel per room the next draw is expected to have, annotated with its possible bracket range and how many teams may still be live (Tabbycat's anticipated draw).
3. Set importance: by hand (0–10), **Prioritise by bracket** or **Prioritise by liveness** (live panels 10, safe 7, the rest 0).
4. Fill members by hand, or **Auto-allocate adjudicators** (Tabbycat's voting or consensus allocator over the panels, replacing members). Review, then **Save panels**.

When allocating, *Placing preformed panels* decides how panels reach debates:

- **Optimised (importance, conflicts, history)** (default): Tabbycat's Hungarian preformed-panel allocator. A panel goes where its importance matches the debate's importance, with team conflicts and history added as costs.
- **By room rank (no optimisation)**: Tabbycat's direct allocator: the panel with the lowest room rank goes to the debate with the lowest room rank, and so on.

Members unavailable this round are left out and named in the warnings; a panel with no available voting member is not placed. Debates without a panel are then filled by the normal allocator.

## Testers

An adjudicator can be marked **Tester** (adjudicator dialog, or the *Tester* column on the feedback overview); members of the adjudication core always are. An adjudicator counts as *tested* in a round when another tester sat on their panel; the adjudicator record marks those rounds "Tested". See [Feedback](Feedback).

## Differences from Tabbycat

- CrabbyTab allows allocating a draft draw (its draws can be released straight from draft); Tabbycat requires a confirmed draw. Re-allocating a released draw needs a reason instead of being refused.
- The Tabbycat strategies do not shuffle voters (ties break by score, then id, so results are reproducible) and use a symmetric judged-together history.
- CrabbyTab's own strategies seat every trainee; Tabbycat's voting allocator may leave surplus trainees out.
- In optimised preformed-panel placement, debates without a panel are filled by the normal allocator (Tabbycat clears them).

## Limitations

- Diversity (gender, region) is shown, but is not an allocation constraint.
- The Hungarian matching is O(n³); with ~1000 seats it takes a second or more, much longer when every adjudicator has the same score. It runs in a Web Worker, so the page stays usable.
