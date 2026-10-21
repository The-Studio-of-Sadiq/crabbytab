import type { BallotSubmission, Debate, Round, Tournament } from "@/types";
import { ballotModeFor, debateBallotRules, usesVotingBallots, type BallotRules } from "@/lib/ballots/result";
import {
  buildMergedBallot,
  isIndividualBallot,
  mergeIndividualBallots,
  votingAdjudicatorIds,
} from "@/lib/ballots/individualBallots";
import { isTabRoomConfirmed, type ExistingBallotRecord, type PrivateBallotWritePlan } from "@/lib/privateSync";

/** Individual ballots apply to voting rounds of two-team tournaments that switched them on. */
export function usesIndividualBallots(
  tournament: Pick<Tournament, "format" | "preferences">,
  round: Pick<Round, "stage"> | undefined
): boolean {
  return tournament.preferences?.individualBallots === true &&
    ballotModeFor(round, { format: tournament.format, preferences: tournament.preferences }) === "voting";
}

/**
 * A private-URL ballot in a voting round without individual ballots. Tabbycat gives the chair the
 * per-adjudicator form there, so the result always has every voting adjudicator's sheet; a private
 * URL here records only the submitter's own sheet. So:
 * - when the submitter is the debate's only voting adjudicator, their sheet is the whole panel and
 *   becomes a proper voting ballot (sheets and votes, and a declared 2:1 split if allowed);
 * - otherwise the ballot is kept unconfirmed for the tab room, which enters the panel's sheets
 *   ("Fill from portal ballots" takes this one) instead of letting one sheet become the result.
 * Other rounds (consensus, or individual ballots) are returned unchanged.
 */
export function votingRoundPrivateBallot(
  ballot: BallotSubmission,
  context: {
    tournament: Pick<Tournament, "format" | "preferences">;
    round: (Pick<Round, "stage"> & Partial<Pick<Round, "seq">>) | undefined;
    debate: Pick<Debate, "id" | "teams" | "adjudicators">;
    rounds?: readonly Pick<Round, "seq">[];
  }
): BallotSubmission {
  const { tournament, round, debate } = context;
  const rules = debateBallotRules(tournament, round, debate, context.rounds);
  if (!usesVotingBallots(rules) || usesIndividualBallots(tournament, round)) return ballot;
  const { confirmedBy: _confirmedBy, confirmedTimestamp: _confirmedTimestamp, ...unconfirmed } = ballot;
  const pending: BallotSubmission = { ...unconfirmed, confirmed: false };
  const voters = votingAdjudicatorIds(debate);
  if (voters.length !== 1 || voters[0] !== ballot.submitterId) return pending;
  const merge = mergeIndividualBallots(
    debate,
    [{ ...ballot, singleAdjudicator: true }],
    rules,
    new Map([[ballot.submitterId ?? "", ballot.submitterName ?? ""]])
  );
  if (!merge.result || merge.errors.length > 0 || merge.missingAdjudicatorIds.length > 0) return pending;
  const { selfSplit: _selfSplit, noSpeakerScores: _noSpeakerScores, ...own } = ballot;
  return { ...own, ...merge.result };
}

/**
 * Applies the tournament's private-ballot policy to a ballot built from a private URL: an
 * individual sheet (see planIndividualBallotWrites), or a consensus ballot that the chair's
 * submission confirms unless the tab room confirms private ballots itself.
 */
export function applyPrivateBallotConfirmation(
  ballot: BallotSubmission,
  tournament: Pick<Tournament, "format" | "preferences">,
  round: Pick<Round, "stage"> | undefined
): BallotSubmission {
  const { confirmedBy: _confirmedBy, confirmedTimestamp: _confirmedTimestamp, ...unconfirmed } = ballot;
  if (usesIndividualBallots(tournament, round)) return { ...unconfirmed, confirmed: false, singleAdjudicator: true };
  if (tournament.preferences?.privateBallotConfirmation === "tab_room") return { ...unconfirmed, confirmed: false };
  return ballot;
}

/**
 * How private-URL ballots are stored when individual ballots are on (docs/staff-access.md,
 * "Individual ballots"). Each voting adjudicator's submission is stored unconfirmed as their own
 * sheet and replaces only their own earlier sheets. When every voting adjudicator has a sheet, the
 * sheets agree and `autoConfirm` is on (private ballots confirmed by the panel), a merged voting
 * ballot is written confirmed and earlier merges are discarded; otherwise the tab room merges.
 *
 * A debate whose result the tab room confirmed, or whose round is locked, is never changed: the
 * sheets are stored for review and nothing is merged or discarded.
 */
