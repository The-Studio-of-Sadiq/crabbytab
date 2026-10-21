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
  Tournament,
  TournamentFormat,
  TournamentPreferences,
} from "@/types";
import { validateReplyScore, validateSpeakerScore } from "@/lib/scoring/validator";
import { ballotSideAssignment, isSidePermutation, sidesChosenOnBallot } from "@/lib/draw/manualSides";
import {
  aggregateScoreValues,
  ballotsHaveSpeakerScores,
  cleanScore,
  criteriaForSpeech,
  maximumMarginFor,
  motionsEnabled,
  requireSubstantiveForReply,
  scoreAggregationFor,
  scoreCriteriaFor,
  speakerRanksFor,
  validateCriterionScore,
  weightedCriteriaScore,
  winnerDeclarationFor,
} from "@/lib/ballots/ballotRules";
import { sideLabel } from "@/lib/sideNames";
import {
  BP_SIDES as BP_SIDE_CODES,
  TWO_TEAM_SIDES as TWO_TEAM_SIDE_CODES,
  compareSides,
  debateSides,
  isPolyFormat,
  isTwoTeamFormat,
  sidesForFormat,
  teamsInDebateFor,
} from "@/lib/debateSides";

/**
 * Pure ballot logic shared by tab-room entry, the private portal and standings: how speeches are
 * totalled (ghosts, replies), how consensus and voting ballots turn into a result, forfeits,
 * validation and double-entry comparison.
 *
 * Poly debates (N teams per room, Tabbycat `teams_in_debate` other than 2 or 4) follow Tabbycat's
 * poly scoresheets: a scored consensus ballot ranks the teams by total (`PolyScoresheet`: totals may
 * not tie, points = teams in the room - rank, nobody "wins"); a consensus ballot without scores
 * declares the advancing teams (`PolyEliminationScoresheet`: two, one in the last round); a voting
 * ballot needs `marginIncludesDissenters` and records only scores (`PolyNoWinScoresheet`).
 */

export const BP_SIDES: DebateSide[] = [...BP_SIDE_CODES];
export const TWO_TEAM_SIDES: DebateSide[] = [...TWO_TEAM_SIDE_CODES];

export type SideRecord<T> = Partial<Record<DebateSide, T>>;

export interface BallotRules {
  format: TournamentFormat;
  preferences?: Partial<TournamentPreferences>;
  /** Stage of the round the ballot is for; elimination rounds may use their own ballot mode. Absent = preliminary. */
  stage?: RoundStage;
  /**
   * Poly only: the sides of the debate the ballot is for, when the room holds fewer teams than the
   * format's count (see lib/debateSides `debateSides`). Absent = a full room.
   */
  sides?: DebateSide[];
  /** Poly only: the ballot is for the tournament's last round, where one team advances instead of two. */
  lastRound?: boolean;
  /**
   * Poly only: one adjudicator's own scoresheet in a voting round (a private-URL ballot), which
   * records scores only (Tabbycat's PolyNoWinScoresheet: no ranks, so totals may tie).
   */
  polyScoresOnly?: boolean;
}

/**
 * Ballot rules for one debate: the tournament's format and settings, the round's stage and, for a
 * poly room, its own sides and whether it is the tournament's last round (`rounds` = every round).
 */
export function debateBallotRules(
  tournament: Pick<Tournament, "format"> & { preferences?: Partial<TournamentPreferences> },
  round: (Pick<Round, "stage"> & Partial<Pick<Round, "seq">>) | null | undefined,
  debate?: Pick<Debate, "teams"> | null,
  rounds?: readonly Pick<Round, "seq">[]
): BallotRules {
  const rules: BallotRules = {
    format: tournament.format,
    preferences: tournament.preferences,
    ...(round?.stage ? { stage: round.stage } : {}),
  };
  if (!isPolyFormat(tournament.format)) return rules;
  const lastSeq = Math.max(0, ...(rounds ?? []).map((item) => item.seq));
  return {
    ...rules,
    ...(debate ? { sides: debateSides(debate, tournament) } : {}),
    ...(round?.seq !== undefined && rounds && rounds.length > 0 && round.seq >= lastSeq ? { lastRound: true } : {}),
  };
}

/** Every side of a full room in `format`; poly needs the tournament's `teamsInDebate`. */
export function ballotSides(format: TournamentFormat, teamsInDebate?: number): DebateSide[] {
  return sidesForFormat(format, teamsInDebate);
}

/** The sides a ballot records: the debate's own sides for a poly room, else the format's. */
export function rulesSides(rules: Pick<BallotRules, "format" | "preferences" | "sides">): DebateSide[] {
  if (isPolyFormat(rules.format) && rules.sides && rules.sides.length > 0) return [...rules.sides].sort(compareSides);
  return sidesForFormat(rules.format, teamsInDebateFor(rules));
}

/**
 * Why ballots with these rules cannot be recorded for a poly debate, or "" when they can. As
 * Tabbycat's `get_result_class`, voting ballots for more or fewer than two teams need "margins
 * include dissenters" (no winner is decided), and Tabbycat has no such form without speaker scores.
 */
export function polyBallotProblem(rules: BallotRules): string {
  if (!isPolyFormat(rules.format) || !usesVotingBallots(rules)) return "";
  if (!rules.preferences?.marginIncludesDissenters) {
    return "Voting ballots for debates without exactly two teams need \"margins include dissenters\" turned on; otherwise use consensus ballots.";
  }
  if (!usesSpeakerScores(rules)) {
    return "Voting ballots for debates without exactly two teams must ask for speaker scores; use consensus ballots for results-only rounds.";
  }
  return "";
}

