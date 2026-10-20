import {
  ballotSides,
  buildBallotResult,
  replySpeechesEnabled,
  substantiveSpeakerCount,
  usesVotingBallots,
  validateBallotEntry,
  type BallotEntry,
  type BallotRules,
} from "@/lib/ballots/result";
import { sidesChosenOnBallot } from "@/lib/draw/manualSides";
import { randomInt, shuffle, type Rng } from "@/lib/draw/rng";
import { feedbackPathsForRound } from "@/lib/feedback/paths";
import { expectedFeedbackForDebate } from "@/lib/feedback/progress";
import { integerScaleChoices, isFeedbackEnabledForRound, questionsForFeedbackSource } from "@/lib/feedback/questions";
import type {
  AdjudicatorSheet,
  BallotSubmission,
  Debate,
  DebateSide,
  FeedbackAnswer,
  FeedbackQuestion,
  FeedbackSubmission,
  Motion,
  Round,
  SpeakerScoreEntry,
  Team,
  Tournament,
} from "@/types";
import { nextBallotVersion, roundMotions } from "./ballotEntry";
import { addFeedbackCommand } from "./feedback";
import { submitBallotCommand, type BallotWorkflowDependencies } from "./ballots";
import type { RuleOverride } from "./stateGuards";

/**
 * Rehearsal tools (Tabbycat's `generateresults`, `simulaterounds` and `generatefeedback`):
 * random but valid ballots and feedback for a round, so a tab team can rehearse a whole
 * tournament before the event.
 *
 * - Randomness comes only from the `Rng` passed in (lib/draw/rng.ts), so a seed reproduces a run.
 * - Every simulated ballot is checked with the ballot form's validation and built with its result
 *   builder; it is then submitted through `submitBallotCommand`, so the round's state rules
 *   (stateGuards.ts) apply exactly as for a typed ballot. Feedback goes through `addFeedbackCommand`.
 * - Simulated records are marked (`submitterName` / `sourceName` suffix) so they are easy to spot.
 * - Debates that cannot be simulated (byes, sides chosen on the ballot, teams without enough
 *   speakers, no voting adjudicator) are reported, never silently dropped.
 */

export const SIMULATED_LABEL = "Simulated (rehearsal)";

export interface SkippedDebate {
  debateId: string;
  reason: string;
}

interface ScoreScale {
  min: number;
  max: number;
  step: number;
}

function snap(value: number, scale: ScoreScale): number {
  const steps = Math.round((value - scale.min) / scale.step);
  const snapped = scale.min + Math.max(0, Math.min(Math.floor((scale.max - scale.min) / scale.step), steps)) * scale.step;
  return Math.round(snapped * 100) / 100;
}

function teamTotal(entries: SpeakerScoreEntry[], substantive: number): number {
  return entries.filter((entry) => entry.position <= substantive).reduce((sum, entry) => sum + entry.score, 0);
}

/**
 * One scoresheet: each team's speakers scored around a level set by a random finishing order,
 * redrawn until every team total differs (ties are not a valid result).
 */
function simulateSheet(
  rosters: Map<DebateSide, Team["speakers"]>,
  rules: BallotRules,
  rng: Rng
): Record<DebateSide, SpeakerScoreEntry[]> | null {
  const preferences = rules.preferences ?? {};
  const substantive = substantiveSpeakerCount(rules);
  const speaker: ScoreScale = {
    min: preferences.minSpeakerScore ?? 60,
    max: preferences.maxSpeakerScore ?? 80,
    step: preferences.stepSpeakerScore || 1,
  };
  const reply: ScoreScale = {
    min: preferences.minReplyScore ?? 30,
    max: preferences.maxReplyScore ?? 40,
    step: (preferences.stepSpeakerScore || 1) / 2,
  };
  const sides = ballotSides(rules.format);
  const spread = speaker.max - speaker.min;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const order = shuffle(sides, rng);
    const sheet = {} as Record<DebateSide, SpeakerScoreEntry[]>;
    order.forEach((side, place) => {
      const roster = rosters.get(side) ?? [];
      // Better places get a higher level; noise keeps individual scores varied.
      const level = speaker.min + spread * (0.7 - (0.12 * place) / Math.max(1, sides.length - 1));
      const entries: SpeakerScoreEntry[] = Array.from({ length: substantive }, (_, index) => ({
        speakerId: roster[index].id,
        speakerName: roster[index].name,
        position: index + 1,
        score: snap(level + (rng() - 0.5) * spread * 0.15, speaker),
      }));
      if (replySpeechesEnabled(rules)) {
        // The reply is given by one of the first (substantive - 1) speakers.
        const replier = roster[randomInt(rng, Math.max(1, substantive - 1))];
        const replyLevel = reply.min + (reply.max - reply.min) * (0.7 - (0.12 * place) / Math.max(1, sides.length - 1));
        entries.push({
          speakerId: replier.id,
          speakerName: replier.name,
          position: substantive + 1,
          score: snap(replyLevel + (rng() - 0.5) * (reply.max - reply.min) * 0.1, reply),
        });
      }
      sheet[side] = entries;
    });
    const totals = sides.map((side) => teamTotal(sheet[side], substantive));
    if (new Set(totals).size === totals.length) return sheet;
  }
  return null;
}

