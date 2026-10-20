import type {
  AdjudicatorSheet,
  BallotMode,
  BallotSubmission,
  Debate,
  DebateSide,
  Round,
  RoundStage,
  Speaker,
  SpeakerScoreEntry,
  TeamScoreEntry,
  TournamentFormat,
  TournamentPreferences,
} from "@/types";
import { validateReplyScore, validateSpeakerScore } from "@/lib/scoring/validator";
import { ballotSideAssignment, isSidePermutation, sidesChosenOnBallot } from "@/lib/draw/manualSides";

/**
 * Pure ballot logic shared by tab-room entry, the private portal and standings: how speeches are
 * totalled (ghosts, replies), how consensus and voting ballots turn into a result, forfeits,
 * validation and double-entry comparison.
 */

export const BP_SIDES: DebateSide[] = ["OG", "OO", "CG", "CO"];
export const TWO_TEAM_SIDES: DebateSide[] = ["AFF", "NEG"];

export type SideRecord<T> = Partial<Record<DebateSide, T>>;

export interface BallotRules {
  format: TournamentFormat;
  preferences?: Partial<TournamentPreferences>;
  /** Stage of the round the ballot is for; elimination rounds may use their own ballot mode. Absent = preliminary. */
  stage?: RoundStage;
}

export function ballotSides(format: TournamentFormat): DebateSide[] {
  return format === "bp" ? BP_SIDES : TWO_TEAM_SIDES;
}

export function substantiveSpeakerCount(rules: BallotRules): number {
  return rules.preferences?.substantiveSpeakers || (rules.format === "bp" ? 2 : 3);
}

export function replySpeechesEnabled(rules: BallotRules): boolean {
  return Boolean(rules.preferences?.replyScoresEnabled && rules.format !== "bp");
}

/**
 * The ballot mode for a round, like Tabbycat's `ballots_per_debate_prelim` / `_elim`: preliminary
 * rounds use `ballotMode`; elimination rounds use `eliminationBallotMode`, falling back to
 * `ballotMode` when it is not set. Voting ballots exist only for two-team formats; BP panels
 * always reach a consensus. Every reader of the ballot mode should go through this.
 */
export function ballotModeFor(
  round: Pick<Round, "stage"> | null | undefined,
  rules: Pick<BallotRules, "format" | "preferences">
): BallotMode {
  if (rules.format === "bp") return "consensus";
  const preferences = rules.preferences;
  const mode = round?.stage === "elimination"
    ? preferences?.eliminationBallotMode ?? preferences?.ballotMode
    : preferences?.ballotMode;
  return mode === "voting" ? "voting" : "consensus";
}

/** True when ballots for `rules.stage` (preliminary when absent) are one scoresheet per voting adjudicator. */
export function usesVotingBallots(rules: BallotRules): boolean {
  return ballotModeFor(rules.stage ? { stage: rules.stage } : undefined, rules) === "voting";
}

/**
 * True when a ballot's teams are the debate's teams. A ballot whose sides name different teams
 * belongs to an earlier version of the draw and must not be read as this debate's result.
 * Ballots that record no team ids (very old data) are accepted.
 */
export function ballotMatchesDebate(
  ballot: Pick<BallotSubmission, "teamScores">,
  debate: Pick<Debate, "teams"> & Partial<Pick<Debate, "flags" | "sidesConfirmed" | "byeTeamId">>
): boolean {
  // Sides chosen on the ballot: it may put the debate's teams on either side.
  if (sidesChosenOnBallot({ flags: [], ...debate })) {
    const assignment = ballotSideAssignment(ballot);
    if (Object.keys(assignment).length > 0) return isSidePermutation(debate, assignment);
  }
  for (const [side, slot] of Object.entries(debate.teams || {})) {
    const recorded = ballot.teamScores?.[side as DebateSide]?.teamId;
    if (slot?.teamId && recorded && recorded !== slot.teamId) return false;
  }
  return true;
}

export function isReplyEntry(entry: Pick<SpeakerScoreEntry, "position">, rules: BallotRules): boolean {
  return replySpeechesEnabled(rules) && entry.position > substantiveSpeakerCount(rules);
}

