# Tournament rules enforcement

Which tournament actions CrabbyTab refuses, which it allows only with a recorded reason, and
where each rule is checked. The rules are in
`src/features/tournament/application/stateGuards.ts`.

## How a rule is enforced

Every rule is a pure function that returns typed violations (`GuardViolation`: a rule id, a
readable message, and whether it may be overridden). The same function is used in three
places:

1. **The command** that performs the action (`draws.ts`, `rounds.ts`, `ballots.ts`,
   `allocation.ts`, `breaks.ts`, `roundAdministration.ts`, `settings.ts`, `entities.ts`) checks
   the rules before it changes anything and throws a `TournamentRuleError`. No page, import or
   other UI path can skip it.
2. **The UI** uses the same functions to disable buttons and explain why (publishing results,
   the format settings), and shows the command's message when an action is refused.
3. **Server routes that write tournament data** (private portal sync, data-entry assistant
   sync) apply the rules that concern them, because those writes never pass through the
   administrator's commands.

A violation is either:

- **Hard:** the action is refused. There is no override.
- **Overridable:** the action is refused unless it is given an explicit
  `override: { reason }`. The reason, the action and every overridden rule are recorded in the
  audit log as a `rules.overridden` event before the action runs. Nothing is relaxed silently.

In the app, an overridable refusal opens the **rule override dialog** (`RuleOverrideHost`). It
lists the rules, asks for a reason, and runs the action again with it. Cancelling keeps the
refusal. The dialog is only mounted for tournament administrators, so data-entry assistants
are never offered an override.

## Rules

"Finished" round means every non-bye debate has a confirmed, non-discarded ballot and no debate
is postponed (`getRoundCompletionBlockers`). "Published" draw means `drawStatus` is
`confirmed` or `released`. "Live" ballot means not discarded.

### Draws

| Action | Rule | Kind | Enforced in |
| --- | --- | --- | --- |
| Generate a preliminary draw | Every earlier preliminary round is finished (`previous_round_incomplete`). Unfinished results do not count towards power pairing. | Overridable | `generateDrawCommand` |
| Generate an elimination draw | The round has a generated break (`break_not_generated`) and every earlier elimination round of the same category has advanced (`previous_elimination_not_advanced`). | Hard | `generateDrawCommand` |
| Regenerate a draw | Not in a cancelled (`round_cancelled`), completed (`round_completed`) or advanced (`elimination_advanced`) round. | Hard | `generateDrawCommand` |
| Regenerate a draw | Not a published draw (`draw_released`), and no later round was drawn after it (`later_round_drawn`). | Overridable | `generateDrawCommand` |
| Regenerate a draw with ballots | The existing explicit "discard these results" confirmation; the ballots are kept as discarded versions. | Confirmation | `generateDrawCommand` (`DrawHasResultsError`) |
| Publish a draw | The round has debates (`draw_empty`). | Hard | `updateRoundCommand` |
| Publish a draw | The draw check (`validateDraw`) finds no errors (`draw_invalid`). Warnings never block. | Overridable | `updateRoundCommand` |

The overview page no longer generates a draw directly: its button opens the draw page, which
runs the venue check and the regeneration confirmations first.

### Editing draws and allocations

Compared per debate between the old and new draw (`checkDebateEdits`):

| Change | Rule | Kind |
| --- | --- | --- |
| Delete a debate, or change its teams or sides, when it has a live ballot | `debate_has_ballots` | Hard (discard the ballot first) |
| Change a debate's panel when it has a live ballot | `debate_has_ballots` | Overridable |
| Add, delete or re-pair debates in a published draw | `draw_released` | Overridable |
| Any team or panel change in a completed round | `round_completed` | Overridable |
| Any team or panel change in an advanced elimination round | `elimination_advanced` | Hard |
| Auto-allocate a round with live ballots, or a completed round | `debate_has_ballots`, `round_completed` | Overridable |

Changing rooms, venue requirements or a published draw's panels needs no override (Tabbycat
also allows these after release). Panel changes still hide revealed adjudicators, as before.

Enforced in `updateDebateCommand`, `updateDebatesCommand` and `autoAllocateCommand`.

### Results

| Action | Rule | Kind | Enforced in |
| --- | --- | --- | --- |
| Publish round results or team speaks | The round is finished (`results_incomplete`). | Hard | `updateRoundCommand`; the results page disables the buttons |
| Publish round results or team speaks | No ballot version is still waiting to be checked (`unconfirmed_ballots`). | Overridable | `updateRoundCommand` |
| Mark a round complete | The round is finished (`results_incomplete`). | Hard | `setRoundCompletion`, `updateRoundCommand` |
| Reopen a completed round | No later round has a draw (`later_round_drawn`). | Overridable | `updateRoundCommand` |
| Confirm, or discard the confirmed, ballot | Not in a cancelled (`round_cancelled`) or advanced elimination (`elimination_advanced`) round. | Hard | `submitBallotCommand`, `confirmBallotCommand`, `discardBallotCommand` |
| Confirm, or discard the confirmed, ballot | Not in a completed round (`round_completed`); the message names later rounds drawn from its results. | Overridable | same |
| Save a ballot | Never overwrite a confirmed or discarded version, or another debate's ballot, in place (`ballot_locked`). Save a new version instead. Rewriting an unconfirmed draft is allowed. | Hard | `submitBallotCommand` |
| Confirm a tab-room ballot when double entry is on | A different signed-in person checks it: you cannot confirm a version you entered, and a ballot saved as confirmed must be a check (`checksVersion`) of someone else's pending version (`same_person_check`). Judges' private-URL ballots and signed-out single-device use are exempt. | Overridable | `confirmBallotCommand`, `submitBallotCommand` (`checkIndependentConfirmation`) |