/** Ranks from team totals (best = 1), so a consensus result never awards a low-point win. */
function ranksFromTotals(sheet: Record<DebateSide, SpeakerScoreEntry[]>, rules: BallotRules): Partial<Record<DebateSide, number>> {
  const substantive = substantiveSpeakerCount(rules);
  const sides = ballotSides(rules.format);
  return Object.fromEntries(
    [...sides]
      .sort((left, right) => teamTotal(sheet[right], substantive) - teamTotal(sheet[left], substantive))
      .map((side, index) => [side, index + 1])
  );
}

export interface SimulatedBallotInput {
  tournament: Tournament;
  round: Round;
  debates: Debate[];
  teams: Team[];
  motions: Motion[];
  ballots: BallotSubmission[];
  rng: Rng;
  /** Also simulate debates that already have a (non-discarded) ballot. Default false. */
  includeResulted?: boolean;
  submitter: { id?: string; name?: string };
  now?: Date;
}

/** Builds one confirmed ballot per debate of the round that can be simulated. */
export function planSimulatedBallots(input: SimulatedBallotInput): { ballots: BallotSubmission[]; skipped: SkippedDebate[] } {
  const { tournament, round, rng } = input;
  const rules: BallotRules = { format: tournament.format, preferences: tournament.preferences, stage: round.stage };
  const sides = ballotSides(rules.format);
  const substantive = substantiveSpeakerCount(rules);
  const teamsById = new Map(input.teams.map((team) => [team.id, team]));
  const motions = roundMotions(input.motions, round.id);
  const timestamp = (input.now ?? new Date()).toISOString();
  const ballots: BallotSubmission[] = [];
  const skipped: SkippedDebate[] = [];
  const roundDebates = input.debates
    .filter((debate) => debate.roundId === round.id)
    .sort((left, right) => left.roomRank - right.roomRank || left.id.localeCompare(right.id));

  for (const debate of roundDebates) {
    const skip = (reason: string) => skipped.push({ debateId: debate.id, reason });
    if (debate.byeTeamId) continue;
    if (debate.postponed) { skip("The debate is postponed."); continue; }
    if (!input.includeResulted && input.ballots.some((ballot) => ballot.debateId === debate.id && !ballot.discarded)) {
      skip("The debate already has a ballot.");
      continue;
    }
    if (sidesChosenOnBallot(debate)) { skip("Sides are chosen on the ballot in this debate; enter it by hand."); continue; }
    const rosters = new Map(sides.map((side) => [side, teamsById.get(debate.teams?.[side]?.teamId ?? "")?.speakers ?? []]));
    const short = sides.find((side) => (rosters.get(side) ?? []).length < substantive);
    if (short) { skip(`${debate.teams?.[short]?.teamName ?? short} has fewer than ${substantive} speakers.`); continue; }

    let entry: BallotEntry;
    if (usesVotingBallots(rules)) {
      const voters = [debate.adjudicators?.chairId, ...(debate.adjudicators?.panellistIds ?? [])].filter((id): id is string => Boolean(id));
      if (voters.length === 0) { skip("No voting adjudicator is allocated."); continue; }
      const sheets: AdjudicatorSheet[] = [];
      for (const adjudicatorId of voters) {
        const sheet = simulateSheet(rosters, rules, rng);
        if (sheet) sheets.push({ adjudicatorId, speakerScores: sheet });
      }
      if (sheets.length !== voters.length) { skip("Could not produce untied scoresheets in this score range."); continue; }
      // Every sheet must list the same speakers in the same order: copy the first sheet's order.
      for (const sheet of sheets.slice(1)) {
        for (const side of sides) {
          sheet.speakerScores[side] = sheets[0].speakerScores[side].map((entryOfFirst, index) => ({
            ...entryOfFirst,
            score: sheet.speakerScores[side][index]?.score ?? entryOfFirst.score,
          }));
        }
      }
      const untied = sheets.every((sheet) => {
        const totals = sides.map((side) => teamTotal(sheet.speakerScores[side], substantive));
        return new Set(totals).size === totals.length;
      });
      if (!untied) { skip("Could not produce untied scoresheets in this score range."); continue; }
      entry = { speakerScores: sheets[0].speakerScores, sheets };
    } else {
      const sheet = simulateSheet(rosters, rules, rng);
      if (!sheet) { skip("Could not produce untied team totals in this score range."); continue; }
      entry = { speakerScores: sheet, ranks: ranksFromTotals(sheet, rules) };
    }
    const motion = motions.length > 0 ? motions[randomInt(rng, motions.length)] : undefined;
    if (motion) entry.motionId = motion.id;

    const errors = validateBallotEntry(entry, {
      ...rules,
      rosters: Object.fromEntries(rosters),
      roundMotionIds: motions.map((item) => item.id),
    });
    if (errors.length > 0) { skip(errors.join(" ")); continue; }
    const teamIds = Object.fromEntries(sides.map((side) => [side, debate.teams?.[side]?.teamId ?? ""]));
    const result = buildBallotResult(entry, teamIds, debate.adjudicators?.chairId, rules);
    const version = nextBallotVersion([...input.ballots, ...ballots], debate.id);
    ballots.push({
      id: `ballot-${debate.id}-v${version}-sim${Math.floor(rng() * 1e9).toString(36)}`,
      tournamentId: tournament.id,
      roundId: round.id,
      debateId: debate.id,
      version,
      confirmed: true,
      discarded: false,
      submitterType: "tabroom",
      ...(input.submitter.id ? { submitterId: input.submitter.id } : {}),
      submitterName: `${SIMULATED_LABEL}${input.submitter.name ? ` · ${input.submitter.name}` : ""}`,
      ...(motion ? { motionId: motion.id, motionText: motion.text } : {}),
      speakerScores: result.speakerScores,
      teamScores: result.teamScores,
      ...(result.sheets ? { sheets: result.sheets } : {}),
      ...(debate.adjudicators?.chairId ? { chairId: debate.adjudicators.chairId } : {}),
      timestamp,
      confirmedBy: SIMULATED_LABEL,
      confirmedTimestamp: timestamp,
    });
  }
  return { ballots, skipped };
}