/** Poly consensus ballots without scores: how many teams advance (Tabbycat: two, one in the last round). */
export function polyAdvancingCount(rules: Pick<BallotRules, "lastRound">): number {
  return rules.lastRound ? 1 : 2;
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
 * True when ballots for `rules.stage` ask for speaker scores (`speakersInBallots`). A ballot
 * without them records only the result: ranks (BP) or the winner (two-team).
 */
export function usesSpeakerScores(rules: BallotRules): boolean {
  return ballotsHaveSpeakerScores(rules.preferences, rules.stage);
}

/**
 * Tabbycat's `allow_self_split_ballots` (Karl Popper rules): a solo adjudicator may declare their
 * decision a 2:1 split. Like Tabbycat it applies only to a two-team voting ballot (`per-adj`) of a
 * debate with exactly one voting adjudicator, since only voting ballots record votes.
 */
export function selfSplitAllowed(rules: BallotRules, votingAdjudicatorCount: number): boolean {
  return isTwoTeamFormat(rules.format) &&
    rules.preferences?.allowSelfSplitBallots === true &&
    usesVotingBallots(rules) &&
    votingAdjudicatorCount === 1;
}

/** Votes recorded for a self-split ballot (Tabbycat `teamscore_field_votes_given/possible`). */
export const SELF_SPLIT_VOTES = { winner: 2, loser: 1 } as const;

/**
 * The votes a voting ballot's panel could give: one per scoresheet, or 3 for a self-split ballot
 * (its single sheet counts as a 2:1 panel). Falls back to the votes recorded when there are no sheets.
 */
export function ballotVotesPossible(ballot: Pick<BallotSubmission, "sheets" | "teamScores" | "selfSplit">): number {
  const recorded = Object.values(ballot.teamScores || {}).reduce((sum, score) => sum + (score?.votes ?? 0), 0);
  if (ballot.selfSplit === true) return recorded;
  return ballot.sheets?.length || recorded;
}

/**
 * With score criteria, each speech's score is the weighted sum of its criterion scores; criteria
 * that do not apply to the speech are dropped. Without criteria the entries are returned as they are.
 */
export function applyScoreCriteria(entries: SpeakerScoreEntry[], rules: BallotRules): SpeakerScoreEntry[] {
  const criteria = scoreCriteriaFor(rules.preferences);
  if (criteria.length === 0) return entries;
  return entries.map((entry) => {
    const applicable = criteriaForSpeech(criteria, isReplyEntry(entry, rules));
    const values = Object.fromEntries(
      applicable
        .filter((criterion) => typeof entry.criteria?.[criterion.id] === "number")
        .map((criterion) => [criterion.id, entry.criteria![criterion.id]])
    );
    return { ...entry, criteria: values, score: weightedCriteriaScore(applicable, values) };
  });
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

/** BP: 3/2/1/0; poly: teams in the room - rank (Tabbycat `len(sides) - rank`); two-team: 1 for the win. */
function pointsForRank(rank: number, rules: BallotRules, sideCount: number): number {
  if (rules.format === "bp") return BP_SIDES.length - rank;
  if (isPolyFormat(rules.format)) return sideCount - rank;
  return rank === 1 ? 1 : 0;
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
  const sides = rulesSides(rules);
  const scored = usesSpeakerScores(rules);
  const poly = isPolyFormat(rules.format);
  const totals = Object.fromEntries(
    sides.map((side) => [side, scored ? teamSpeakerTotal(speakerScores[side] || [], rules) : 0])
  ) as Record<DebateSide, number>;
  const result = {} as Record<DebateSide, TeamScoreEntry>;
  for (const side of sides) {
    const rank = ranks[side] ?? sides.indexOf(side) + 1;
    const points = pointsForRank(rank, rules, sides.length);
    const opponent = sides.find((candidate) => candidate !== side);
    result[side] = {
      side,
      teamId: teamIds[side] || "",
      points,
      totalSpeakerScore: totals[side],
      rank,
      // Tabbycat's PolyScoresheet has no winners: poly teams are ranked, never "win".
      win: poly ? false : rules.format === "bp" ? points >= 2 : rank === 1,
      // A results-only ballot has no margin (Tabbycat stores none), not a margin of 0.
      ...(!isTwoTeamFormat(rules.format) || !opponent || !scored ? {} : { margin: cleanScore(totals[side] - totals[opponent]) }),
    };
  }
  return result;
}

/** One adjudicator's poly scoresheet in a voting round (`polyScoresOnly`): totals only, no ranks or points. */
function polyScoresOnlyTeamScores(
  speakerScores: SideRecord<SpeakerScoreEntry[]>,
  teamIds: SideRecord<string>,
  rules: BallotRules
): Record<DebateSide, TeamScoreEntry> {
  const result = {} as Record<DebateSide, TeamScoreEntry>;
  for (const side of rulesSides(rules)) {
    result[side] = {
      side,
      teamId: teamIds[side] || "",
      points: 0,
      totalSpeakerScore: teamSpeakerTotal(speakerScores[side] || [], rules),
    };
  }
  return result;
}

/**
 * A poly consensus ballot without speaker scores (Tabbycat's PolyEliminationScoresheet): the declared
 * advancing teams win; no team gets points or a rank (Tabbycat stores none; CrabbyTab stores 0 points).
 */
export function polyAdvancingTeamScores(
  winners: DebateSide[],
  teamIds: SideRecord<string>,
  rules: BallotRules
): Record<DebateSide, TeamScoreEntry> {
  const chosen = new Set(winners);
  const result = {} as Record<DebateSide, TeamScoreEntry>;
  for (const side of rulesSides(rules)) {
    result[side] = { side, teamId: teamIds[side] || "", points: 0, totalSpeakerScore: 0, win: chosen.has(side) };
  }
  return result;
}

/**
 * A poly voting ballot (Tabbycat's DebateResultByAdjudicatorWithScores with PolyNoWinScoresheet,
 * which needs `marginIncludesDissenters`): every sheet counts, each speech's score is the panel's
 * mean or median (criteria aggregated separately), and each team's total is the mean of the sheets'
 * own totals. No team wins, is ranked or gets points (Tabbycat stores none; CrabbyTab stores 0 points).
 */
export function aggregatePolyVotingSheets(
  sheets: AdjudicatorSheet[],
  teamIds: SideRecord<string>,
  rules: BallotRules
): Pick<VotingResult, "speakerScores" | "teamScores"> {
  if (sheets.length === 0) throw new Error("A voting ballot needs at least one adjudicator's scoresheet.");
  const sides = rulesSides(rules);
  const speakerScores = aggregateSheetSpeeches(sheets, sides, rules);
  const mean = (values: number[]) => cleanScore(values.reduce((sum, value) => sum + value, 0) / values.length);
  const teamScores = {} as Record<DebateSide, TeamScoreEntry>;
  for (const side of sides) {
    teamScores[side] = {
      side,
      teamId: teamIds[side] || "",
      points: 0,
      totalSpeakerScore: mean(sheets.map((sheet) => teamSpeakerTotal(sheet.speakerScores?.[side] || [], rules))),
    };
  }
  return { speakerScores, teamScores };
}

/** Each speech's score combined over `sheets` (mean or median; criteria aggregated one by one). */
function aggregateSheetSpeeches(
  sheets: AdjudicatorSheet[],
  sides: DebateSide[],
  rules: BallotRules
): Record<DebateSide, SpeakerScoreEntry[]> {
  const aggregation = scoreAggregationFor(rules.preferences);
  const criteria = scoreCriteriaFor(rules.preferences);
  const speakerScores = {} as Record<DebateSide, SpeakerScoreEntry[]>;
  for (const side of sides) {
    const template = sheets[0]?.speakerScores?.[side] || [];
    speakerScores[side] = template.map((entry, index) => {
      const pool = sheets.map((sheet) => sheet.speakerScores?.[side]?.[index]);
      const { rank: _rank, criteria: _criteria, ...rest } = entry;
      const applicable = criteriaForSpeech(criteria, isReplyEntry(entry, rules));
      if (applicable.length > 0) {
        const values = Object.fromEntries(
          applicable.map((criterion) => [
            criterion.id,
            aggregateScoreValues(pool.map((speech) => speech?.criteria?.[criterion.id] ?? 0), aggregation),
          ])
        );
        return { ...rest, criteria: values, score: weightedCriteriaScore(applicable, values) };
      }
      return { ...rest, score: aggregateScoreValues(pool.map((speech) => speech?.score ?? 0), aggregation) };
    });
  }
  return speakerScores;
}

export interface SheetOutcome {
  totals: Record<DebateSide, number>;
  /** Undefined when the sheet's totals are tied. */
  winner?: DebateSide;
}

/**
 * One scoresheet's totals and the side it votes for, following `winnersInBallots` as Tabbycat's
 * scoresheet classes do: "none" and "high-points" vote for the higher total (a tie has no winner;
 * "high-points" also checks the declared winner, in validation); "tied-points" votes for the
 * declared winner if its total is not lower; "low-points" votes for the declared winner. A
 * scoresheet without speaker scores votes for its declared winner.
 */
export function sheetOutcome(
  sheet: Pick<AdjudicatorSheet, "speakerScores"> & Partial<Pick<AdjudicatorSheet, "declaredWinner">>,
  rules: BallotRules
): SheetOutcome {
  const [first, second] = TWO_TEAM_SIDES;
  const declared = sheet.declaredWinner && TWO_TEAM_SIDES.includes(sheet.declaredWinner) ? sheet.declaredWinner : undefined;
  if (!usesSpeakerScores(rules)) {
    return { totals: { [first]: 0, [second]: 0 } as Record<DebateSide, number>, winner: declared };
  }
  const totals = {
    [first]: teamSpeakerTotal(sheet.speakerScores?.[first] || [], rules),
    [second]: teamSpeakerTotal(sheet.speakerScores?.[second] || [], rules),
  } as Record<DebateSide, number>;
  const byTotals = totals[first] === totals[second] ? undefined : totals[first] > totals[second] ? first : second;
  const mode = winnerDeclarationFor(rules.preferences);
  let winner: DebateSide | undefined = byTotals;
  if (mode === "low-points") winner = declared;
  if (mode === "tied-points") {
    const other = declared === first ? second : first;
    winner = declared && totals[declared] >= totals[other] ? declared : undefined;
  }
  return { totals, winner };
}

export interface VotingResult {
  speakerScores: Record<DebateSide, SpeakerScoreEntry[]>;
  teamScores: Record<DebateSide, TeamScoreEntry>;
  winner: DebateSide;
  votes: Record<DebateSide, number>;
  majorityAdjudicatorIds: string[];
  /** The single sheet was declared a 2:1 split, so the votes are 2 and 1. */
  selfSplit: boolean;
}

/**
 * Aggregates two-team voting sheets the way Tabbycat does (`DebateResultByAdjudicatorWithScores`):
 * each sheet votes (see `sheetOutcome`), the majority wins and the chair breaks a tied panel.
 * Speaker scores, team totals and the margin come from the "relevant" adjudicators: the majority,
 * or the whole panel when `marginIncludesDissenters` is on. Each speech's score is the mean or
 * median (`scoreAggregation`) of their scores; with score criteria each criterion is aggregated
 * separately and the speech score is their weighted sum (medians do not add up). Team totals and
 * margins are always the mean of the sheets' own totals, as in Tabbycat.
 *
 * `options.selfSplit` (checked by the caller with `selfSplitAllowed`) records a single sheet as a
 * 2:1 split: the winner gets 2 votes and the loser 1. Scores, winner and margin are unchanged.
 */
export function aggregateVotingSheets(
  sheets: AdjudicatorSheet[],
  chairId: string | undefined,
  teamIds: SideRecord<string>,
  rules: BallotRules,
  options: { selfSplit?: boolean } = {}
): VotingResult {
  if (sheets.length === 0) throw new Error("A voting ballot needs at least one adjudicator's scoresheet.");
  const selfSplit = options.selfSplit === true && sheets.length === 1;
  const outcomes = sheets.map((sheet) => sheetOutcome(sheet, rules));
  const votes = Object.fromEntries(
    TWO_TEAM_SIDES.map((side) => [side, outcomes.filter((outcome) => outcome.winner === side).length])
  ) as Record<DebateSide, number>;
  const [first, second] = TWO_TEAM_SIDES;
  let winner: DebateSide;
  if (votes[first] !== votes[second]) {
    winner = votes[first] > votes[second] ? first : second;
  } else {
    // Tabbycat awards a split panel to the chair's vote, and has no result at all until the chair's
    // sheet is in (DebateResultByAdjudicator.is_complete): never let another sheet decide.
    const chairIndex = sheets.findIndex((sheet) => sheet.adjudicatorId === chairId);
    if (chairIndex < 0) throw new Error("The panel is tied and the chair's scoresheet is missing, so the chair cannot give the casting vote.");
    const tieBreaker = outcomes[chairIndex].winner;
    if (!tieBreaker) throw new Error("The panel is tied and the chair's scoresheet has no winner.");
    winner = tieBreaker;
  }
  const majority = sheets.filter((_, index) => outcomes[index].winner === winner);
  const relevantIndexes = sheets
    .map((_, index) => index)
    .filter((index) => rules.preferences?.marginIncludesDissenters || outcomes[index].winner === winner);
  const relevant = relevantIndexes.map((index) => sheets[index]);
  const relevantOutcomes = relevantIndexes.map((index) => outcomes[index]);
  const scored = usesSpeakerScores(rules);
  const speakerScores = scored
    ? aggregateSheetSpeeches(relevant, TWO_TEAM_SIDES, rules)
    : (Object.fromEntries(TWO_TEAM_SIDES.map((side) => [side, []])) as unknown as Record<DebateSide, SpeakerScoreEntry[]>);

  const loser = winner === first ? second : first;
  if (selfSplit) {
    votes[winner] = SELF_SPLIT_VOTES.winner;
    votes[loser] = SELF_SPLIT_VOTES.loser;
  }
  const mean =(values: number[]) => cleanScore(values.reduce((sum, value) => sum + value, 0) / values.length);
  const margin = mean(relevantOutcomes.map((outcome) => outcome.totals[winner] - outcome.totals[loser]));
  const teamScores = {} as Record<DebateSide, TeamScoreEntry>;
  for (const side of TWO_TEAM_SIDES) {
    const won = side === winner;
    teamScores[side] = {
      side,
      teamId: teamIds[side] || "",
      points: won ? 1 : 0,
      // The mean of the relevant sheets' own totals: exact, unlike a sum of averaged speeches.
      totalSpeakerScore: scored ? mean(relevantOutcomes.map((outcome) => outcome.totals[side])) : 0,
      rank: won ? 1 : 2,
      win: won,
      ...(scored ? { margin: won ? margin : -margin } : {}),
      votes: votes[side],
    };
  }
  return {
    speakerScores,
    teamScores,
    winner,
    votes,
    majorityAdjudicatorIds: majority.map((sheet) => sheet.adjudicatorId),
    selfSplit,
  };
}

/** A forfeit: the other team wins, and neither team is credited with speaker scores. */
export function forfeitTeamScores(
  forfeitSide: DebateSide,
  teamIds: SideRecord<string>,
  rules: BallotRules
): Record<DebateSide, TeamScoreEntry> {
  if (!isTwoTeamFormat(rules.format)) throw new Error("Forfeits are only supported in two-team formats.");
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
  /** Ranked motion preferences per side, most preferred first (see lib/motions/preferences). */
  motionPreferences?: SideRecord<string[]>;
  /** A solo adjudicator's decision declared a 2:1 split (see `selfSplitAllowed`). */
  selfSplit?: boolean;
  /** Poly consensus ballots without speaker scores: the advancing teams (see `polyAdvancingCount`). */
  winners?: DebateSide[];
}

export interface BallotValidationContext extends BallotRules {
  rosters: SideRecord<Speaker[]>;
  /** Motions available in this round; empty means motions are not tracked per round. */
  roundMotionIds?: string[];
  /** Voting adjudicators on the debate's panel, for self-split checks. Absent = the number of sheets entered. */
  votingAdjudicatorCount?: number;
}

function formatTotal(value: number): string {
  return String(cleanScore(value));
}

/** Speeches with their criteria applied, so scores are the weighted sums the totals use. */
function scoredSpeeches(speakerScores: SideRecord<SpeakerScoreEntry[]>, rules: BallotRules): SideRecord<SpeakerScoreEntry[]> {
  return Object.fromEntries(
    rulesSides(rules).map((side) => [side, applyScoreCriteria(speakerScores[side] || [], rules)])
  ) as SideRecord<SpeakerScoreEntry[]>;
}

function validateSpeechScore(entry: SpeakerScoreEntry, reply: boolean, context: BallotValidationContext): string[] {
  const criteria = criteriaForSpeech(scoreCriteriaFor(context.preferences), reply);
  if (criteria.length > 0) {
    // With criteria the speech score is derived, so only the criterion scores are checked (Tabbycat).
    return criteria
      .map((criterion) => validateCriterionScore(criterion, entry.criteria?.[criterion.id]))
      .filter(Boolean);
  }
  const check = reply ? validateReplyScore(entry.score, context.preferences) : validateSpeakerScore(entry.score, context.preferences);
  return check.valid ? [] : [check.error || "The score is invalid."];
}

function validateSheetScores(
  speakerScores: SideRecord<SpeakerScoreEntry[]>,
  context: BallotValidationContext,
  label: string
): string[] {
  const errors: string[] = [];
  const substantive = substantiveSpeakerCount(context);
  const replies = replySpeechesEnabled(context);
  for (const side of rulesSides(context)) {
    const entries = speakerScores[side] || [];
    const roster = new Set((context.rosters[side] || []).map((speaker) => speaker.id));
    const prefix = `${label}${sideLabel(side, context.preferences)}`;
    const speeches = entries.filter((entry) => !isReplyEntry(entry, context));
    const positions = speeches.map((entry) => entry.position).sort((a, b) => a - b);
    if (speeches.length !== substantive || positions.some((position, index) => position !== index + 1)) {
      errors.push(`${prefix}: enter exactly ${substantive} substantive speeches in order.`);
    }
    for (const entry of speeches) {
      if (!roster.has(entry.speakerId)) errors.push(`${prefix} speaker ${entry.position}: choose a speaker from the team.`);
      for (const error of validateSpeechScore(entry, false, context)) errors.push(`${prefix} speaker ${entry.position}: ${error}`);
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
        for (const error of validateSpeechScore(reply, true, context)) errors.push(`${prefix} reply: ${error}`);
        // Tabbycat: the last substantive speaker never replies; with require_substantive_for_reply
        // (the default) the reply speaker must also have given a counted substantive speech.
        const lastSpeaker = speeches.find((entry) => entry.position === substantive)?.speakerId;
        const gaveSpeech = speeches.some((entry) => entry.speakerId === reply.speakerId && !entry.ghost);
        if (requireSubstantiveForReply(context.preferences)) {
          if (!gaveSpeech || reply.speakerId === lastSpeaker) {
            errors.push(`${prefix} reply: the reply must be given by one of the first ${substantive - 1} speakers.`);
          }
        } else if (!roster.has(reply.speakerId)) {
          errors.push(`${prefix} reply: choose a speaker from the team.`);
        } else if (reply.speakerId === lastSpeaker) {
          errors.push(`${prefix} reply: the last substantive speaker cannot also give the reply.`);
        }
      }
    } else if (replyEntries.length > 0) {
      errors.push(`${prefix}: reply speeches are not enabled for this tournament.`);
    }
  }
  return errors;
}

/**
 * Speech ranks (`speaker_ranks`), as Tabbycat's SingleBallotSetForm: every substantive speech in
 * the debate gets a different rank from 1 to the number of speeches; with "high-points" a higher
 * score may never be ranked below a lower one (equal scores may be ranked either way). Reply
 * speeches are not ranked: Tabbycat asks for a rank on them too but never uses it.
 */
function validateSpeechRanks(speakerScores: SideRecord<SpeakerScoreEntry[]>, context: BallotValidationContext): string[] {
  const mode = speakerRanksFor(context.preferences);
  if (mode === "none") return [];
  const errors: string[] = [];
  const speeches = rulesSides(context).flatMap((side) =>
    (speakerScores[side] || [])
      .filter((entry) => !isReplyEntry(entry, context))
      .map((entry) => ({ side, entry }))
  );
  const count = speeches.length;
  const seen = new Set<number>();
  let complete = true;
  for (const { side, entry } of speeches) {
    const rank = entry.rank;
    const where = `${sideLabel(side, context.preferences)} speaker ${entry.position}`;
    if (rank === undefined || rank === null) {
      errors.push(`${where}: enter a speech rank.`);
      complete = false;
    } else if (!Number.isInteger(rank) || rank < 1 || rank > count) {
      errors.push(`${where}: the speech rank must be a whole number from 1 to ${count}.`);
      complete = false;
    } else {
      seen.add(rank);
    }
  }
  if (complete && seen.size < count) errors.push("Speech ranks cannot be tied: give every speech a different rank.");
  if (complete && mode === "high-points") {
    const inverted = speeches.some((a) =>
      speeches.some((b) => a.entry.score > b.entry.score && (a.entry.rank as number) > (b.entry.rank as number))
    );
    if (inverted) errors.push("Speech ranks must follow the speaker scores: a higher score cannot be ranked below a lower one.");
  }
  return errors;
}

function validateMargin(totals: Record<DebateSide, number>, context: BallotValidationContext, label: string): string[] {
  const maximum = maximumMarginFor(context.preferences);
  if (!maximum || !isTwoTeamFormat(context.format)) return [];
  const [first, second] = TWO_TEAM_SIDES;
  const margin = Math.abs(totals[first] - totals[second]);
  return margin > maximum
    ? [`${label}the margin (${formatTotal(margin)}) exceeds the maximum allowed margin (${maximum}).`]
    : [];
}

/**
 * Checks one scoresheet's winner against its totals (`winners_in_ballots`, two-team formats).
 * Messages name the sides and totals, which Tabbycat's do not.
 */
function validateDeclaredWinner(
  totals: Record<DebateSide, number>,
  winner: DebateSide | undefined,
  context: BallotValidationContext,
  label: string
): string[] {
  const mode = winnerDeclarationFor(context.preferences);
  const [first, second] = TWO_TEAM_SIDES;
  const name = (side: DebateSide) => sideLabel(side, context.preferences);
  const totalsText = `${name(first)} ${formatTotal(totals[first])}, ${name(second)} ${formatTotal(totals[second])}`;
  if (!winner) {
    if (mode === "none" && totals[first] === totals[second]) {
      return [`${label}team totals are tied (${totalsText}); adjust the scores so the winner has the higher total.`];
    }
    return [`${label}choose the winning team.`];
  }
  const loser = winner === first ? second : first;
  if ((mode === "none" || mode === "high-points") && totals[winner] === totals[loser]) {
    return [`${label}team totals are tied (${totalsText}); a debate cannot be drawn.`];
  }
  if ((mode === "none" || mode === "high-points" || mode === "tied-points") && totals[winner] < totals[loser]) {
    return [
      `${label}${name(winner)} is declared the winner with a lower total (${totalsText}). Low-point wins are not allowed.`,
    ];
  }
  return [];
}

/**
 * BP ranks against totals: with "low-points" ranks override the scores (a CrabbyTab extension;
 * Tabbycat ranks BP teams by total only). "tied-points" lets the ranks order teams with equal
 * totals. Otherwise, as Tabbycat, totals may not tie and ranks must follow them.
 */
function validateBpRanks(
  ranks: SideRecord<number>,
  totals: Record<DebateSide, number>,
  context: BallotValidationContext
): string[] {
  // Poly ranks always follow the totals (Tabbycat's PolyScoresheet has no declared winners).
  const mode = isPolyFormat(context.format) ? "none" : winnerDeclarationFor(context.preferences);
  const sides = rulesSides(context);
  if (mode === "low-points") return [];
  const errors: string[] = [];
  const name = (side: DebateSide) => sideLabel(side, context.preferences);
  for (const higher of sides) {
    for (const lower of sides) {
      if ((ranks[higher] as number) < (ranks[lower] as number) && totals[higher] < totals[lower]) {
        errors.push(
          `${name(higher)} is ranked above ${name(lower)} with a lower total ` +
          `(${formatTotal(totals[higher])} vs ${formatTotal(totals[lower])}). Low-point wins are not allowed.`
        );
      }
    }
  }
  if (mode !== "tied-points") {
    const byTotal = new Map<number, DebateSide[]>();
    for (const side of sides) byTotal.set(totals[side], [...(byTotal.get(totals[side]) || []), side]);
    for (const [total, tied] of byTotal) {
      if (tied.length > 1) errors.push(`${tied.map(name).join(" and ")} have the same total (${formatTotal(total)}); team totals cannot tie.`);
    }
  }
  return errors;
}

/**
 * With `winnersInBallots` "none" a consensus ballot's result is read from the totals (Tabbycat's
 * HighPointWinsRequiredScoresheet and PolyScoresheet): ranks follow the totals, highest first.
 * Tied totals keep side order here; validation then rejects the tie. Otherwise the entered ranks
 * stand. `speakerScores` must already have score criteria applied.
 */
export function effectiveRanks(
  speakerScores: SideRecord<SpeakerScoreEntry[]>,
  ranks: SideRecord<number> | undefined,
  rules: BallotRules
): SideRecord<number> {
  if (!usesSpeakerScores(rules)) return ranks || {};
  // Poly ranks are always read from the totals (Tabbycat's PolyScoresheet); BP and two-team
  // ballots keep their entered ranks when winners are declared.
  if (!isPolyFormat(rules.format) && winnerDeclarationFor(rules.preferences) !== "none") return ranks || {};
  const sides = rulesSides(rules);
  const totals = new Map(sides.map((side) => [side, teamSpeakerTotal(speakerScores[side] || [], rules)]));
  const ordered = [...sides].sort((a, b) => (totals.get(b) as number) - (totals.get(a) as number));
  return Object.fromEntries(ordered.map((side, index) => [side, index + 1]));
}

function speakerOrder(scores: SideRecord<SpeakerScoreEntry[]>, sides: DebateSide[]): string {
  return sides.map((side) =>
    (scores[side] || []).map((entry) => `${entry.position}:${entry.speakerId}`).join(",")
  ).join("|");
}

/** Every problem with a ballot entry, as sentences; empty when it can be saved. */
export function validateBallotEntry(entry: BallotEntry, context: BallotValidationContext): string[] {
  return collectBallotErrors(entry, context).map((error) => error.charAt(0).toUpperCase() + error.slice(1));
}

function collectBallotErrors(entry: BallotEntry, context: BallotValidationContext): string[] {
  const errors: string[] = [];
  const sides = rulesSides(context);
  const poly = isPolyFormat(context.format);
  const motionIds = context.roundMotionIds || [];
  const name = (side: DebateSide | string) => sideLabel(side, context.preferences);

  if (motionsEnabled(context.preferences)) {
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
      if (motionIds.length > 0 && !motionIds.includes(motionId)) errors.push(`${name(side)} vetoed a motion from another round.`);
      if (motionId === entry.motionId) errors.push(`${name(side)} cannot veto the motion that was debated.`);
    }
  }

  if (entry.forfeitSide) {
    if (!isTwoTeamFormat(context.format) || !context.preferences?.enableForfeits) {
      errors.push("Forfeits are not enabled for this tournament.");
    } else if (!sides.includes(entry.forfeitSide)) {
      errors.push("Choose which team forfeited.");
    }
    return errors;
  }

  const scored = usesSpeakerScores(context);
  const polyProblem = polyBallotProblem(context);
  if (polyProblem) return [...errors, polyProblem];

  if (entry.selfSplit === true) {
    const panelSize = context.votingAdjudicatorCount ?? (entry.sheets || []).length;
    if (!selfSplitAllowed(context, panelSize)) {
      errors.push("A split decision can only be declared by a solo adjudicator, when self-split ballots are allowed.");
    }
  }

  if (usesVotingBallots(context)) {
    const sheets = (entry.sheets || []).map((sheet) => ({
      ...sheet,
      speakerScores: scored ? scoredSpeeches(sheet.speakerScores || {}, context) : sheet.speakerScores,
    })) as AdjudicatorSheet[];
    if (sheets.length === 0) errors.push("Enter at least one adjudicator's scoresheet.");
    const adjudicatorIds = new Set<string>();
    const declares = winnerDeclarationFor(context.preferences) !== "none" || !scored;
    for (const sheet of sheets) {
      const label = `${sheet.adjudicatorName || "Adjudicator"} — `;
      if (adjudicatorIds.has(sheet.adjudicatorId)) errors.push(`${label}has more than one scoresheet.`);
      adjudicatorIds.add(sheet.adjudicatorId);
      if (poly) {
        // Poly voting sheets record scores only (Tabbycat's PolyNoWinScoresheet).
        errors.push(...validateSheetScores(sheet.speakerScores, context, label));
        continue;
      }
      if (!scored) {
        if (!sheet.declaredWinner || !sides.includes(sheet.declaredWinner)) errors.push(`${label}choose the winning team.`);
        continue;
      }
      errors.push(...validateSheetScores(sheet.speakerScores, context, label));
      const outcome = sheetOutcome(sheet, context);
      const winner = declares ? sheet.declaredWinner : outcome.winner;
      if (declares && !winner) {
        errors.push(`${label}choose the winning team.`);
      } else {
        errors.push(...validateDeclaredWinner(outcome.totals, winner, context, label));
      }
      errors.push(...validateMargin(outcome.totals, context, label));
    }
    if (scored) {
      const orders = new Set(sheets.map((sheet) => speakerOrder(sheet.speakerScores, sides)));
      if (orders.size > 1) errors.push("Every scoresheet must list the same speakers in the same order.");
    }
    return errors;
  }

  if (poly && !scored) {
    // Tabbycat's PolyEliminationScoresheet: exactly two advancing teams, one in the last round.
    const needed = polyAdvancingCount(context);
    const winners = [...new Set(entry.winners || [])];
    if (winners.some((side) => !sides.includes(side))) errors.push("An advancing team is not in this debate.");
    if (sides.length < needed) {
      errors.push(`This debate has ${sides.length} team${sides.length === 1 ? "" : "s"}, but ${needed} must advance.`);
    } else if (winners.length !== needed) {
      errors.push(needed === 1 ? "Choose the team that advances." : `Choose the ${needed} teams that advance.`);
    }
    return errors;
  }

  const speakerScores = scored ? scoredSpeeches(entry.speakerScores, context) : {};
  if (scored) errors.push(...validateSheetScores(speakerScores, context, ""));
  if (poly && context.polyScoresOnly && scored) {
    errors.push(...validateSpeechRanks(speakerScores, context));
    return errors;
  }
  const ranks = effectiveRanks(speakerScores, entry.ranks, context);
  const rankValues = sides.map((side) => ranks[side]);
  if (rankValues.some((rank) => !Number.isInteger(rank)) || new Set(rankValues).size !== sides.length) {
    errors.push(context.format === "bp"
      ? "Give each team a different rank from 1st to 4th."
      : poly
        ? `Give each team a different rank from 1 to ${sides.length}.`
        : "One team must win and the other must lose.");
  } else if (scored) {
    const totals = Object.fromEntries(
      sides.map((side) => [side, teamSpeakerTotal(speakerScores[side] || [], context)])
    ) as Record<DebateSide, number>;
    if (!isTwoTeamFormat(context.format)) {
      errors.push(...validateBpRanks(ranks, totals, context));
    } else {
      const winner = sides.find((side) => ranks[side] === 1);
      errors.push(...validateDeclaredWinner(totals, winner, context, ""));
      errors.push(...validateMargin(totals, context, ""));
    }
  }
  if (scored) errors.push(...validateSpeechRanks(speakerScores, context));
  return errors;
}

