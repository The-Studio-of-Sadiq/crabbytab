import type {
  Debate,
  FeedbackPath,
  FeedbackSourceRole,
  FeedbackSubmission,
  FeedbackTargetRole,
  Round,
} from "@/types";
import { canSubmitParticipantFeedback, isFeedbackEnabledForRound } from "./questions";
import { adjudicatorRoleInDebate } from "./scores";

export interface ExpectedFeedback {
  roundId: string;
  debateId: string;
  sourceType: "team" | "adjudicator";
  sourceId: string;
  sourceRole: FeedbackSourceRole;
  targetAdjudicatorId: string;
  targetRole: FeedbackTargetRole;
}

function panelOf(debate: Debate): Array<{ id: string; role: FeedbackTargetRole }> {
  const panel = debate.adjudicators;
  return [
    ...(panel?.chairId ? [{ id: panel.chairId, role: "chair" as const }] : []),
    ...(panel?.panellistIds ?? []).map((id) => ({ id, role: "panellist" as const })),
    ...(panel?.traineeIds ?? []).map((id) => ({ id, role: "trainee" as const })),
  ];
}

/**
 * The feedback a debate is expected to produce: each team rates the chair, and
 * adjudicators rate each other as the tournament's feedback path allows
 * (chairs_to_panel: chair on panel; two_way: chair and panel on each other;
 * everyone: every adjudicator on every other).
 */
export function expectedFeedbackForDebate(debate: Debate, path: FeedbackPath): ExpectedFeedback[] {
  if (debate.byeTeamId || debate.postponed) return [];
  const panel = panelOf(debate);
  const chair = panel.find((member) => member.role === "chair");
  const expected: ExpectedFeedback[] = [];

  if (chair) {
    for (const slot of Object.values(debate.teams ?? {})) {
      if (!slot?.teamId) continue;
      expected.push({
        roundId: debate.roundId,
        debateId: debate.id,
        sourceType: "team",
        sourceId: slot.teamId,
        sourceRole: "team",
        targetAdjudicatorId: chair.id,
        targetRole: "chair",
      });
    }
  }

  for (const source of panel) {
    for (const target of panel) {
      if (source.id === target.id) continue;
      const allowed = canSubmitParticipantFeedback({
        sourceType: "adjudicator",
        sourceId: source.id,
        sourceIsChair: source.role === "chair",
        targetType: "adjudicator",
        targetId: target.id,
        targetIsChair: target.role === "chair",
        path,
      });
      if (!allowed) continue;
      expected.push({
        roundId: debate.roundId,
        debateId: debate.id,
        sourceType: "adjudicator",
        sourceId: source.id,
        sourceRole: source.role,
        targetAdjudicatorId: target.id,
        targetRole: target.role,
      });
    }
  }
  return expected;
}

function submissionKey(item: {
  roundId: string;
  sourceType: string;
  sourceId: string;
  targetAdjudicatorId?: string;
}): string {
  return `${item.roundId}|${item.sourceType}|${item.sourceId}|${item.targetAdjudicatorId ?? ""}`;
}

export interface OutstandingSource {
  sourceType: "team" | "adjudicator";
  sourceId: string;
  sourceRole: FeedbackSourceRole;
  debateId: string;
  owed: Array<{ targetAdjudicatorId: string; targetRole: FeedbackTargetRole }>;
}

export interface RoundFeedbackProgress {
  roundId: string;
  /** False when feedback is switched off for this round; nothing is then expected. */
  enabled: boolean;
  expected: number;
  submitted: number;
  outstanding: OutstandingSource[];
}

/**
 * Who still owes feedback in a round. Any submission from the source about the target in
 * that round counts as submitted, including unconfirmed and ignored ones.
 */
export function roundFeedbackProgress(
  round: Pick<Round, "id" | "stage" | "feedbackEnabled">,
  debates: Debate[],
  submissions: FeedbackSubmission[],
  path: FeedbackPath,
  feedbackInEliminationRounds = true
): RoundFeedbackProgress {
  const roundDebates = debates.filter((debate) => debate.roundId === round.id);
  const enabled = isFeedbackEnabledForRound({ postponed: false }, round, feedbackInEliminationRounds);
  if (!enabled) return { roundId: round.id, enabled, expected: 0, submitted: 0, outstanding: [] };

  const received = new Set(
    submissions
      .filter((submission) => submission.roundId === round.id)
      .map(submissionKey)
  );
  const expected = roundDebates.flatMap((debate) => expectedFeedbackForDebate(debate, path));
  const bySource = new Map<string, OutstandingSource>();
  let submitted = 0;
  for (const item of expected) {
    if (received.has(submissionKey(item))) {
      submitted += 1;
      continue;
    }
    const key = `${item.sourceType}|${item.sourceId}|${item.debateId}`;
    const entry = bySource.get(key) ?? {
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sourceRole: item.sourceRole,
      debateId: item.debateId,
      owed: [],
    };
    entry.owed.push({ targetAdjudicatorId: item.targetAdjudicatorId, targetRole: item.targetRole });
    bySource.set(key, entry);
  }
  return {
    roundId: round.id,
    enabled,
    expected: expected.length,
    submitted,
    outstanding: [...bySource.values()],
  };
}

export interface FeedbackSourceOption {
  sourceType: "team" | "adjudicator";
  sourceId: string;
  sourceRole: FeedbackSourceRole;
}

/** Participants of a debate who may give feedback on the given adjudicator under the path. */
export function feedbackSourcesForTarget(
  debate: Debate,
  targetAdjudicatorId: string,
  path: FeedbackPath
): FeedbackSourceOption[] {
  const targetRole = adjudicatorRoleInDebate(debate, targetAdjudicatorId);
  if (!targetRole) return [];
  const options: FeedbackSourceOption[] = Object.values(debate.teams ?? {})
    .filter((slot) => Boolean(slot?.teamId))
    .map((slot) => ({ sourceType: "team", sourceId: slot.teamId, sourceRole: "team" }));
  for (const member of panelOf(debate)) {
    const allowed = canSubmitParticipantFeedback({
      sourceType: "adjudicator",
      sourceId: member.id,
      sourceIsChair: member.role === "chair",
      targetType: "adjudicator",
      targetId: targetAdjudicatorId,
      targetIsChair: targetRole === "chair",
      path,
    });
    if (allowed) options.push({ sourceType: "adjudicator", sourceId: member.id, sourceRole: member.role });
  }
  return options;
}