Entering an unconfirmed ballot version is always allowed: it changes no result. Confirming or
discarding a result still withdraws released results for the round, as before.

### Rounds

| Action | Rule | Kind | Enforced in |
| --- | --- | --- | --- |
| Cancel a round (including by lowering the preliminary round count) | It has no live ballots (`round_has_results`). | Hard | `setPreliminaryRoundCountCommand`, `updateRoundCommand` |
| Cancel a round | It has no draw (`round_has_draw`). | Overridable | same |
| Delete a round | It has no live ballots (`round_has_results`), and no later round was drawn after it (`later_round_drawn`). | Overridable | `deleteRoundCommand` |
| Delete a round | It is not an advanced elimination round (`elimination_advanced`). | Hard | `deleteRoundCommand` |

### Breaks

| Action | Rule | Kind | Enforced in |
| --- | --- | --- | --- |
| Generate a break | Every preliminary round is finished (`prelims_incomplete`). | Overridable | `generateBreakCommand` |
| Generate (or regenerate) a break | No elimination round it would reschedule, or that hosts the category, has a draw or has advanced (`elimination_started`). | Hard | `generateBreakCommand` |
| Generate (or regenerate) a break | No teams tied on every standings metric straddle the last breaking place (`break_cutoff_tie`) or the last reserve place (`reserve_cutoff_tie`); resolve with break overrides. | Hard | `generateBreakCommand` (the break page lists the tie) |
| Delete a break category | It has no generated break and no drawn elimination round (`break_category_in_use`). | Hard | `saveBreakCategoriesCommand` (the break page shows the same message) |

Generating a break now resets an elimination round's advancement only when that round's
category schedule changes. Before, it reset every elimination round.

### Settings

| Change after any live ballot exists | Rule | Kind |
| --- | --- | --- |
| Format, teams per debate, speakers per team, reply speeches, ballot mode | `settings_locked` | Hard (existing ballots would no longer match) |
| Speaker and reply score ranges and step, ghost speeches in team scores, margins including dissenters, low-point wins, forfeits, bye results | `scoring_changed_after_ballots` | Overridable |

Enforced in `saveTournamentCommand`. The settings form disables the locked fields and says why.
Discarded ballots do not lock anything.

### Deleting records

| Record | Refused while it is referenced by | Kind |
| --- | --- | --- |
| Team | a debate (including a bye), a ballot, or feedback | Hard. Mark the team unavailable instead. |
| Adjudicator | a panel, a ballot (submitter, chair or voting sheet), or feedback | Hard. Mark the adjudicator unavailable instead. |
| Venue | a debate | Hard. Mark the venue unavailable instead. |
| Institution | a team or adjudicator | Hard. |

Enforced in `createTournamentEntityCommands`. Rounds and debates have their own rules above.

The standings calculator counts a ballot only for a debate that exists and still has the
ballot's teams. Before, a ballot whose debate was missing passed the filter, although it was
never looked up afterwards, so it did not change standings; the check is now explicit.

### Private portals (server)

In `src/app/api/private/sync/route.ts`:

- Adjudicators, like teams, only see and submit for debates of **published draws**. A
  submission for an unpublished draw is refused (403).
- A chair's ballot normally confirms itself and supersedes earlier portal ballots. In a
  **locked round** (`isRoundLockedForPortalBallots`: completed, results or team speaks
  published, advanced, or cancelled) it is stored as an **unconfirmed** new version for the tab
  room, and nothing earlier is discarded. A ballot the tab room confirmed is never superseded,
  as before.

### Data-entry assistants

- Server (`data-entry-sync` route): an assistant's ballot is accepted only for a round whose
  draw is published, and that is neither cancelled nor advanced
  (`remoteBallotSubmissionBlocker`). Otherwise it is archived as a rejected sync conflict for
  the tab room, like other refused records. Assistants still cannot confirm ballots or change
  draws, rounds or settings; the route only accepts their whitelisted collections.
- UI: the overview's "Generate draw" button and the results page's publication and lifecycle
  card are shown only to administrators. Assistants keep `/results`, because ballot entry is
  there. The override dialog is not mounted for them, so any overridable rule is a refusal.

## Left to the UI or out of scope

- **Firestore security rules** still check identity, not tournament state. An administrator's
  upload writes whatever their device holds; the commands above are what keep that state legal.
  Checking tournament state in security rules would need many extra document reads per write on
  the Spark tier.
- **Generating a draw with too few available venues** is still checked only by the draw page,
  before it calls the command (as before). Publishing such a draw is caught by the draw check.
- **Silent rounds** may be toggled at any time; turning one on withdraws released results.

## Tests

- `stateGuards.test.ts`: every rule, allowed and blocked, and the override behaviour.
- `stateGuards.commands.test.ts`: each command refuses without an override, succeeds and writes a
  `rules.overridden` audit event with one, and refuses hard rules even with one.
- `ruleOverridePrompt.test.ts`: the override dialog flow.
- `privateSync.test.ts`: portal ballots in locked rounds.
