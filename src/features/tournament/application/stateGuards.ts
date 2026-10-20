import type {
  Adjudicator,
  AuditCategory,
  BallotSubmission,
  BreakCategory,
  Debate,
  FeedbackSubmission,
  Institution,
  Round,
  Team,
  Tournament,
  TournamentPreferences,
} from "@/types";
import type { BreakCategoryResult } from "@/lib/breakqual/calculator";
import { ballotModeFor } from "@/lib/ballots/result";
import {
  concurrentRoundClashes,
  describeConcurrentClashes,
  isEarlierScheduleSlot,
  scheduleGroupOf,
} from "./schedule";

/**
 * Tournament state rules. Every rule here is checked by the command that performs the action (so
 * no UI path can skip it), by the UI to disable and explain actions, and, where a server route
 * writes tournament data, by that route. See docs/tournament-rules-enforcement.md.
 *
 * A violation is either a hard block or overridable. An overridable violation only lets the
 * action through with an explicit `RuleOverride` whose reason is recorded in the audit log;
 * nothing is ever relaxed silently.
 */

export type GuardRule =
  | "round_cancelled"
  | "previous_round_incomplete"
  | "previous_elimination_not_advanced"
  | "break_not_generated"
  | "round_completed"
  | "elimination_advanced"
  | "draw_released"
  | "later_round_drawn"
  | "draw_empty"
  | "draw_invalid"
  | "results_incomplete"
  | "unconfirmed_ballots"
  | "debate_has_ballots"
  | "ballot_locked"
  | "settings_locked"
  | "scoring_changed_after_ballots"
  | "entity_in_use"
  | "round_has_results"
  | "round_has_draw"
  | "prelims_incomplete"
  | "elimination_started"
  | "break_cutoff_tie"
  | "reserve_cutoff_tie"
  | "break_category_in_use"
  | "same_person_check"
  /** A team, adjudicator or venue is in two rounds of the same schedule slot. */
  | "concurrent_round_clash";

export interface GuardViolation {
  rule: GuardRule;
  message: string;
  /** True when a tab director may proceed by recording a reason. */
  overridable: boolean;
  roundId?: string;
  debateId?: string;
}

export interface RuleOverride {
  /** Why the tab room is proceeding anyway. Recorded verbatim in the audit log. */
  reason: string;
}

/** Thrown by a command when its action is not allowed in the current tournament state. */
export class TournamentRuleError extends Error {
  constructor(readonly violations: GuardViolation[]) {
    super(violations.map((violation) => violation.message).join(" "));
    this.name = "TournamentRuleError";
  }

  /** True when every violation may be overridden with a recorded reason. */
  get overridable(): boolean {
    return this.violations.length > 0 && this.violations.every((violation) => violation.overridable);
  }
}

export function isTournamentRuleError(error: unknown): error is TournamentRuleError {
  return error instanceof TournamentRuleError;
}

export function validOverride(override: RuleOverride | undefined): override is RuleOverride {
  return typeof override?.reason === "string" && override.reason.trim().length > 0;
}

/**
 * Throws unless the action may proceed. Hard violations always block; overridable ones block
 * unless an override with a non-empty reason is given. Returns the violations that were
 * overridden, for the audit log.
 */
export function enforceGuards(
  violations: GuardViolation[],
  override?: RuleOverride
): GuardViolation[] {
  if (violations.length === 0) return [];
  if (violations.some((violation) => !violation.overridable) || !validOverride(override)) {
    throw new TournamentRuleError(violations);
  }
  return violations;
}

export interface RuleOverrideAuditEvent {
  action: string;
  category: AuditCategory;
  summary: string;
  roundId?: string;
  debateId?: string;
  details?: Record<string, unknown>;
}

/** The audit event recorded whenever an action proceeds past overridden rules. */
export function ruleOverrideAuditEvent(
  overriddenAction: string,
  category: AuditCategory,
  violations: GuardViolation[],
  override: RuleOverride,
  roundId?: string
): RuleOverrideAuditEvent {
  return {
    action: "rules.overridden",
    category,
    summary: `Rule override for ${overriddenAction}: ${override.reason.trim()}`,
    roundId,
    details: {
      overriddenAction,
      reason: override.reason.trim(),
      rules: violations.map((violation) => ({
        rule: violation.rule,
        message: violation.message,
        ...(violation.roundId ? { roundId: violation.roundId } : {}),
        ...(violation.debateId ? { debateId: violation.debateId } : {}),
      })),
    },
  };
}

