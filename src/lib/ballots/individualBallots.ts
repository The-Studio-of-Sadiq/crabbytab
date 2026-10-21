import type { AdjudicatorSheet, BallotSubmission, Debate, DebateSide, SpeakerScoreEntry } from "@/types";
import {
  aggregateVotingSheets,
  ballotSides,
  markGhostSpeeches,
  selfSplitAllowed,
  sheetOutcome,
  type BallotRules,
} from "@/lib/ballots/result";

/**
 * Individual ballots (Tabbycat `individual_ballots` and "merge latest ballots"): with voting
 * ballots, each voting adjudicator submits their own scoresheet through their private URL. The
 * latest sheet of every voting adjudicator is merged into one voting ballot, which is then
 * aggregated like any other voting ballot (`aggregateVotingSheets`), so the merge stays independent
 * of how ballots are scored.
 *
 * Like Tabbycat's `populate_from_merge`, the sheets must agree on everything that is not a score:
 * which speaker gave each speech, the motion, vetoes and (manual-ballot sides) which team took which
 * side. Disagreements are reported, never resolved silently.
 */

function declaredWinnerOf(ballot: BallotSubmission): { declaredWinner?: DebateSide } {
  const winner = (Object.entries(ballot.teamScores || {}) as [DebateSide, { rank?: number } | undefined][])
    .find(([, score]) => score?.rank === 1)?.[0];
  return winner ? { declaredWinner: winner } : {};
}

export const MERGED_BALLOT_SUBMITTER_NAME = "Merged individual ballots";

/** Voting adjudicators of a debate: the chair and panellists (trainees never vote). */
export function votingAdjudicatorIds(debate: Pick<Debate, "adjudicators">): string[] {
  const panel = debate.adjudicators;
  return [...new Set([panel?.chairId, ...(panel?.panellistIds ?? [])].filter((id): id is string => Boolean(id)))];
}

export function isIndividualBallot(ballot: Pick<BallotSubmission, "singleAdjudicator" | "submitterType">): boolean {
  return ballot.singleAdjudicator === true && ballot.submitterType === "judge";
}

/** The latest (highest version, then newest) non-discarded individual ballot of each adjudicator. */
export function latestIndividualBallots(ballots: readonly BallotSubmission[], debateId: string): Map<string, BallotSubmission> {
  const latest = new Map<string, BallotSubmission>();
  for (const ballot of ballots) {
    if (ballot.debateId !== debateId || ballot.discarded || !isIndividualBallot(ballot) || !ballot.submitterId) continue;
    const current = latest.get(ballot.submitterId);
    if (
      !current ||
      (ballot.version || 0) > (current.version || 0) ||
      ((ballot.version || 0) === (current.version || 0) && ballot.timestamp > current.timestamp)
    ) {
      latest.set(ballot.submitterId, ballot);
    }
  }
  return latest;
}

export interface IndividualMerge {
  /** Voting adjudicators who have not submitted a sheet yet. */
  missingAdjudicatorIds: string[];
  /** Disagreements between sheets; the merge is unusable while there are any. */
  errors: string[];
  /** The individual ballots merged (one per voting adjudicator who submitted). */
  merged: BallotSubmission[];
  /** Scores of the merged voting ballot; absent when there are errors or no sheets. */
  result?: Pick<BallotSubmission, "speakerScores" | "teamScores" | "sheets" | "motionId" | "motionText" | "vetoes" | "noSpeakerScores" | "selfSplit">;
}

function speakerKey(entry: SpeakerScoreEntry | undefined): string {
  return entry ? `${entry.speakerId}${entry.ghost ? "*" : ""}` : "—";
}

/**
 * Merges the latest individual ballot of every voting adjudicator of `debate`. A complete merge has
 * no missing adjudicators and no errors.
 */
