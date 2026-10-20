import type {
  Debate,
  FeedbackPath,
  FeedbackPathConfig,
  FeedbackSourceRole,
  FeedbackSubmission,
  FeedbackTargetRole,
  Round,
} from "@/types";
import { isFeedbackEnabledForRound } from "./questions";
import { isFeedbackPathAllowed, toFeedbackPathConfig } from "./paths";
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
 * The feedback a debate is expected to produce under the given paths (a preset or an explicit
 * config; see paths.ts): teams on the chair or on every adjudicator, and adjudicators on each
 * other as the paths allow. Feedback on teams is optional and never expected.
 */
export function expectedFeedbackForDebate(
  debate: Debate,
  path: FeedbackPath | FeedbackPathConfig
): ExpectedFeedback[] {
  if (debate.byeTeamId || debate.postponed) return [];
  const config = toFeedbackPathConfig(path);
  const panel = panelOf(debate);
  const expected: ExpectedFeedback[] = [];

  for (const slot of Object.values(debate.teams ?? {})) {
    if (!slot?.teamId) continue;
    for (const target of panel) {
      if (!isFeedbackPathAllowed(config, "team", target.role)) continue;
      expected.push({
        roundId: debate.roundId,
        debateId: debate.id,
        sourceType: "team",
        sourceId: slot.teamId,
        sourceRole: "team",
        targetAdjudicatorId: target.id,
        targetRole: target.role,
      });
    }
  }

  for (const source of panel) {
    for (const target of panel) {
      if (source.id === target.id || !isFeedbackPathAllowed(config, source.role, target.role)) continue;
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

/** The adjudicators a participant of a debate gives feedback on under the paths, in panel order. */
export function feedbackTargetsForSource(
  debate: Debate,
  source: { sourceType: "team" | "adjudicator"; sourceId: string },
  path: FeedbackPath | FeedbackPathConfig
): Array<{ targetAdjudicatorId: string; targetRole: FeedbackTargetRole }> {
  return expectedFeedbackForDebate(debate, path)
    .filter((item) => item.sourceType === source.sourceType && item.sourceId === source.sourceId)
    .map(({ targetAdjudicatorId, targetRole }) => ({ targetAdjudicatorId, targetRole }));
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
  path: FeedbackPath | FeedbackPathConfig,
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

/** Participants of a debate who may give feedback on the given adjudicator under the paths. */
export function feedbackSourcesForTarget(
  debate: Debate,
  targetAdjudicatorId: string,
  path: FeedbackPath | FeedbackPathConfig
): FeedbackSourceOption[] {
  const targetRole = adjudicatorRoleInDebate(debate, targetAdjudicatorId);
  if (!targetRole) return [];
  const config = toFeedbackPathConfig(path);
  const options: FeedbackSourceOption[] = isFeedbackPathAllowed(config, "team", targetRole)
    ? Object.values(debate.teams ?? {})
        .filter((slot) => Boolean(slot?.teamId))
        .map((slot) => ({ sourceType: "team", sourceId: slot.teamId, sourceRole: "team" }))
    : [];
  for (const member of panelOf(debate)) {
    if (member.id !== targetAdjudicatorId && isFeedbackPathAllowed(config, member.role, targetRole)) {
      options.push({ sourceType: "adjudicator", sourceId: member.id, sourceRole: member.role });
    }
  }
  return options;
}