/**
 * Strips floating-point noise (e.g. 0.1 + 0.2) without changing the value. Scores are NOT rounded
 * to a display precision: averaged voting scores such as 224/3 must stay exact so equal averages
 * stay tied, as in Tabbycat. Display code formats them.
 */
function cleanScore(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/**
 * Flags duplicate substantive speeches by the same speaker as ghosts. An explicit choice of which
 * speech is the ghost is kept when it leaves exactly one counted speech; otherwise every speech
 * after the first is flagged.
 */
export function markGhostSpeeches(entries: SpeakerScoreEntry[], rules: BallotRules): SpeakerScoreEntry[] {
  const bySpeaker = new Map<string, SpeakerScoreEntry[]>();
  for (const entry of entries) {
    if (isReplyEntry(entry, rules) || !entry.speakerId) continue;
    bySpeaker.set(entry.speakerId, [...(bySpeaker.get(entry.speakerId) || []), entry]);
  }
  const ghosts = new Set<SpeakerScoreEntry>();
  for (const speeches of bySpeaker.values()) {
    if (speeches.length < 2) continue;
    const counted = speeches.filter((entry) => !entry.ghost);
    const keep = counted.length === 1 ? counted[0] : speeches[0];
    for (const entry of speeches) if (entry !== keep) ghosts.add(entry);
  }
  return entries.map((entry) => {
    if (isReplyEntry(entry, rules)) {
      const { ghost: _ghost, ...rest } = entry;
      return rest;
    }
    if (ghosts.has(entry)) return { ...entry, ghost: true };
    const { ghost: _ghost, ...rest } = entry;
    return rest;
  });
}

/** A team's total for one scoresheet: counted substantive speeches plus the reply. */
export function teamSpeakerTotal(entries: SpeakerScoreEntry[], rules: BallotRules): number {
  const includeGhosts = rules.preferences?.teamScoreIncludesGhosts ?? false;
  return cleanScore(
    entries
      .filter((entry) => isReplyEntry(entry, rules) || includeGhosts || !entry.ghost)
      .reduce((sum, entry) => sum + (Number.isFinite(entry.score) ? entry.score : 0), 0)
  );
}

function pointsForRank(rank: number, rules: BallotRules): number {
  return rules.format === "bp" ? BP_SIDES.length - rank : rank === 1 ? 1 : 0;
}

/**
 * Team results for a consensus ballot. Two-team margins are the difference between the teams'
 * totals (positive for the winner); BP has no margin.
 */
export function consensusTeamScores(
  speakerScores: SideRecord<SpeakerScoreEntry[]>,
  ranks: SideRecord<number>,
  teamIds: SideRecord<string>,
  rules: BallotRules
): Record<DebateSide, TeamScoreEntry> {
  const sides = ballotSides(rules.format);
  const totals = Object.fromEntries(
    sides.map((side) => [side, teamSpeakerTotal(speakerScores[side] || [], rules)])
  ) as Record<DebateSide, number>;
  const result = {} as Record<DebateSide, TeamScoreEntry>;
  for (const side of sides) {
    const rank = ranks[side] ?? sides.indexOf(side) + 1;
    const points = pointsForRank(rank, rules);
    const opponent = sides.find((candidate) => candidate !== side);
    result[side] = {
      side,
      teamId: teamIds[side] || "",
      points,
      totalSpeakerScore: totals[side],
      rank,
      win: rules.format === "bp" ? points >= 2 : rank === 1,
      ...(rules.format === "bp" || !opponent ? {} : { margin: cleanScore(totals[side] - totals[opponent]) }),
    };
  }
  return result;
}

export interface SheetOutcome {
  totals: Record<DebateSide, number>;
  /** Undefined when the sheet's totals are tied. */
  winner?: DebateSide;
}

export function sheetOutcome(sheet: Pick<AdjudicatorSheet, "speakerScores">, rules: BallotRules): SheetOutcome {
  const [first, second] = TWO_TEAM_SIDES;
  const totals = {
    [first]: teamSpeakerTotal(sheet.speakerScores[first] || [], rules),
    [second]: teamSpeakerTotal(sheet.speakerScores[second] || [], rules),
  } as Record<DebateSide, number>;
  const winner = totals[first] === totals[second] ? undefined : totals[first] > totals[second] ? first : second;
  return { totals, winner };
}

export interface VotingResult {
  speakerScores: Record<DebateSide, SpeakerScoreEntry[]>;
  teamScores: Record<DebateSide, TeamScoreEntry>;
  winner: DebateSide;
  votes: Record<DebateSide, number>;
  majorityAdjudicatorIds: string[];
}

/**
 * Aggregates two-team voting sheets the way Tabbycat does: each sheet votes for the team with the
 * higher total, the majority wins (the chair breaks a tied panel), and the recorded speaker scores
 * are the average of the majority adjudicators' scores. The margin uses only the majority unless
 * `marginIncludesDissenters` is on.
 */
export function aggregateVotingSheets(
  sheets: AdjudicatorSheet[],
  chairId: string | undefined,
  teamIds: SideRecord<string>,
  rules: BallotRules
): VotingResult {
  if (sheets.length === 0) throw new Error("A voting ballot needs at least one adjudicator's scoresheet.");
  const outcomes = sheets.map((sheet) => sheetOutcome(sheet, rules));
  const votes = Object.fromEntries(
    TWO_TEAM_SIDES.map((side) => [side, outcomes.filter((outcome) => outcome.winner === side).length])
  ) as Record<DebateSide, number>;
  const [first, second] = TWO_TEAM_SIDES;
  let winner: DebateSide;
  if (votes[first] !== votes[second]) {
    winner = votes[first] > votes[second] ? first : second;
  } else {
    const chairIndex = sheets.findIndex((sheet) => sheet.adjudicatorId === chairId);
    const tieBreaker = outcomes[chairIndex >= 0 ? chairIndex : 0].winner;
    if (!tieBreaker) throw new Error("The panel is tied and the chair's scoresheet has no winner.");
    winner = tieBreaker;
  }
  const majority = sheets.filter((_, index) => outcomes[index].winner === winner);
  const majorityOutcomes = outcomes.filter((outcome) => outcome.winner === winner);
  const averageOver = (pool: AdjudicatorSheet[]) => {
    const averaged = {} as Record<DebateSide, SpeakerScoreEntry[]>;
    for (const side of TWO_TEAM_SIDES) {
      const template = pool[0].speakerScores[side] || [];
      averaged[side] = template.map((entry, index) => ({
        ...entry,
        score: cleanScore(
          pool.reduce((sum, sheet) => sum + (sheet.speakerScores[side]?.[index]?.score ?? 0), 0) / pool.length
        ),
      }));
    }
    return averaged;
  };
  const speakerScores = averageOver(majority);
  // Margins come from each sheet's exact totals, so per-speaker rounding never shifts them.
  const marginOutcomes = rules.preferences?.marginIncludesDissenters
    ? outcomes
    : outcomes.filter((outcome) => outcome.winner === winner);
  const loser = winner === first ? second : first;
  const margin = cleanScore(
    marginOutcomes.reduce((sum, outcome) => sum + outcome.totals[winner] - outcome.totals[loser], 0) /
      marginOutcomes.length
  );
  const teamScores = {} as Record<DebateSide, TeamScoreEntry>;
  for (const side of TWO_TEAM_SIDES) {
    const won = side === winner;
    teamScores[side] = {
      side,
      teamId: teamIds[side] || "",
      points: won ? 1 : 0,
      // The mean of the majority sheets' own totals: exact, unlike a sum of averaged speeches.
      totalSpeakerScore: cleanScore(
        majorityOutcomes.reduce((sum, outcome) => sum + outcome.totals[side], 0) / majorityOutcomes.length
      ),
      rank: won ? 1 : 2,
      win: won,
      margin: won ? margin : -margin,
      votes: votes[side],
    };
  }
  return {
    speakerScores,
    teamScores,
    winner,
    votes,
    majorityAdjudicatorIds: majority.map((sheet) => sheet.adjudicatorId),
  };
}

/** A forfeit: the other team wins, and neither team is credited with speaker scores. */
export function forfeitTeamScores(
  forfeitSide: DebateSide,
  teamIds: SideRecord<string>,
  rules: BallotRules
): Record<DebateSide, TeamScoreEntry> {
  if (rules.format === "bp") throw new Error("Forfeits are only supported in two-team formats.");
  const result = {} as Record<DebateSide, TeamScoreEntry>;
  for (const side of TWO_TEAM_SIDES) {
    const forfeited = side === forfeitSide;
    result[side] = {
      side,
      teamId: teamIds[side] || "",
      points: forfeited ? 0 : 1,
      totalSpeakerScore: 0,
      rank: forfeited ? 2 : 1,
      win: !forfeited,
      margin: 0,
      ...(forfeited ? { forfeit: true } : {}),
    };
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export interface BallotEntry {
  speakerScores: SideRecord<SpeakerScoreEntry[]>;
  ranks?: SideRecord<number>;
  sheets?: AdjudicatorSheet[];
  forfeitSide?: DebateSide;
  motionId?: string;
  vetoes?: SideRecord<string>;
}

export interface BallotValidationContext extends BallotRules {
  rosters: SideRecord<Speaker[]>;
  /** Motions available in this round; empty means motions are not tracked per round. */
  roundMotionIds?: string[];
}

function validateSheetScores(
  speakerScores: SideRecord<SpeakerScoreEntry[]>,
  context: BallotValidationContext,
  label: string
): string[] {
  const errors: string[] = [];
  const substantive = substantiveSpeakerCount(context);
  const replies = replySpeechesEnabled(context);
  for (const side of ballotSides(context.format)) {
    const entries = speakerScores[side] || [];
    const roster = new Set((context.rosters[side] || []).map((speaker) => speaker.id));
    const prefix = `${label}${side}`;
    const speeches = entries.filter((entry) => !isReplyEntry(entry, context));
    const positions = speeches.map((entry) => entry.position).sort((a, b) => a - b);
    if (speeches.length !== substantive || positions.some((position, index) => position !== index + 1)) {
      errors.push(`${prefix}: enter exactly ${substantive} substantive speeches in order.`);
    }
    for (const entry of speeches) {
      if (!roster.has(entry.speakerId)) errors.push(`${prefix} speaker ${entry.position}: choose a speaker from the team.`);
      const check = validateSpeakerScore(entry.score, context.preferences);
      if (!check.valid) errors.push(`${prefix} speaker ${entry.position}: ${check.error}`);
    }
    const counted = new Map<string, number>();
    for (const entry of speeches) {
      if (!entry.ghost) counted.set(entry.speakerId, (counted.get(entry.speakerId) || 0) + 1);
    }
    for (const [speakerId, count] of counted) {
      if (count > 1) {
        const name = speeches.find((entry) => entry.speakerId === speakerId)?.speakerName || "A speaker";
        errors.push(`${prefix}: ${name} speaks more than once; mark the extra speech as an iron-person (ghost) speech.`);
      }
    }
    const replyEntries = entries.filter((entry) => isReplyEntry(entry, context));
    if (replies) {
      if (replyEntries.length !== 1) {
        errors.push(`${prefix}: enter exactly one reply speech.`);
      } else {
        const reply = replyEntries[0];
        const check = validateReplyScore(reply.score, context.preferences);
        if (!check.valid) errors.push(`${prefix} reply: ${check.error}`);
        const eligible = speeches
          .filter((entry) => entry.position < substantive)
          .map((entry) => entry.speakerId);
        if (!eligible.includes(reply.speakerId)) {
          errors.push(`${prefix} reply: the reply must be given by one of the first ${substantive - 1} speakers.`);
        }
      }
    } else if (replyEntries.length > 0) {
      errors.push(`${prefix}: reply speeches are not enabled for this tournament.`);
    }
  }
  return errors;
}

function speakerOrder(scores: SideRecord<SpeakerScoreEntry[]>): string {
  return TWO_TEAM_SIDES.map((side) =>
    (scores[side] || []).map((entry) => `${entry.position}:${entry.speakerId}`).join(",")
  ).join("|");
}

export function validateBallotEntry(entry: BallotEntry, context: BallotValidationContext): string[] {
  const errors: string[] = [];
  const sides = ballotSides(context.format);
  const motionIds = context.roundMotionIds || [];

  if (entry.motionId && motionIds.length > 0 && !motionIds.includes(entry.motionId)) {
    errors.push("The motion is not one of this round's motions.");
  }
  for (const [side, motionId] of Object.entries(entry.vetoes || {})) {
    if (!motionId) continue;
    if (!context.preferences?.enableMotionVetoes) {
      errors.push("Motion vetoes are not enabled for this tournament.");
      break;
    }
    if (!sides.includes(side as DebateSide)) errors.push(`Veto recorded for an unknown side (${side}).`);
    if (motionIds.length > 0 && !motionIds.includes(motionId)) errors.push(`${side} vetoed a motion from another round.`);
    if (motionId === entry.motionId) errors.push(`${side} cannot veto the motion that was debated.`);
  }

  if (entry.forfeitSide) {
    if (context.format === "bp" || !context.preferences?.enableForfeits) {
      errors.push("Forfeits are not enabled for this tournament.");
    } else if (!sides.includes(entry.forfeitSide)) {
      errors.push("Choose which team forfeited.");
    }
    return errors;
  }

  if (usesVotingBallots(context)) {
    const sheets = entry.sheets || [];
    if (sheets.length === 0) errors.push("Enter at least one adjudicator's scoresheet.");
    const adjudicatorIds = new Set<string>();
    for (const sheet of sheets) {
      const label = `${sheet.adjudicatorName || "Adjudicator"} — `;
      if (adjudicatorIds.has(sheet.adjudicatorId)) errors.push(`${label}has more than one scoresheet.`);
      adjudicatorIds.add(sheet.adjudicatorId);
      errors.push(...validateSheetScores(sheet.speakerScores, context, label));
      if (!sheetOutcome(sheet, context).winner) {
        errors.push(`${label}team totals are tied; each scoresheet must have a winner.`);
      }
    }
    const orders = new Set(sheets.map((sheet) => speakerOrder(sheet.speakerScores)));
    if (orders.size > 1) errors.push("Every scoresheet must list the same speakers in the same order.");
    return errors;
  }

  errors.push(...validateSheetScores(entry.speakerScores, context, ""));
  const ranks = entry.ranks || {};
  const rankValues = sides.map((side) => ranks[side]);
  if (rankValues.some((rank) => !Number.isInteger(rank)) || new Set(rankValues).size !== sides.length) {
    errors.push(context.format === "bp"
      ? "Give each team a different rank from 1st to 4th."
      : "One team must win and the other must lose.");
  } else if (!context.preferences?.allowLowPointWins) {
    const totals = Object.fromEntries(
      sides.map((side) => [side, teamSpeakerTotal(entry.speakerScores[side] || [], context)])
    ) as Record<DebateSide, number>;
    for (const higher of sides) {
      for (const lower of sides) {
        if ((ranks[higher] as number) < (ranks[lower] as number) && totals[higher] < totals[lower]) {
          errors.push(
            `${higher} is ranked above ${lower} with a lower total (${totals[higher]} vs ${totals[lower]}). ` +
            "Low-point wins are not allowed."
          );
        }
      }
    }
    if (context.format !== "bp") {
      const [first, second] = sides;
      if (totals[first] === totals[second]) errors.push("Team totals are tied; adjust the scores so the winner has the higher total.");
    }
  }
  return errors;
}

/* -------------------------------------------------------------------------- */
/* Assembling and comparing ballots                                           */
/* -------------------------------------------------------------------------- */

export interface BallotResult {
  speakerScores: Record<DebateSide, SpeakerScoreEntry[]>;
  teamScores: Record<DebateSide, TeamScoreEntry>;
  sheets?: AdjudicatorSheet[];
}

/** Turns a validated entry into the scores stored on the ballot. */
export function buildBallotResult(
  entry: BallotEntry,
  teamIds: SideRecord<string>,
  chairId: string | undefined,
  rules: BallotRules
): BallotResult {
  const sides = ballotSides(rules.format);
  if (entry.forfeitSide) {
    return {
      speakerScores: Object.fromEntries(sides.map((side) => [side, []])) as unknown as Record<DebateSide, SpeakerScoreEntry[]>,
      teamScores: forfeitTeamScores(entry.forfeitSide, teamIds, rules),
    };
  }
  if (usesVotingBallots(rules)) {
    const sheets = (entry.sheets || []).map((sheet) => ({
      ...sheet,
      speakerScores: Object.fromEntries(
        sides.map((side) => [side, markGhostSpeeches(sheet.speakerScores[side] || [], rules)])
      ) as Record<DebateSide, SpeakerScoreEntry[]>,
    }));
    const result = aggregateVotingSheets(sheets, chairId, teamIds, rules);
    return { speakerScores: result.speakerScores, teamScores: result.teamScores, sheets };
  }
  const speakerScores = Object.fromEntries(
    sides.map((side) => [side, markGhostSpeeches(entry.speakerScores[side] || [], rules)])
  ) as Record<DebateSide, SpeakerScoreEntry[]>;
  return { speakerScores, teamScores: consensusTeamScores(speakerScores, entry.ranks || {}, teamIds, rules) };
}

export interface BallotDifference {
  field: string;
  first: string;
  second: string;
}

function describeScores(entries: SpeakerScoreEntry[] | undefined): Map<number, string> {
  return new Map(
    (entries || []).map((entry) => [
      entry.position,
      `${entry.speakerName || entry.speakerId}${entry.ghost ? " (ghost)" : ""}: ${entry.score}`,
    ])
  );
}

function diffScoreSets(
  first: SideRecord<SpeakerScoreEntry[]>,
  second: SideRecord<SpeakerScoreEntry[]>,
  sides: DebateSide[],
  label: string
): BallotDifference[] {
  const differences: BallotDifference[] = [];
  for (const side of sides) {
    const a = describeScores(first[side]);
    const b = describeScores(second[side]);
    const positions = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);
    for (const position of positions) {
      if (a.get(position) !== b.get(position)) {
        differences.push({
          field: `${label}${side} speech ${position}`,
          first: a.get(position) || "—",
          second: b.get(position) || "—",
        });
      }
    }
  }
  return differences;
}

/** Field-by-field differences between two entries of the same ballot (for double-entry checks). */
export function diffBallots(
  first: Pick<BallotSubmission, "motionId" | "motionText" | "speakerScores" | "teamScores" | "sheets" | "vetoes" | "forfeitSide">,
  second: Pick<BallotSubmission, "motionId" | "motionText" | "speakerScores" | "teamScores" | "sheets" | "vetoes" | "forfeitSide">,
  format: TournamentFormat
): BallotDifference[] {
  const sides = ballotSides(format);
  const differences: BallotDifference[] = [];
  if ((first.motionId || "") !== (second.motionId || "")) {
    differences.push({
      field: "Motion",
      first: first.motionText || first.motionId || "—",
      second: second.motionText || second.motionId || "—",
    });
  }
  if ((first.forfeitSide || "") !== (second.forfeitSide || "")) {
    differences.push({ field: "Forfeit", first: first.forfeitSide || "None", second: second.forfeitSide || "None" });
  }
  for (const side of sides) {
    if ((first.vetoes?.[side] || "") !== (second.vetoes?.[side] || "")) {
      differences.push({ field: `${side} veto`, first: first.vetoes?.[side] || "None", second: second.vetoes?.[side] || "None" });
    }
    const a = first.teamScores?.[side];
    const b = second.teamScores?.[side];
    if ((a?.rank ?? 0) !== (b?.rank ?? 0)) {
      differences.push({
        field: `${side} result`,
        first: a ? `${format === "bp" ? `rank ${a.rank}` : a.win ? "win" : "loss"}` : "—",
        second: b ? `${format === "bp" ? `rank ${b.rank}` : b.win ? "win" : "loss"}` : "—",
      });
    }
  }
  if (first.sheets?.length || second.sheets?.length) {
    const ids = [...new Set([...(first.sheets || []), ...(second.sheets || [])].map((sheet) => sheet.adjudicatorId))];
    for (const id of ids) {
      const a = first.sheets?.find((sheet) => sheet.adjudicatorId === id);
      const b = second.sheets?.find((sheet) => sheet.adjudicatorId === id);
      const label = `${a?.adjudicatorName || b?.adjudicatorName || "Adjudicator"} — `;
      if (!a || !b) {
        differences.push({ field: `${label}scoresheet`, first: a ? "entered" : "missing", second: b ? "entered" : "missing" });
        continue;
      }
      differences.push(...diffScoreSets(a.speakerScores, b.speakerScores, sides, label));
    }
  } else {
    differences.push(...diffScoreSets(first.speakerScores || {}, second.speakerScores || {}, sides, ""));
  }
  return differences;
}