export function mergeIndividualBallots(
  debate: Pick<Debate, "id" | "teams" | "adjudicators">,
  ballots: readonly BallotSubmission[],
  rules: BallotRules,
  adjudicatorNames: ReadonlyMap<string, string> = new Map()
): IndividualMerge {
  if (rules.format === "bp") {
    return { missingAdjudicatorIds: [], errors: ["British Parliamentary panels submit one consensus ballot."], merged: [] };
  }
  const voters = votingAdjudicatorIds(debate);
  const latest = latestIndividualBallots(ballots, debate.id);
  const merged = voters.map((id) => latest.get(id)).filter((ballot): ballot is BallotSubmission => Boolean(ballot));
  const missingAdjudicatorIds = voters.filter((id) => !latest.has(id));
  const errors: string[] = [];
  if (merged.length === 0) return { missingAdjudicatorIds, errors, merged };

  const sides = ballotSides(rules.format);
  const name = (ballot: BallotSubmission) =>
    adjudicatorNames.get(ballot.submitterId || "") || ballot.submitterName || "An adjudicator";
  const [first, ...others] = merged;
  for (const other of others) {
    if ((other.motionId || "") !== (first.motionId || "")) {
      errors.push(`${name(other)} and ${name(first)} recorded different motions.`);
    }
    for (const side of sides) {
      if ((other.teamScores?.[side]?.teamId || "") !== (first.teamScores?.[side]?.teamId || "")) {
        errors.push(`${name(other)} and ${name(first)} put different teams on ${side}.`);
      }
      if ((other.vetoes?.[side] || "") !== (first.vetoes?.[side] || "")) {
        errors.push(`${name(other)} and ${name(first)} recorded different ${side} vetoes.`);
      }
      const a = first.speakerScores?.[side] ?? [];
      const b = other.speakerScores?.[side] ?? [];
      const positions = Math.max(a.length, b.length);
      for (let index = 0; index < positions; index += 1) {
        if (speakerKey(a[index]) !== speakerKey(b[index]) || a[index]?.position !== b[index]?.position) {
          errors.push(`${name(other)} and ${name(first)} list different speakers for ${side} speech ${index + 1}.`);
        }
      }
    }
  }

  const sheets: AdjudicatorSheet[] = merged.map((ballot) => ({
    adjudicatorId: ballot.submitterId || "",
    adjudicatorName: name(ballot),
    speakerScores: Object.fromEntries(
      sides.map((side) => [side, markGhostSpeeches(ballot.speakerScores?.[side] ?? [], rules)])
    ) as Record<DebateSide, SpeakerScoreEntry[]>,
    // The adjudicator's own result is their declared winner (winnersInBallots, results-only ballots).
    ...declaredWinnerOf(ballot),
  }));
  for (const [index, sheet] of sheets.entries()) {
    if (!sheetOutcome(sheet, rules).winner) {
      errors.push(`${name(merged[index])}'s scoresheet has no winner (tied team totals, or a declared winner that does not fit the totals).`);
    }
  }
  if (errors.length > 0) return { missingAdjudicatorIds, errors: [...new Set(errors)], merged };

  const teamIds = Object.fromEntries(sides.map((side) => [side, first.teamScores?.[side]?.teamId || debate.teams?.[side]?.teamId || ""]));
  // A solo adjudicator's own sheet may declare a 2:1 split (allowSelfSplitBallots).
  const selfSplit = merged.length === 1 && merged[0].selfSplit === true && selfSplitAllowed(rules, voters.length);
  try {
    const aggregated = aggregateVotingSheets(sheets, debate.adjudicators?.chairId, teamIds, rules, { selfSplit });
    return {
      missingAdjudicatorIds,
      errors,
      merged,
      result: {
        speakerScores: aggregated.speakerScores,
        teamScores: aggregated.teamScores,
        sheets,
        ...(first.motionId !== undefined ? { motionId: first.motionId } : {}),
        ...(first.motionText !== undefined ? { motionText: first.motionText } : {}),
        ...(first.vetoes !== undefined ? { vetoes: first.vetoes } : {}),
        ...(merged.every((ballot) => ballot.noSpeakerScores) ? { noSpeakerScores: true } : {}),
        ...(aggregated.selfSplit ? { selfSplit: true } : {}),
      },
    };
  } catch (error) {
    return {
      missingAdjudicatorIds,
      errors: [error instanceof Error ? error.message : "The scoresheets could not be merged."],
      merged,
    };
  }
}

/** A merged voting ballot built from a complete merge. */
export function buildMergedBallot(
  merge: IndividualMerge,
  context: {
    debate: Pick<Debate, "id" | "roundId" | "tournamentId" | "adjudicators">;
    version: number;
    timestamp: string;
    confirmed: boolean;
  }
): BallotSubmission | null {
  if (!merge.result || merge.errors.length > 0 || merge.missingAdjudicatorIds.length > 0) return null;
  const { debate } = context;
  const chairId = debate.adjudicators?.chairId;
  return {
    id: `ballot-${debate.id}-merged-v${context.version}`,
    tournamentId: debate.tournamentId,
    roundId: debate.roundId,
    debateId: debate.id,
    version: context.version,
    confirmed: context.confirmed,
    discarded: false,
    submitterType: "judge",
    // No submitterId: the merge is nobody's own sheet (sheetsFromPortalBallots reads those).
    ...(chairId ? { chairId } : {}),
    submitterName: MERGED_BALLOT_SUBMITTER_NAME,
    ...merge.result,
    speakerScores: merge.result.speakerScores,
    teamScores: merge.result.teamScores,
    mergedFromIds: merge.merged.map((ballot) => ballot.id),
    timestamp: context.timestamp,
    // Confirmed by the merge itself, not the tab room: a later sheet re-merges (isTabRoomConfirmed).
    ...(context.confirmed ? { confirmedBy: MERGED_BALLOT_SUBMITTER_NAME, confirmedTimestamp: context.timestamp } : {}),
  };
}