export interface SequentialBallotState {
  ballots: BallotSubmission[];
  debates: Debate[];
  rounds: Round[];
}

/**
 * Submits ballots one after another through `submitBallotCommand`, each seeing the state the
 * previous one left (the React context's commands read the state of the last render, so calling
 * them in a loop would lose all but the last ballot). Returns the final state to save.
 */
export async function submitBallotsInSequence(
  ballots: BallotSubmission[],
  initial: SequentialBallotState,
  dependencies: Pick<BallotWorkflowDependencies, "adjudicators" | "recordAuditEvent" | "checkPolicy" | "updateRound">,
  override?: RuleOverride
): Promise<SequentialBallotState> {
  let state = { ...initial };
  for (const ballot of ballots) {
    await submitBallotCommand(ballot, undefined, {
      ballots: state.ballots,
      debates: state.debates,
      rounds: state.rounds,
      adjudicators: dependencies.adjudicators,
      checkPolicy: dependencies.checkPolicy,
      repository: {
        saveBallots: (next) => { state = { ...state, ballots: next }; },
        saveDebates: (next) => { state = { ...state, debates: next }; },
      },
      updateRound: async (round) => {
        state = { ...state, rounds: state.rounds.map((item) => (item.id === round.id ? round : item)) };
        await dependencies.updateRound(round);
      },
      recordAuditEvent: dependencies.recordAuditEvent,
      queuePrivateRecord: async () => undefined,
    }, override);
  }
  return state;
}

/* ------------------------------------------------------------------------ */
/* Feedback                                                                  */
/* ------------------------------------------------------------------------ */

function simulateAnswer(question: FeedbackQuestion, rng: Rng): FeedbackAnswer {
  switch (question.type) {
    case "text":
      return "Clear reasoning; engaged with both sides.";
    case "textarea":
      return "Simulated rehearsal feedback.\nThe decision was explained well.";
    case "yes_no":
    case "checkbox":
      return rng() < 0.75;
    case "select_one":
      return question.options?.[randomInt(rng, question.options.length)] ?? null;
    case "select_many": {
      const options = question.options ?? [];
      const picked = options.filter(() => rng() < 0.5);
      return picked.length > 0 || !question.required ? picked : options.slice(0, 1);
    }
    case "integer_scale": {
      const choices = integerScaleChoices(question);
      return choices[randomInt(rng, choices.length)] ?? null;
    }
    case "scale": {
      const min = question.min ?? 0;
      const max = question.max ?? 10;
      return Math.round((min + rng() * (max - min)) * 10) / 10;
    }
    case "integer": {
      const min = Math.ceil(question.min ?? 1);
      const max = Math.floor(question.max ?? Math.max(min, 10));
      return min + randomInt(rng, Math.max(1, max - min + 1));
    }
    case "float": {
      const min = question.min ?? 0;
      const max = question.max ?? Math.max(min, 10);
      return Math.round((min + rng() * (max - min)) * 100) / 100;
    }
    default:
      return null;
  }
}