export interface IndividualBallotWritePlan extends PrivateBallotWritePlan {
  /** Merged ballots written by this plan (already included in `writes`). */
  merged: BallotSubmission[];
  /** Why a debate's sheets were not merged automatically, per debate id. */
  pendingReasons: Map<string, string>;
}

export function planIndividualBallotWrites(input: {
  submissions: readonly BallotSubmission[];
  existingByDebate: ReadonlyMap<string, readonly ExistingBallotRecord[]>;
  lockedDebateIds: ReadonlySet<string>;
  debates: ReadonlyMap<string, Debate>;
  rulesFor: (debate: Debate) => BallotRules;
  autoConfirm: boolean;
  timestamp: string;
}): IndividualBallotWritePlan {
  const discardExistingIds: string[] = [];
  const writes: BallotSubmission[] = [];
  const merged: BallotSubmission[] = [];
  const pendingReasons = new Map<string, string>();

  for (const debateId of [...new Set(input.submissions.map((ballot) => ballot.debateId))]) {
    const existing = input.existingByDebate.get(debateId) ?? [];
    const locked = input.lockedDebateIds.has(debateId) || existing.some((record) => isTabRoomConfirmed(record.data));
    let version = existing.reduce((highest, record) => Math.max(highest, Number(record.data.version) || 0), 0);
    const takenIds = new Set(existing.map((record) => record.id));
    // Only the last submission of each adjudicator in this request counts.
    const group = input.submissions.filter((ballot) => ballot.debateId === debateId);
    const lastBySubmitter = new Map(group.map((ballot) => [ballot.submitterId, ballot.id]));
    const newSheets: BallotSubmission[] = [];
    for (const ballot of group) {
      version += 1;
      const { confirmedBy: _confirmedBy, confirmedTimestamp: _confirmedTimestamp, ...rest } = ballot;
      const sheet: BallotSubmission = {
        ...rest,
        id: takenIds.has(ballot.id) ? `${ballot.id}-v${version}` : ballot.id,
        version,
        confirmed: false,
        discarded: lastBySubmitter.get(ballot.submitterId) !== ballot.id,
        singleAdjudicator: true,
      };
      takenIds.add(sheet.id);
      writes.push(sheet);
      if (!sheet.discarded) newSheets.push(sheet);
    }
    if (locked) {
      pendingReasons.set(debateId, "The tab room has confirmed this debate's result or closed its round.");
      continue;
    }
    // An adjudicator's new sheet replaces their earlier ones.
    const resubmitted = new Set(newSheets.map((sheet) => sheet.submitterId));
    for (const record of existing) {
      const data = record.data as BallotSubmission;
      if (data.discarded !== true && isIndividualBallot(data) && resubmitted.has(data.submitterId)) {
        discardExistingIds.push(record.id);
      }
    }
    const debate = input.debates.get(debateId);
    if (!debate) continue;
    const discarded = new Set(discardExistingIds);
    const current = [
      ...existing.filter((record) => !discarded.has(record.id)).map((record) => ({ ...record.data, id: record.id }) as BallotSubmission),
      ...newSheets,
    ];
    const merge = mergeIndividualBallots(debate, current, input.rulesFor(debate));
    if (merge.missingAdjudicatorIds.length > 0) {
      pendingReasons.set(debateId, `Waiting for ${merge.missingAdjudicatorIds.length} more adjudicator(s).`);
      continue;
    }
    if (merge.errors.length > 0) {
      pendingReasons.set(debateId, merge.errors.join(" "));
      continue;
    }
    if (!input.autoConfirm) {
      pendingReasons.set(debateId, "Every sheet is in; the tab room merges and confirms the result.");
      continue;
    }
    version += 1;
    const ballot = buildMergedBallot(merge, { debate, version, timestamp: input.timestamp, confirmed: true });
    if (!ballot) continue;
    // The new merge supersedes every earlier ballot of the debate except the sheets themselves.
    for (const record of existing) {
      const data = record.data as BallotSubmission;
      if (data.discarded !== true && !isIndividualBallot(data) && !discarded.has(record.id)) discardExistingIds.push(record.id);
    }
    writes.push(ballot);
    merged.push(ballot);
  }
  return { discardExistingIds: [...new Set(discardExistingIds)], writes, merged, pendingReasons };
}
