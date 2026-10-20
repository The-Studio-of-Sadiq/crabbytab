import {
  ballotSides,
  replySpeechesEnabled,
  substantiveSpeakerCount,
  usesVotingBallots,
  type BallotEntry,
  type BallotRules,
  type SideRecord,
} from "@/lib/ballots/result";
import type {
  Adjudicator,
  AdjudicatorSheet,
  BallotSubmission,
  Debate,
  DebateSide,
  Motion,
  Speaker,
  SpeakerScoreEntry,
} from "@/types";

/**
 * State and workflow decisions for the tab-room ballot entry page, kept free of React so they can be
 * tested directly.
 */

/** A blank scoresheet in roster order. Scores start empty (NaN) so nothing is recorded by default. */
export function blankSpeeches(roster: Speaker[], rules: BallotRules): SpeakerScoreEntry[] {
  const count = substantiveSpeakerCount(rules);
  const entries: SpeakerScoreEntry[] = Array.from({ length: count }, (_, index) => ({
    speakerId: roster[index]?.id || "",
    speakerName: roster[index]?.name || "",
    position: index + 1,
    score: Number.NaN,
  }));
  if (replySpeechesEnabled(rules)) {
    entries.push({
      speakerId: roster[0]?.id || "",
      speakerName: roster[0]?.name || "",
      position: count + 1,
      score: Number.NaN,
    });
  }
  return entries;
}

export function blankScores(rosters: SideRecord<Speaker[]>, rules: BallotRules): Record<DebateSide, SpeakerScoreEntry[]> {
  return Object.fromEntries(
    ballotSides(rules.format).map((side) => [side, blankSpeeches(rosters[side] || [], rules)])
  ) as Record<DebateSide, SpeakerScoreEntry[]>;
}

/** The voting members of a panel, chair first. Trainees never vote. */
export function votingAdjudicators(
  debate: Pick<Debate, "adjudicators">,
  adjudicators: Pick<Adjudicator, "id" | "name">[]
): Array<{ id: string; name: string }> {
  const panel = debate.adjudicators;
  const ids = [panel?.chairId, ...(panel?.panellistIds || [])].filter((id): id is string => Boolean(id));
  return ids.map((id) => ({ id, name: adjudicators.find((adjudicator) => adjudicator.id === id)?.name || id }));
}

export function blankEntry(
  debate: Pick<Debate, "adjudicators" | "motionId">,
  rosters: SideRecord<Speaker[]>,
  adjudicators: Pick<Adjudicator, "id" | "name">[],
  rules: BallotRules
): BallotEntry {
  const sides = ballotSides(rules.format);
  const speakerScores = blankScores(rosters, rules);
  return {
    speakerScores,
    ranks: Object.fromEntries(sides.map((side, index) => [side, index + 1])),
    motionId: debate.motionId || "",
    vetoes: {},
    ...(usesVotingBallots(rules)
      ? {
          sheets: votingAdjudicators(debate, adjudicators).map((adjudicator) => ({
            adjudicatorId: adjudicator.id,
            adjudicatorName: adjudicator.name,
            speakerScores: blankScores(rosters, rules),
          })),
        }
      : {}),
  };
}

/** Loads a saved ballot back into an editable entry. */
export function entryFromBallot(ballot: BallotSubmission, blank: BallotEntry, rules: BallotRules): BallotEntry {
  const sides = ballotSides(rules.format);
  const hasScores = sides.some((side) => (ballot.speakerScores?.[side] || []).length > 0);
  return {
    speakerScores: hasScores
      ? (Object.fromEntries(sides.map((side) => [side, ballot.speakerScores[side] || []])) as Record<DebateSide, SpeakerScoreEntry[]>)
      : blank.speakerScores,
    ranks: Object.fromEntries(
      sides.map((side, index) => [side, ballot.teamScores?.[side]?.rank ?? blank.ranks?.[side] ?? index + 1])
    ),
    motionId: ballot.motionId || blank.motionId || "",
    vetoes: { ...(ballot.vetoes || {}) },
    ...(ballot.forfeitSide ? { forfeitSide: ballot.forfeitSide } : {}),
    ...(usesVotingBallots(rules)
      ? {
          sheets: (blank.sheets || []).map(
            (sheet) => ballot.sheets?.find((saved) => saved.adjudicatorId === sheet.adjudicatorId) || sheet
          ),
        }
      : {}),
  };
}

/**
 * Voting ballots: fills each adjudicator's sheet from the ballot they submitted through their
 * private URL, where one exists.
 */
export function sheetsFromPortalBallots(
  sheets: AdjudicatorSheet[],
  ballots: BallotSubmission[],
  debateId: string
): { sheets: AdjudicatorSheet[]; filled: number } {
  let filled = 0;
  const next = sheets.map((sheet) => {
    const submitted = ballots
      .filter((ballot) =>
        ballot.debateId === debateId &&
        !ballot.discarded &&
        ballot.submitterType === "judge" &&
        ballot.submitterId === sheet.adjudicatorId
      )
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];
    if (!submitted) return sheet;
    filled += 1;
    // The adjudicator's own result becomes their declared winner (used when winners are declared).
    const declaredWinner = (Object.entries(submitted.teamScores || {}) as [DebateSide, { rank?: number }][])
      .find(([, score]) => score?.rank === 1)?.[0];
    return { ...sheet, speakerScores: submitted.speakerScores, ...(declaredWinner ? { declaredWinner } : {}) };
  });
  return { sheets: next, filled };
}

export function nextBallotVersion(ballots: BallotSubmission[], debateId: string): number {
  return ballots
    .filter((ballot) => ballot.debateId === debateId)
    .reduce((highest, ballot) => Math.max(highest, ballot.version || 0), 0) + 1;
}

export type BallotCheckState =
  /** Double entry off: save as draft, or save and confirm. */
  | { kind: "single" }
  /** Double entry on, nothing awaiting a check: this entry will need checking. */
  | { kind: "first-entry" }
  /** Review checks: someone else's entry is waiting for this user to confirm or discard. */
  | { kind: "review"; pending: BallotSubmission }
  /** Blind checks: this user re-enters the ballot without seeing the pending entry. */
  | { kind: "blind-check"; pending: BallotSubmission }
  /** This user entered the pending version, so a different person must check it. */
  | { kind: "awaiting-other"; pending: BallotSubmission };

export function resolveCheckState(input: {
  ballots: BallotSubmission[];
  debateId: string;
  userId?: string | null;
  doubleEntry: boolean;
  checkMode?: "review" | "blind";
}): BallotCheckState {
  if (!input.doubleEntry) return { kind: "single" };
  const pending = input.ballots
    .filter((ballot) => ballot.debateId === input.debateId && !ballot.discarded && !ballot.confirmed)
    .sort((left, right) => (right.version || 0) - (left.version || 0))[0];
  if (!pending) return { kind: "first-entry" };
  // Signed-out (single-device) use cannot tell people apart, so it is never blocked.
  if (input.userId && pending.submitterId === input.userId) return { kind: "awaiting-other", pending };
  return input.checkMode === "blind" ? { kind: "blind-check", pending } : { kind: "review", pending };
}

/** Motions for this round; when none are assigned to rounds, every motion is offered. */
export function roundMotions(motions: Motion[], roundId: string | undefined): Motion[] {
  const assigned = roundId ? motions.filter((motion) => motion.rounds?.includes(roundId)) : [];
  return assigned.length > 0 ? assigned : motions;
}