/** Enforces the rules and records any override. Commands call this before changing anything. */
export async function applyGuards(
  violations: GuardViolation[],
  override: RuleOverride | undefined,
  audit: {
    action: string;
    category: AuditCategory;
    roundId?: string;
    record(event: RuleOverrideAuditEvent): Promise<void>;
  }
): Promise<void> {
  const overridden = enforceGuards(violations, override);
  if (overridden.length > 0 && override) {
    await audit.record(
      ruleOverrideAuditEvent(audit.action, audit.category, overridden, override, audit.roundId)
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

function hard(rule: GuardRule, message: string, extra: Partial<GuardViolation> = {}): GuardViolation {
  return { rule, message, overridable: false, ...extra };
}

function soft(rule: GuardRule, message: string, extra: Partial<GuardViolation> = {}): GuardViolation {
  return { rule, message, overridable: true, ...extra };
}

/** Released means participants can see it (the draw page calls this "published"). */
export function isDrawReleased(round: Pick<Round, "drawStatus"> | undefined): boolean {
  return round?.drawStatus === "confirmed" || round?.drawStatus === "released";
}

function liveBallots(ballots: BallotSubmission[]): BallotSubmission[] {
  return ballots.filter((ballot) => !ballot.discarded);
}

function debateIdsOfRound(roundId: string, debates: Debate[]): Set<string> {
  return new Set(debates.filter((debate) => debate.roundId === roundId).map((debate) => debate.id));
}

/** Non-discarded ballots recorded against the round's current draw. */
export function liveRoundBallots(
  roundId: string,
  debates: Debate[],
  ballots: BallotSubmission[]
): BallotSubmission[] {
  const debateIds = debateIdsOfRound(roundId, debates);
  return liveBallots(ballots).filter(
    (ballot) => debateIds.has(ballot.debateId) || ballot.roundId === roundId
  );
}

function teamKey(debate: Debate): string {
  return JSON.stringify(
    Object.entries(debate.teams || {})
      .map(([side, slot]) => [side, slot?.teamId ?? ""])
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
  );
}

function adjudicatorKey(debate: Debate): string {
  const panel = debate.adjudicators;
  return JSON.stringify([panel?.chairId ?? "", panel?.panellistIds ?? [], panel?.traineeIds ?? []]);
}

function debateLabel(debate: Debate): string {
  const teamNames = Object.values(debate.teams || {})
    .map((slot) => slot?.teamName)
    .filter(Boolean)
    .join(" vs ");
  return debate.venueName || teamNames || debate.id;
}

/** Drawn rounds in later schedule slots (concurrent rounds are not drawn from this one). */
function laterDrawnRounds(round: Round, rounds: Round[], debates: Debate[]): Round[] {
  const drawnRoundIds = new Set(debates.map((debate) => debate.roundId));
  const slot = scheduleGroupOf(round);
  return rounds.filter(
    (item) => !item.cancelled && scheduleGroupOf(item) > slot && item.id !== round.id && drawnRoundIds.has(item.id)
  );
}

function names(rounds: Round[]): string {
  return rounds.map((round) => round.name).join(", ");
}

/* -------------------------------------------------------------------------- */
/* Round completion                                                            */
/* -------------------------------------------------------------------------- */

export type RoundCompletionBlockerReason = "no_draw" | "postponed" | "unconfirmed_ballot";

export interface RoundCompletionBlocker {
  reason: RoundCompletionBlockerReason;
  debateId?: string;
  message: string;
}

/**
 * Lists what prevents a round from being complete. A round is complete once every non-bye debate
 * has a confirmed, non-discarded ballot (with several ballot versions, only the confirmed one
 * counts).
 */
export function getRoundCompletionBlockers(
  round: Round,
  debates: Debate[],
  ballots: BallotSubmission[]
): RoundCompletionBlocker[] {
  const roundDebates = debates.filter((debate) => debate.roundId === round.id);
  if (roundDebates.length === 0) {
    return [{ reason: "no_draw", message: `${round.name} has no draw yet.` }];
  }
  const confirmedDebateIds = new Set(
    ballots
      .filter((ballot) => ballot.roundId === round.id && ballot.confirmed && !ballot.discarded)
      .map((ballot) => ballot.debateId)
  );
  const blockers: RoundCompletionBlocker[] = [];
  for (const debate of [...roundDebates].sort((left, right) => left.roomRank - right.roomRank)) {
    if (debate.byeTeamId) continue;
    if (debate.postponed) {
      blockers.push({ reason: "postponed", debateId: debate.id, message: `${debateLabel(debate)} is postponed.` });
      continue;
    }
    if (!confirmedDebateIds.has(debate.id)) {
      blockers.push({
        reason: "unconfirmed_ballot",
        debateId: debate.id,
        message: `${debateLabel(debate)} has no confirmed ballot.`,
      });
    }
  }
  return blockers;
}

/** Ballot versions entered but neither confirmed nor discarded: someone still has to check them. */
export function pendingBallots(
  roundId: string,
  debates: Debate[],
  ballots: BallotSubmission[]
): BallotSubmission[] {
  return liveRoundBallots(roundId, debates, ballots).filter((ballot) => !ballot.confirmed);
}

export interface RoundGuardState {
  rounds: Round[];
  debates: Debate[];
  ballots: BallotSubmission[];
}

/* -------------------------------------------------------------------------- */
/* Draw generation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Rules for generating (or regenerating) a round's draw. Results already attached to the round
 * are handled separately by the explicit "discard existing results" confirmation.
 */
export function checkDrawGeneration(round: Round, state: RoundGuardState): GuardViolation[] {
  const { rounds, debates, ballots } = state;
  const violations: GuardViolation[] = [];
  const roundId = round.id;
  if (round.cancelled) {
    return [hard("round_cancelled", `${round.name} is cancelled.`, { roundId })];
  }
  if (round.completed) {
    violations.push(hard(
      "round_completed",
      `${round.name} is marked complete. Reopen it before regenerating its draw.`,
      { roundId }
    ));
  }
  if (round.eliminationAdvanced) {
    violations.push(hard(
      "elimination_advanced",
      `Teams have already advanced from ${round.name}, so its draw can no longer be regenerated.`,
      { roundId }
    ));
  }

  if (round.stage === "preliminary") {
    // Power pairing reads the standings, so every preliminary round in an earlier schedule slot
    // should be finished. Concurrent rounds (same slot) run at the same time and are not waited for.
    const unfinished = rounds
      .filter((item) => item.stage === "preliminary" && !item.cancelled && isEarlierScheduleSlot(item, round))
      .sort((left, right) => left.seq - right.seq)
      .flatMap((item) => {
        const blockers = getRoundCompletionBlockers(item, debates, ballots);
        return blockers.length > 0 ? [{ round: item, blockers }] : [];
      });
    for (const { round: earlier, blockers } of unfinished) {
      const detail = blockers.length === 1 ? blockers[0].message : `${blockers.length} debates are unfinished.`;
      violations.push(soft(
        "previous_round_incomplete",
        `${earlier.name} is not finished: ${detail} Its results will not count towards this draw.`,
        { roundId: earlier.id }
      ));
    }
  } else {
    if (!round.breakCategoryIds?.length) {
      violations.push(hard(
        "break_not_generated",
        `No break has been generated for ${round.name}. Generate the break first.`,
        { roundId }
      ));
    } else {
      const notAdvanced = rounds.filter((item) =>
        item.stage === "elimination" &&
        !item.cancelled &&
        item.seq < round.seq &&
        !item.eliminationAdvanced &&
        item.breakCategoryIds?.some((categoryId) => round.breakCategoryIds?.includes(categoryId))
      );
      if (notAdvanced.length > 0) {
        violations.push(hard(
          "previous_elimination_not_advanced",
          `Advance the teams from ${names(notAdvanced)} before drawing ${round.name}.`,
          { roundId }
        ));
      }
    }
  }

  const existingDraw = debates.some((debate) => debate.roundId === roundId);
  if (existingDraw && isDrawReleased(round)) {
    violations.push(soft(
      "draw_released",
      `The ${round.name} draw is already published; participants may have seen it.`,
      { roundId }
    ));
  }
  if (existingDraw) {
    const later = laterDrawnRounds(round, rounds, debates);
    if (later.length > 0) {
      violations.push(soft(
        "later_round_drawn",
        `${names(later)} already ${later.length === 1 ? "has a draw" : "have draws"} based on this round.`,
        { roundId }
      ));
    }
  }
  return violations;
}

/* -------------------------------------------------------------------------- */
/* Round status changes (release, completion, cancellation)                   */
/* -------------------------------------------------------------------------- */

export interface DrawCheckIssue {
  severity: "error" | "warning";
  message: string;
}

export function checkDrawRelease(
  round: Round,
  state: RoundGuardState,
  drawIssues: DrawCheckIssue[]
): GuardViolation[] {
  const roundId = round.id;
  if (round.cancelled) return [hard("round_cancelled", `${round.name} is cancelled.`, { roundId })];
  if (!state.debates.some((debate) => debate.roundId === roundId)) {
    return [hard("draw_empty", `${round.name} has no debates to publish.`, { roundId })];
  }
  const errors = drawIssues.filter((issue) => issue.severity === "error");
  if (errors.length === 0) return [];
  return [soft(
    "draw_invalid",
    `The draw check found ${errors.length} problem${errors.length === 1 ? "" : "s"}: ` +
      errors.slice(0, 3).map((issue) => issue.message).join(" ") +
      (errors.length > 3 ? ` (and ${errors.length - 3} more)` : ""),
    { roundId }
  )];
}

/**
 * Rounds in one schedule slot run at the same time, so none of their teams, adjudicators or
 * venues may appear in two of them. Overridable: Tabbycat itself does not check this.
 */
export function checkConcurrentRoundClashes(round: Round, state: RoundGuardState): GuardViolation[] {
  if (round.cancelled) return [];
  const clashes = concurrentRoundClashes(round, state.rounds, state.debates);
  return clashes.length === 0
    ? []
    : [soft("concurrent_round_clash", describeConcurrentClashes(round, clashes), { roundId: round.id })];
}

/** Rules for publishing a round's results or team speaker scores. */
export function checkResultsRelease(round: Round, state: RoundGuardState): GuardViolation[] {
  const roundId = round.id;
  if (round.cancelled) return [hard("round_cancelled", `${round.name} is cancelled.`, { roundId })];
  const violations: GuardViolation[] = [];
  const blockers = getRoundCompletionBlockers(round, state.debates, state.ballots);
  if (blockers.length > 0) {
    violations.push(hard(
      "results_incomplete",
      `${round.name} results cannot be published yet: ` +
        (blockers.length <= 3
          ? blockers.map((blocker) => blocker.message).join(" ")
          : `${blockers.length} debates have no confirmed result.`),
      { roundId }
    ));
  }
  const pending = pendingBallots(roundId, state.debates, state.ballots);
  if (pending.length > 0) {
    const debateCount = new Set(pending.map((ballot) => ballot.debateId)).size;
    violations.push(soft(
      "unconfirmed_ballots",
      `${pending.length} ballot version${pending.length === 1 ? "" : "s"} in ${debateCount} debate${debateCount === 1 ? "" : "s"} ` +
        "are still waiting to be checked; publishing shows the currently confirmed results.",
      { roundId }
    ));
  }
  return violations;
}

/** Rules for marking a round complete (`completed: true`). */
export function checkRoundCompletion(round: Round, state: RoundGuardState): GuardViolation[] {
  const roundId = round.id;
  if (round.cancelled) return [hard("round_cancelled", `${round.name} is cancelled.`, { roundId })];
  const blockers = getRoundCompletionBlockers(round, state.debates, state.ballots);
  return blockers.length > 0
    ? [hard(
        "results_incomplete",
        `${round.name} cannot be completed: ${blockers.map((blocker) => blocker.message).join(" ")}`,
        { roundId }
      )]
    : [];
}

/** Rules for reopening a completed round. */
export function checkRoundReopen(round: Round, state: RoundGuardState): GuardViolation[] {
  const later = laterDrawnRounds(round, state.rounds, state.debates);
  return later.length > 0
    ? [soft(
        "later_round_drawn",
        `${names(later)} already ${later.length === 1 ? "has a draw" : "have draws"} based on ${round.name}'s results. ` +
          "Changing those results will not update the later draw.",
        { roundId: round.id }
      )]
    : [];
}

/**
 * Every rule that applies to changing a round record from `previous` to `next`. Unchanged fields
 * are never checked, so saving an unrelated field (e.g. the feedback weight) is always allowed.
 */
export function checkRoundUpdate(
  previous: Round,
  next: Round,
  state: RoundGuardState,
  drawIssues: () => DrawCheckIssue[]
): GuardViolation[] {
  const violations: GuardViolation[] = [];
  if (!isDrawReleased(previous) && isDrawReleased(next)) {
    violations.push(...checkDrawRelease(next, state, drawIssues()));
    violations.push(...checkConcurrentRoundClashes(next, state));
  }
  if (
    (!previous.resultsReleased && next.resultsReleased) ||
    (!previous.teamSpeaksReleased && next.teamSpeaksReleased)
  ) {
    violations.push(...checkResultsRelease(next, state));
  }
  if (!previous.completed && next.completed && next.stage === "preliminary") {
    violations.push(...checkRoundCompletion(next, state));
  }
  if (previous.completed && !next.completed) {
    violations.push(...checkRoundReopen(next, state));
  }
  if (!previous.cancelled && next.cancelled) {
    violations.push(...checkRoundCancellation(next, state));
  }
  return dedupe(violations);
}

function dedupe(violations: GuardViolation[]): GuardViolation[] {
  const seen = new Set<string>();
  return violations.filter((violation) => {
    const key = `${violation.rule}|${violation.roundId ?? ""}|${violation.debateId ?? ""}|${violation.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Rules for cancelling a round (it stops counting, but keeps its records). */
export function checkRoundCancellation(round: Round, state: RoundGuardState): GuardViolation[] {
  const roundId = round.id;
  const results = liveRoundBallots(roundId, state.debates, state.ballots);
  if (results.length > 0) {
    return [hard(
      "round_has_results",
      `${round.name} has ${results.length} ballot${results.length === 1 ? "" : "s"}. ` +
        "Discard them (or regenerate the draw) before cancelling the round.",
      { roundId }
    )];
  }
  if (state.debates.some((debate) => debate.roundId === roundId)) {
    return [soft(
      "round_has_draw",
      `${round.name} already has a draw${isDrawReleased(round) ? " that has been published" : ""}.`,
      { roundId }
    )];
  }
  return [];
}

/** The preliminary rounds `setPreliminaryRoundCount(count)` would cancel. */
export function roundsCancelledByPreliminaryCount(rounds: Round[], count: number): Round[] {
  const target = Math.max(0, Math.min(20, Math.floor(count)));
  return rounds
    .filter((round) => round.stage === "preliminary" && !round.cancelled)
    .sort((left, right) => left.seq - right.seq)
    .slice(target);
}

export function checkPreliminaryRoundCount(count: number, state: RoundGuardState): GuardViolation[] {
  return roundsCancelledByPreliminaryCount(state.rounds, count)
    .flatMap((round) => checkRoundCancellation(round, state));
}

export function checkRoundDeletion(round: Round, state: RoundGuardState): GuardViolation[] {
  const roundId = round.id;
  const violations: GuardViolation[] = [];
  const hasDraw = state.debates.some((debate) => debate.roundId === roundId);
  if (hasDraw) {
    const later = laterDrawnRounds(round, state.rounds, state.debates);
    if (later.length > 0) {
      violations.push(soft(
        "later_round_drawn",
        `${names(later)} ${later.length === 1 ? "was" : "were"} drawn after ${round.name}, ` +
          "partly from its results; deleting it does not change those draws.",
        { roundId }
      ));
    }
  }
  const results = liveRoundBallots(roundId, state.debates, state.ballots);
  if (results.length > 0) {
    violations.push(soft(
      "round_has_results",
      `Deleting ${round.name} permanently removes its ${results.length} ballot${results.length === 1 ? "" : "s"}.`,
      { roundId }
    ));
  }
  if (round.eliminationAdvanced) {
    violations.push(hard(
      "elimination_advanced",
      `Teams have already advanced from ${round.name}, so it cannot be deleted.`,
      { roundId }
    ));
  }
  return violations;
}

/* -------------------------------------------------------------------------- */
/* Draw and allocation edits                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Rules for replacing `previous` debates with `next` (manual draw edits, venue changes,
 * allocations). Compared per debate: removing a debate or changing its teams after a ballot was
 * entered is never allowed (the ballot names those teams); changing a panel after a ballot is
 * overridable; changing matchups of a published draw is overridable.
 */
export function checkDebateEdits(
  previous: Debate[],
  next: Debate[],
  state: Pick<RoundGuardState, "rounds" | "ballots">
): GuardViolation[] {
  const roundsById = new Map(state.rounds.map((round) => [round.id, round]));
  const nextById = new Map(next.map((debate) => [debate.id, debate]));
  const previousIds = new Set(previous.map((debate) => debate.id));
  const ballotsByDebate = new Map<string, BallotSubmission[]>();
  for (const ballot of liveBallots(state.ballots)) {
    ballotsByDebate.set(ballot.debateId, [...(ballotsByDebate.get(ballot.debateId) ?? []), ballot]);
  }
  const violations: GuardViolation[] = [];
  const matchupChangedRounds = new Set<string>();
  const panelChangedRounds = new Set<string>();

  for (const before of previous) {
    const after = nextById.get(before.id);
    const round = roundsById.get(before.roundId);
    const ballots = ballotsByDebate.get(before.id) ?? [];
    const debateId = before.id;
    const roundId = before.roundId;
    if (!after) {
      if (ballots.length > 0) {
        violations.push(hard(
          "debate_has_ballots",
          `${debateLabel(before)} has ${ballots.length} ballot${ballots.length === 1 ? "" : "s"} and cannot be deleted. ` +
            "Discard its ballots first.",
          { roundId, debateId }
        ));
      }
      matchupChangedRounds.add(roundId);
      continue;
    }
    const teamsChanged = teamKey(before) !== teamKey(after);
    const panelChanged = adjudicatorKey(before) !== adjudicatorKey(after);
    if (teamsChanged) {
      matchupChangedRounds.add(roundId);
      if (ballots.length > 0) {
        violations.push(hard(
          "debate_has_ballots",
          `${debateLabel(before)} already has a ballot for its current teams. Discard it before changing the matchup.`,
          { roundId, debateId }
        ));
      }
    }
    if (panelChanged) {
      panelChangedRounds.add(roundId);
      if (ballots.length > 0) {
        violations.push(soft(
          "debate_has_ballots",
          `${debateLabel(before)} already has a ballot; changing its panel does not change who submitted it.`,
          { roundId, debateId }
        ));
      }
    }
    if ((teamsChanged || panelChanged) && round?.eliminationAdvanced) {
      violations.push(hard(
        "elimination_advanced",
        `Teams have already advanced from ${round.name}, so its draw can no longer change.`,
        { roundId, debateId }
      ));
    }
  }
  for (const debate of next) {
    if (!previousIds.has(debate.id)) matchupChangedRounds.add(debate.roundId);
  }

  for (const roundId of matchupChangedRounds) {
    const round = roundsById.get(roundId);
    if (!round) continue;
    if (round.completed) {
      violations.push(soft("round_completed", `${round.name} is marked complete.`, { roundId }));
    }
    if (isDrawReleased(round)) {
      violations.push(soft(
        "draw_released",
        `The ${round.name} draw is published; participants may already have seen these matchups.`,
        { roundId }
      ));
    }
  }
  for (const roundId of panelChangedRounds) {
    const round = roundsById.get(roundId);
    if (round?.completed && !matchupChangedRounds.has(roundId)) {
      violations.push(soft("round_completed", `${round.name} is marked complete.`, { roundId }));
    }
  }
  return dedupe(violations);
}

/** Rules for automatically re-allocating every adjudicator in a round. */
export function checkAutoAllocation(round: Round, state: RoundGuardState): GuardViolation[] {
  const roundId = round.id;
  if (round.cancelled) return [hard("round_cancelled", `${round.name} is cancelled.`, { roundId })];
  const violations: GuardViolation[] = [];
  if (round.eliminationAdvanced) {
    violations.push(hard(
      "elimination_advanced",
      `Teams have already advanced from ${round.name}, so its panels can no longer change.`,
      { roundId }
    ));
  }
  const results = liveRoundBallots(roundId, state.debates, state.ballots);
  if (results.length > 0) {
    violations.push(soft(
      "debate_has_ballots",
      `${round.name} already has ${results.length} ballot${results.length === 1 ? "" : "s"}; ` +
        "re-allocating replaces the panels that judged those debates.",
      { roundId }
    ));
  }
  if (round.completed) {
    violations.push(soft("round_completed", `${round.name} is marked complete.`, { roundId }));
  }
  return violations;
}

/* -------------------------------------------------------------------------- */
/* Ballots                                                                     */
/* -------------------------------------------------------------------------- */

function roundOfBallot(ballot: Pick<BallotSubmission, "roundId" | "debateId">, state: RoundGuardState): Round | undefined {
  const debate = state.debates.find((item) => item.id === ballot.debateId);
  return state.rounds.find((round) => round.id === (debate?.roundId ?? ballot.roundId));
}

/** Rules for recording (or changing) the confirmed result of a debate. */
export function checkResultChange(
  ballot: Pick<BallotSubmission, "roundId" | "debateId">,
  state: RoundGuardState
): GuardViolation[] {
  const round = roundOfBallot(ballot, state);
  if (!round) return [];
  const roundId = round.id;
  const debateId = ballot.debateId;
  if (round.cancelled) return [hard("round_cancelled", `${round.name} is cancelled.`, { roundId, debateId })];
  if (round.eliminationAdvanced) {
    return [hard(
      "elimination_advanced",
      `Teams have already advanced from ${round.name}, so its results can no longer change.`,
      { roundId, debateId }
    )];
  }
  const violations: GuardViolation[] = [];
  if (round.completed) {
    const later = laterDrawnRounds(round, state.rounds, state.debates);
    violations.push(soft(
      "round_completed",
      `${round.name} is marked complete.` +
        (later.length > 0 ? ` ${names(later)} ${later.length === 1 ? "was" : "were"} drawn from its current results.` : ""),
      { roundId, debateId }
    ));
  }
  return violations;
}

/** Rules for saving a ballot submission (a new version, or an edit of the same id). */
export interface BallotCheckPolicy {
  /** Tournament requires a second person to check tab-room ballots (ballotDoubleEntry). */
  doubleEntry: boolean;
  /** The signed-in tab-room user; undefined on a signed-out single device, which cannot tell people apart. */
  actorId?: string;
}

/**
 * Double entry means a different person checks each tab-room ballot before it counts. This blocks
 * (overridably, for a tab director) confirming your own entry, and confirming a new tab-room entry
 * that is not a check of someone else's pending version. Ballots judges submit through their
 * private URLs are their own record, not tab-room data entry, so they are not affected.
 */
export function checkIndependentConfirmation(
  ballot: Pick<BallotSubmission, "id" | "debateId" | "roundId" | "submitterType" | "submitterId" | "checksVersion">,
  mode: "confirm_existing" | "submit_confirmed",
  policy: BallotCheckPolicy | undefined,
  state: Pick<RoundGuardState, "ballots">
): GuardViolation[] {
  if (!policy?.doubleEntry || !policy.actorId || ballot.submitterType !== "tabroom") return [];
  const ids = { roundId: ballot.roundId, debateId: ballot.debateId };
  if (mode === "confirm_existing") {
    return ballot.submitterId === policy.actorId
      ? [soft("same_person_check", "You entered this ballot; double entry needs a different person to check and confirm it.", ids)]
      : [];
  }
  const checked = ballot.checksVersion === undefined
    ? undefined
    : state.ballots.find((item) =>
        item.debateId === ballot.debateId && item.version === ballot.checksVersion && !item.discarded
      );
  if (!checked) {
    return [soft(
      "same_person_check",
      "Double entry is on: save this ballot for checking; a different person must check it before it counts.",
      ids
    )];
  }
  return checked.submitterId === policy.actorId
    ? [soft("same_person_check", "You entered the version being checked; a different person must do the check.", ids)]
    : [];
}

export function checkBallotSubmission(ballot: BallotSubmission, state: RoundGuardState): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const existing = ballot.id ? state.ballots.find((item) => item.id === ballot.id) : undefined;
  if (existing && (existing.confirmed || existing.discarded)) {
    violations.push(hard(
      "ballot_locked",
      `Ballot v${existing.version} is already ${existing.confirmed ? "confirmed" : "discarded"} and cannot be overwritten. ` +
        "Save the change as a new ballot version instead.",
      { roundId: existing.roundId, debateId: existing.debateId }
    ));
  }
  if (existing && existing.debateId !== ballot.debateId) {
    violations.push(hard(
      "ballot_locked",
      "That ballot identifier belongs to a different debate.",
      { debateId: ballot.debateId }
    ));
  }
  const round = roundOfBallot(ballot, state);
  if (round?.cancelled) {
    violations.push(hard("round_cancelled", `${round.name} is cancelled.`, { roundId: round.id, debateId: ballot.debateId }));
  } else if (ballot.confirmed) {
    violations.push(...checkResultChange(ballot, state));
  }
  return dedupe(violations);
}

/**
 * Recording that a paper ballot arrived (ballot intake). Late paper is still recorded for completed
 * rounds; only a cancelled (or missing) round has no ballots to receive.
 */
export function checkBallotIntake(round: Round | undefined, debateId?: string): GuardViolation[] {
  if (!round) return [hard("round_cancelled", "This ballot sheet's round was cancelled or deleted.", { debateId })];
  if (round.cancelled) return [hard("round_cancelled", `${round.name} is cancelled.`, { roundId: round.id, debateId })];
  return [];
}

/** Whether the private portal may confirm or supersede ballots in this round. */
export function isRoundLockedForPortalBallots(round: Round | undefined): boolean {
  return (
    !round ||
    round.cancelled === true ||
    round.completed === true ||
    round.resultsReleased === true ||
    round.teamSpeaksReleased === true ||
    round.eliminationAdvanced === true
  );
}

/**
 * Why a participant (private portal) or data-entry assistant may not submit a ballot for a debate
 * in this round at all, or "" when they may.
 */
export function remoteBallotSubmissionBlocker(round: Round | undefined): string {
  if (!round || round.cancelled) return "This round is not running.";
  if (!isDrawReleased(round)) return "This round's draw has not been published yet.";
  if (round.eliminationAdvanced) return "Teams have already advanced from this round.";
  return "";
}

/* -------------------------------------------------------------------------- */
/* Tournament settings                                                         */
/* -------------------------------------------------------------------------- */

/** Settings that change the shape of a ballot: never changed once any ballot exists. */
export const BALLOT_SHAPE_PREFERENCES = [
  "teamsInDebate",
  "substantiveSpeakers",
  "replyScoresEnabled",
  "ballotMode",
] as const satisfies readonly (keyof TournamentPreferences)[];

/** Settings that change how existing scores are validated or totalled. */
export const SCORING_PREFERENCES = [
  "minSpeakerScore",
  "maxSpeakerScore",
  "stepSpeakerScore",
  "minReplyScore",
  "maxReplyScore",
  "teamScoreIncludesGhosts",
  "marginIncludesDissenters",
  "allowLowPointWins",
  "enableForfeits",
  "byeTeamResults",
] as const satisfies readonly (keyof TournamentPreferences)[];

const PREFERENCE_LABELS: Partial<Record<keyof TournamentPreferences, string>> = {
  teamsInDebate: "teams per debate",
  substantiveSpeakers: "speakers per team",
  replyScoresEnabled: "reply speeches",
  ballotMode: "ballot mode",
  minSpeakerScore: "minimum speaker score",
  maxSpeakerScore: "maximum speaker score",
  stepSpeakerScore: "speaker score step",
  minReplyScore: "minimum reply score",
  maxReplyScore: "maximum reply score",
  teamScoreIncludesGhosts: "ghost speeches in team scores",
  marginIncludesDissenters: "margins including dissenters",
  allowLowPointWins: "low-point wins",
  enableForfeits: "forfeits",
  byeTeamResults: "bye results",
};

function changedPreferences(
  previous: Partial<TournamentPreferences> | undefined,
  next: Partial<TournamentPreferences> | undefined,
  keys: readonly (keyof TournamentPreferences)[]
): (keyof TournamentPreferences)[] {
  return keys.filter((key) => JSON.stringify(previous?.[key]) !== JSON.stringify(next?.[key]));
}

/**
 * Live ballots from elimination rounds. Without the rounds, every ballot might be one, so all count.
 */
function liveEliminationBallots(ballots: BallotSubmission[], rounds?: Round[]): BallotSubmission[] {
  const live = liveBallots(ballots);
  if (!rounds) return live;
  const eliminationRoundIds = new Set(rounds.filter((round) => round.stage === "elimination").map((round) => round.id));
  return live.filter((ballot) => eliminationRoundIds.has(ballot.roundId));
}

export function checkSettingsChange(
  previous: Tournament | null,
  next: Tournament,
  ballots: BallotSubmission[],
  rounds?: Round[]
): GuardViolation[] {
  if (!previous) return [];
  const live = liveBallots(ballots);
  if (live.length === 0) return [];
  const violations: GuardViolation[] = [];
  const shape = changedPreferences(previous.preferences, next.preferences, BALLOT_SHAPE_PREFERENCES);
  if (previous.format !== next.format || shape.length > 0) {
    const what = [
      ...(previous.format !== next.format ? ["the debate format"] : []),
      ...shape.map((key) => PREFERENCE_LABELS[key] ?? key),
    ].join(", ");
    violations.push(hard(
      "settings_locked",
      `${live.length} ballot${live.length === 1 ? " has" : "s have"} been entered, so ${what} can no longer change: ` +
        "existing ballots would no longer match.",
    ));
  }
  // The elimination ballot mode only shapes elimination ballots, so it stays editable until one exists.
  const elimination = { stage: "elimination" as const };
  const liveElimination = liveEliminationBallots(ballots, rounds);
  if (
    violations.length === 0 &&
    liveElimination.length > 0 &&
    ballotModeFor(elimination, previous) !== ballotModeFor(elimination, next)
  ) {
    violations.push(hard(
      "settings_locked",
      `${liveElimination.length} elimination ballot${liveElimination.length === 1 ? " has" : "s have"} been entered, ` +
        "so the elimination ballot mode can no longer change: existing ballots would no longer match.",
    ));
  }
  const scoring = changedPreferences(previous.preferences, next.preferences, SCORING_PREFERENCES);
  if (scoring.length > 0) {
    violations.push(soft(
      "scoring_changed_after_ballots",
      `Changing ${scoring.map((key) => PREFERENCE_LABELS[key] ?? key).join(", ")} after ballots were entered ` +
        "changes how existing results are checked or totalled.",
    ));
  }
  return violations;
}

/** The settings fields the config form should lock once ballots exist. */
export function lockedSettingsFields(ballots: BallotSubmission[], rounds?: Round[]): readonly string[] {
  if (liveBallots(ballots).length === 0) return [];
  return [
    "format",
    ...BALLOT_SHAPE_PREFERENCES,
    ...(liveEliminationBallots(ballots, rounds).length > 0 ? ["eliminationBallotMode"] : []),
  ];
}

/* -------------------------------------------------------------------------- */
/* Deleting participants, venues and break categories                          */
/* -------------------------------------------------------------------------- */

export interface ReferenceState {
  debates: Debate[];
  ballots: BallotSubmission[];
  feedback?: FeedbackSubmission[];
  teams?: Team[];
  adjudicators?: Adjudicator[];
}

function inUse(entity: string, uses: string[], alternative: string): GuardViolation[] {
  return uses.length > 0
    ? [hard("entity_in_use", `${entity} is used by ${uses.join(" and ")}, so it cannot be deleted. ${alternative}`)]
    : [];
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function checkTeamDeletion(team: Pick<Team, "id" | "name">, state: ReferenceState): GuardViolation[] {
  const debates = state.debates.filter((debate) =>
    Object.values(debate.teams || {}).some((slot) => slot?.teamId === team.id) || debate.byeTeamId === team.id
  );
  const ballots = state.ballots.filter((ballot) =>
    Object.values(ballot.teamScores || {}).some((score) => score?.teamId === team.id)
  );
  const feedback = (state.feedback ?? []).filter((item) =>
    (item.sourceType === "team" && item.sourceId === team.id) || item.targetTeamId === team.id
  );
  return inUse(
    team.name,
    [
      ...(debates.length ? [plural(debates.length, "debate")] : []),
      ...(ballots.length ? [plural(ballots.length, "ballot")] : []),
      ...(feedback.length ? [plural(feedback.length, "feedback record")] : []),
    ],
    "Mark the team as not checked in (unavailable) instead."
  );
}

export function checkAdjudicatorDeletion(
  adjudicator: Pick<Adjudicator, "id" | "name">,
  state: ReferenceState
): GuardViolation[] {
  const id = adjudicator.id;
  const debates = state.debates.filter((debate) =>
    debate.adjudicators?.chairId === id ||
    debate.adjudicators?.panellistIds?.includes(id) ||
    debate.adjudicators?.traineeIds?.includes(id)
  );
  const ballots = state.ballots.filter((ballot) =>
    ballot.submitterId === id ||
    ballot.chairId === id ||
    ballot.sheets?.some((sheet) => sheet.adjudicatorId === id)
  );
  const feedback = (state.feedback ?? []).filter((item) =>
    (item.sourceType === "adjudicator" && item.sourceId === id) || item.targetAdjudicatorId === id
  );
  return inUse(
    adjudicator.name,
    [
      ...(debates.length ? [plural(debates.length, "debate panel")] : []),
      ...(ballots.length ? [plural(ballots.length, "ballot")] : []),
      ...(feedback.length ? [plural(feedback.length, "feedback record")] : []),
    ],
    "Mark the adjudicator as unavailable instead."
  );
}

export function checkVenueDeletion(venue: { id: string; name: string }, state: ReferenceState): GuardViolation[] {
  const debates = state.debates.filter((debate) => debate.venueId === venue.id);
  return inUse(
    venue.name,
    debates.length ? [plural(debates.length, "debate")] : [],
    "Mark the venue as unavailable instead."
  );
}

export function checkInstitutionDeletion(
  institution: Pick<Institution, "id" | "name">,
  state: ReferenceState
): GuardViolation[] {
  const teams = (state.teams ?? []).filter((team) => team.institutionId === institution.id);
  const adjudicators = (state.adjudicators ?? []).filter((adjudicator) => adjudicator.institutionId === institution.id);
  return inUse(
    institution.name,
    [
      ...(teams.length ? [plural(teams.length, "team")] : []),
      ...(adjudicators.length ? [plural(adjudicators.length, "adjudicator")] : []),
    ],
    "Move or delete those first."
  );
}

/** Why a break category cannot be deleted, as violations. */
export function checkBreakCategoryDeletion(
  category: BreakCategory,
  teams: Team[],
  rounds: Round[]
): GuardViolation[] {
  if (teams.some((team) => team.breakCategoryIds?.includes(category.id))) {
    return [hard(
      "break_category_in_use",
      `${category.name} has a generated break. Teams are breaking in it, so it cannot be deleted.`
    )];
  }
  const usedBy = rounds.filter((round) => !round.cancelled && round.breakCategoryIds?.includes(category.id));
  if (usedBy.some((round) => round.drawStatus !== "none")) {
    return [hard(
      "break_category_in_use",
      `${category.name} is used by an elimination round that already has a draw.`
    )];
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/* Breaks                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Rules for generating a category's break. `updatedRounds` are the elimination rounds as the
 * break would leave them: a round whose schedule changes, or that hosts this category, must not
 * have started (a draw or an advancement would be reset).
 */
export function checkBreakGeneration(
  category: BreakCategory,
  state: RoundGuardState,
  updatedRounds: Round[],
  result?: Pick<BreakCategoryResult, "cutoffTies">
): GuardViolation[] {
  const violations: GuardViolation[] = [];
  // A tie at the cutoff is never settled by an arbitrary order; the tab director decides it.
  for (const tie of result?.cutoffTies ?? []) {
    const teamNames = tie.teams.map((entry) => entry.team.name).join(", ");
    violations.push(hard(
      tie.cutoff === "break" ? "break_cutoff_tie" : "reserve_cutoff_tie",
      `${teamNames} are tied (rank ${tie.teams[0]?.rank}) for ${tie.places} ` +
        `${tie.cutoff === "break" ? "breaking" : "reserve"} place${tie.places === 1 ? "" : "s"} in ${category.name}. ` +
        "Resolve the tie with overrides (manually include the teams that go through, or mark the others, " +
        "e.g. \"Lost coin toss\") before generating the break."
    ));
  }
  const updatedById = new Map(updatedRounds.map((round) => [round.id, round]));
  const started = state.rounds.filter((round) => {
    if (round.stage !== "elimination" || round.cancelled) return false;
    const updated = updatedById.get(round.id);
    const scheduleChanges =
      JSON.stringify(round.breakCategoryIds ?? []) !== JSON.stringify(updated?.breakCategoryIds ?? []);
    const hostsCategory = Boolean(
      round.breakCategoryIds?.includes(category.id) || updated?.breakCategoryIds?.includes(category.id)
    );
    const hasStarted = round.eliminationAdvanced === true ||
      round.drawStatus !== "none" ||
      state.debates.some((debate) => debate.roundId === round.id);
    return (scheduleChanges || hostsCategory) && hasStarted;
  });
  if (started.length > 0) {
    violations.push(hard(
      "elimination_started",
      `${names(started)} ${started.length === 1 ? "has" : "have"} already been drawn or advanced. ` +
        `Regenerating the ${category.name} break would reset elimination progress.`
    ));
  }

  const unfinished = state.rounds
    .filter((round) => round.stage === "preliminary" && !round.cancelled)
    .sort((left, right) => left.seq - right.seq)
    .filter((round) => getRoundCompletionBlockers(round, state.debates, state.ballots).length > 0);
  if (unfinished.length > 0) {
    violations.push(soft(
      "prelims_incomplete",
      `${names(unfinished)} ${unfinished.length === 1 ? "is" : "are"} not finished, so the standings the break is ` +
        "calculated from are not final.",
    ));
  }
  return violations;
}