/* -------------------------------------------------------------------------- */
/* Assembling and comparing ballots                                           */
/* -------------------------------------------------------------------------- */

export interface BallotResult {
  speakerScores: Record<DebateSide, SpeakerScoreEntry[]>;
  teamScores: Record<DebateSide, TeamScoreEntry>;
  sheets?: AdjudicatorSheet[];
  /** Set for a results-only ballot (no speaker scores); store it on the BallotSubmission. */
  noSpeakerScores?: boolean;
  /** Set for a self-split voting ballot; store it on the BallotSubmission. */
  selfSplit?: boolean;
}

function emptySides(sides: DebateSide[]): Record<DebateSide, SpeakerScoreEntry[]> {
  return Object.fromEntries(sides.map((side) => [side, []])) as unknown as Record<DebateSide, SpeakerScoreEntry[]>;
}

/** Speeches as stored: criteria applied, ghosts marked, and speech ranks only when ranks are in use. */
function storedSpeeches(entries: SpeakerScoreEntry[], rules: BallotRules, keepRanks: boolean): SpeakerScoreEntry[] {
  return markGhostSpeeches(applyScoreCriteria(entries, rules), rules).map((speech) => {
    if (keepRanks && !isReplyEntry(speech, rules)) return speech;
    const { rank: _rank, ...rest } = speech;
    return rest;
  });
}

