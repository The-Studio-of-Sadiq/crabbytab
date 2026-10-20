import type { BallotSubmission, Debate, Round, TournamentFormat } from "@/types";
import { diffBallots, type BallotDifference } from "@/lib/ballots/result";
import { confirmBallotCommand } from "@/features/tournament/application/ballots";
import { remoteBallotSubmissionBlocker, TournamentRuleError } from "@/features/tournament/application/stateGuards";

/**
 * Data-entry staff confirming ballots that someone else entered (Tabbycat's "confirm/discard
 * others' ballots" permission; docs/staff-access.md). The server runs the same confirmation
 * command as the tab room, against the debate's records read in a transaction, with two extra
 * rules for staff: the same-person check always applies (nobody confirms their own entry, double
 * entry or not), and nothing that needs a tab-room override (completed rounds, released results)
 * can be confirmed by staff.
 */

export class AssistantConfirmationError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
    readonly differences?: BallotDifference[]
  ) {
    super(message);
  }
}

export interface AssistantConfirmationInput {
  ballotId: string;
  /** The version the assistant looked at; a newer one must be reviewed first. */
  version: number;
  /** Blind checks: the assistant's own re-entry, which must match the pending ballot. */
  reentry?: Pick<BallotSubmission, "motionId" | "motionText" | "speakerScores" | "teamScores" | "sheets" | "vetoes" | "forfeitSide">;
  debateBallots: BallotSubmission[];
  debate: Debate | undefined;
  round: Round | undefined;
  actor: { uid: string; name: string };
  format: TournamentFormat;
  timestamp: string;
}

export interface AssistantConfirmationResult {
  /** Ballots of the debate that changed (the confirmed one and the ones it discarded). */
  ballots: BallotSubmission[];
  debate: Debate;
}

function staffBlocker(round: Round | undefined): string {
  const blocker = remoteBallotSubmissionBlocker(round);
  if (blocker) return blocker;
  if (round?.completed) return `${round.name} is marked complete; ask the tab room to change its results.`;
  if (round?.resultsReleased || round?.teamSpeaksReleased) {
    return `${round?.name ?? "This round"}'s results are released; ask the tab room to change them.`;
  }
  return "";
}

export async function planAssistantConfirmation(input: AssistantConfirmationInput): Promise<AssistantConfirmationResult> {
  const ballot = input.debateBallots.find((item) => item.id === input.ballotId);
  if (!ballot || !input.debate || ballot.debateId !== input.debate.id) {
    throw new AssistantConfirmationError("That ballot no longer exists.", 404);
  }
  if (ballot.confirmed) throw new AssistantConfirmationError("This ballot is already confirmed.", 409);
  if (ballot.discarded) throw new AssistantConfirmationError("This ballot was discarded.", 409);
  if (ballot.version !== input.version) {
    throw new AssistantConfirmationError("This ballot changed since you opened it. Reload and check it again.", 409);
  }
  const newer = input.debateBallots.some((item) =>
    item.id !== ballot.id && !item.discarded && !item.confirmed && (item.version || 0) > (ballot.version || 0)
  );
  if (newer) throw new AssistantConfirmationError("A newer version of this ballot is waiting; check that one instead.", 409);
  if (ballot.submitterId === input.actor.uid) {
    throw new AssistantConfirmationError("You entered this ballot; a different person must check and confirm it.", 409);
  }
  const blocker = staffBlocker(input.round);
  if (blocker) throw new AssistantConfirmationError(blocker, 409);
  if (input.reentry) {
    const differences = diffBallots(ballot, input.reentry, input.format);
    if (differences.length > 0) {
      throw new AssistantConfirmationError("Your entry does not match the ballot being checked.", 409, differences);
    }
  }

  let savedBallots = input.debateBallots;
  let savedDebates: Debate[] = [input.debate];
  try {
    await confirmBallotCommand(ballot.id, ballot.debateId, undefined, {
      ballots: input.debateBallots,
      debates: [input.debate],
      rounds: input.round ? [input.round] : [],
      adjudicators: [],
      repository: {
        saveBallots: (ballots) => { savedBallots = ballots; },
        saveDebates: (debates) => { savedDebates = debates; },
      },
      // Released results were refused above, so the round never changes here.
      updateRound: async () => {
        throw new AssistantConfirmationError("Released results can only be changed by the tab room.", 409);
      },
      // Staff confirmations are recorded on the ballot (confirmedBy / confirmedById).
      recordAuditEvent: async () => undefined,
      checkPolicy: { doubleEntry: true, actorId: input.actor.uid },
      queuePrivateRecord: async () => undefined,
    });
  } catch (error) {
    if (error instanceof TournamentRuleError) {
      throw new AssistantConfirmationError(error.violations.map((violation) => violation.message).join(" "), 409);
    }
    throw error;
  }

  const before = new Map(input.debateBallots.map((item) => [item.id, item]));
  const changed = savedBallots
    .filter((item) => JSON.stringify(item) !== JSON.stringify(before.get(item.id)))
    .map((item) => item.id === ballot.id
      ? { ...item, confirmedBy: input.actor.name, confirmedById: input.actor.uid, confirmedTimestamp: input.timestamp }
      : { ...item, discardedBy: input.actor.name, discardedTimestamp: input.timestamp });
  const debate = savedDebates.find((item) => item.id === input.debate?.id) ?? input.debate;
  return { ballots: changed, debate };
}