export interface SimulatedFeedbackInput {
  tournament: Tournament;
  round: Round;
  debates: Debate[];
  teams: Team[];
  adjudicators: Array<{ id: string; name: string }>;
  feedback: FeedbackSubmission[];
  rng: Rng;
}

export type SimulatedFeedback = Omit<FeedbackSubmission, "id" | "tournamentId" | "timestamp">;

/**
 * Feedback along the configured feedback paths for every debate of the round, skipping pairs
 * that already have feedback. Scores lean towards the middle-to-top of the scale; every required
 * custom question is answered validly.
 */
export function planSimulatedFeedback(input: SimulatedFeedbackInput): { feedback: SimulatedFeedback[]; skipped: SkippedDebate[] } {
  const { tournament, round, rng } = input;
  const preferences = tournament.preferences;
  const skipped: SkippedDebate[] = [];
  if (preferences.feedbackEnabled === false || round.feedbackEnabled === false) {
    return { feedback: [], skipped: [{ debateId: "", reason: "Feedback is not enabled for this round." }] };
  }
  const paths = feedbackPathsForRound(preferences, round);
  const names = new Map<string, string>([
    ...input.teams.map((team): [string, string] => [team.id, team.name]),
    ...input.adjudicators.map((adjudicator): [string, string] => [adjudicator.id, adjudicator.name]),
  ]);
  const given = new Set(input.feedback.map((item) => `${item.debateId}|${item.sourceId}|${item.targetAdjudicatorId}`));
  const min = preferences.feedbackMinScore ?? 1;
  const max = preferences.feedbackMaxScore ?? 5;
  const feedback: SimulatedFeedback[] = [];
  for (const debate of input.debates.filter((item) => item.roundId === round.id).sort((left, right) => left.roomRank - right.roomRank)) {
    if (!isFeedbackEnabledForRound(debate, round, preferences.feedbackInEliminationRounds ?? true)) {
      if (!debate.byeTeamId) skipped.push({ debateId: debate.id, reason: "Feedback is not collected for this debate." });
      continue;
    }
    for (const expected of expectedFeedbackForDebate(debate, paths)) {
      if (given.has(`${debate.id}|${expected.sourceId}|${expected.targetAdjudicatorId}`)) continue;
      const questions = questionsForFeedbackSource(expected.sourceType, preferences);
      feedback.push({
        roundId: round.id,
        debateId: debate.id,
        targetType: "adjudicator",
        targetAdjudicatorId: expected.targetAdjudicatorId,
        targetAdjudicatorName: names.get(expected.targetAdjudicatorId),
        sourceType: expected.sourceType,
        sourceId: expected.sourceId,
        sourceName: `${names.get(expected.sourceId) ?? expected.sourceId} (${SIMULATED_LABEL})`,
        score: Math.min(max, Math.max(min, Math.round(min + (max - min) * (0.45 + rng() * 0.55)))),
        agreeWithDecision: rng() < 0.8,
        answers: Object.fromEntries(questions.map((question) => [question.id, simulateAnswer(question, rng)])),
        confirmed: true,
      });
    }
  }
  return { feedback, skipped };
}

/**
 * Adds feedback one after another through `addFeedbackCommand` (answers are validated against
 * the source's questions there) and returns every submission, with ids from `createId`.
 */
export async function addFeedbackInSequence(
  items: SimulatedFeedback[],
  input: {
    tournament: Tournament;
    feedback: FeedbackSubmission[];
    createId(): string;
    recordAuditEvent: Parameters<typeof addFeedbackCommand>[1]["recordAuditEvent"];
  }
): Promise<FeedbackSubmission[]> {
  let feedback = input.feedback;
  for (const item of items) {
    await addFeedbackCommand(item, {
      tournamentId: input.tournament.id,
      feedback,
      questions: questionsForFeedbackSource(item.sourceType, input.tournament.preferences),
      teams: [],
      adjudicators: [],
      repository: {
        // The command ids feedback by time; give each simulated record its own id.
        saveFeedback: (next) => {
          feedback = next.map((record, index) => (index === next.length - 1 ? { ...record, id: input.createId() } : record));
        },
      },
      queuePrivateRecord: async () => undefined,
      recordAuditEvent: input.recordAuditEvent,
    });
  }
  return feedback;
}