/** Turns a validated entry into the scores stored on the ballot. */
export function buildBallotResult(
  entry: BallotEntry,
  teamIds: SideRecord<string>,
  chairId: string | undefined,
  rules: BallotRules
): BallotResult {
  const sides = rulesSides(rules);
  const polyProblem = polyBallotProblem(rules);
  if (polyProblem) throw new Error(polyProblem);
  if (entry.forfeitSide) {
    return {
      speakerScores: emptySides(sides),
      teamScores: forfeitTeamScores(entry.forfeitSide, teamIds, rules),
    };
  }
  const scored = usesSpeakerScores(rules);
  if (usesVotingBallots(rules)) {
    const sheets = (entry.sheets || []).map((sheet) => ({
      ...sheet,
      speakerScores: scored
        ? (Object.fromEntries(
            sides.map((side) => [side, storedSpeeches(sheet.speakerScores?.[side] || [], rules, false)])
          ) as Record<DebateSide, SpeakerScoreEntry[]>)
        : emptySides(sides),
    }));
    if (isPolyFormat(rules.format)) {
      const result = aggregatePolyVotingSheets(sheets, teamIds, rules);
      return { speakerScores: result.speakerScores, teamScores: result.teamScores, sheets };
    }
    // Validation checks the panel size; here a single sheet is all that can be checked.
    const selfSplit = entry.selfSplit === true && selfSplitAllowed(rules, sheets.length);
    const result = aggregateVotingSheets(sheets, chairId, teamIds, rules, { selfSplit });
    return {
      speakerScores: result.speakerScores,
      teamScores: result.teamScores,
      sheets,
      ...(scored ? {} : { noSpeakerScores: true }),
      ...(result.selfSplit ? { selfSplit: true } : {}),
    };
  }
  if (!scored) {
    return {
      speakerScores: emptySides(sides),
      teamScores: isPolyFormat(rules.format)
        ? polyAdvancingTeamScores(entry.winners || [], teamIds, rules)
        : consensusTeamScores({}, entry.ranks || {}, teamIds, rules),
      noSpeakerScores: true,
    };
  }
  const keepRanks = speakerRanksFor(rules.preferences) !== "none";
  const speakerScores = Object.fromEntries(
    sides.map((side) => [side, storedSpeeches(entry.speakerScores[side] || [], rules, keepRanks)])
  ) as Record<DebateSide, SpeakerScoreEntry[]>;
  if (isPolyFormat(rules.format) && rules.polyScoresOnly) {
    return { speakerScores, teamScores: polyScoresOnlyTeamScores(speakerScores, teamIds, rules) };
  }
  return { speakerScores, teamScores: consensusTeamScores(speakerScores, effectiveRanks(speakerScores, entry.ranks, rules), teamIds, rules) };
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
  first: Pick<BallotSubmission, "motionId" | "motionText" | "speakerScores" | "teamScores" | "sheets" | "vetoes" | "forfeitSide" | "selfSplit">,
  second: Pick<BallotSubmission, "motionId" | "motionText" | "speakerScores" | "teamScores" | "sheets" | "vetoes" | "forfeitSide" | "selfSplit">,
  format: TournamentFormat
): BallotDifference[] {
  // Poly rooms may hold fewer teams than the format's count, so compare the sides either ballot has.
  const sides = isPolyFormat(format)
    ? ([...new Set([...Object.keys(first.teamScores || {}), ...Object.keys(second.teamScores || {})])].sort(compareSides) as DebateSide[])
    : ballotSides(format);
  const describeResult = (score: TeamScoreEntry) =>
    format === "bp" || (isPolyFormat(format) && score.rank !== undefined)
      ? `rank ${score.rank}`
      : isPolyFormat(format)
        ? score.win ? "advances" : "eliminated"
        : score.win ? "win" : "loss";
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
  if ((first.selfSplit === true) !== (second.selfSplit === true)) {
    differences.push({ field: "Split decision", first: first.selfSplit ? "2:1 split" : "No", second: second.selfSplit ? "2:1 split" : "No" });
  }
  for (const side of sides) {
    if ((first.vetoes?.[side] || "") !== (second.vetoes?.[side] || "")) {
      differences.push({ field: `${side} veto`, first: first.vetoes?.[side] || "None", second: second.vetoes?.[side] || "None" });
    }
    const a = first.teamScores?.[side];
    const b = second.teamScores?.[side];
    if ((a?.rank ?? 0) !== (b?.rank ?? 0) || (isPolyFormat(format) && Boolean(a?.win) !== Boolean(b?.win))) {
      differences.push({
        field: `${side} result`,
        first: a ? describeResult(a) : "—",
        second: b ? describeResult(b) : "—",
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
