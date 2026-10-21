import { isDrawPubliclyReleased } from "@/lib/draw/drawStatus";
import type {
  Adjudicator,
  BallotSubmission,
  BreakCategory,
  Debate,
  DebateSide,
  FeedbackSubmission,
  Institution,
  Motion,
  Round,
  SpeakerCategory,
  SpeakerMetricId,
  SpeakerStandingRow,
  Team,
  TeamMetricId,
  TeamStandingRow,
  Tournament,
  TwoTeamSide,
  AdjudicatorTabShows,
} from "@/types";
import type { PublicSiteSettings } from "@/lib/publicFeatures";
import { calculateStandings } from "@/lib/standings/calculator";
import { resolveSpeakerExtra, resolveTeamExtra, resolveTeamPrecedence } from "@/lib/standings/precedence";
import { rankTeamSubset } from "@/lib/standings/subset";
import { resolveSpeakerCategoryIds, speakerRowsInCategory } from "@/lib/speakerCategories";
import { participantGender, participantRegion } from "@/lib/adjudicators/diversity";
import {
  adjudicatorScoreHistory,
  blendAdjudicatorScore,
  calculateFeedbackSummaries,
  isFeedbackCountedForScore,
  preFeedbackScore,
} from "@/lib/feedback/scores";
import { expectedFeedbackForDebate, unexpectedFeedback } from "@/lib/feedback/progress";
import { isFeedbackEnabledForRound } from "@/lib/feedback/questions";
import { feedbackPathsForRound } from "@/lib/feedback/paths";
import { isReplyEntry } from "@/lib/ballots/result";
import type { PublicNamer } from "@/lib/publicView/names";
import { buildPublicFormsDirectory, type PublicFormsDirectory } from "@/lib/publicForms";

/**
 * Public data computed at publish time from the raw records: tabs (so top-N limits are enforced on
 * the server, not just hidden in the page), the adjudicator tab, break metrics, side allocations,
 * veto counts, diversity breakdowns and feedback progress. Only aggregates and already-public names
 * leave the server; every block is absent unless its setting is on.
 */

export interface PublicTeamTabRow {
  rank: number;
  teamId: string;
  teamName: string;
  institutionCode?: string;
  points: number;
  wins?: number;
  totalSpeakerScore: number;
  averageSpeakerScore: number;
  /** Only the metrics chosen as "extra" columns. */
  metrics: Partial<Record<TeamMetricId, number>>;
}

export interface PublicSpeakerTabRow {
  rank: number;
  /** Anonymous speakers get an opaque id and no team, so their scores cannot be traced back. */
  speakerId: string;
  speakerName: string;
  anonymous?: true;
  teamId: string;
  teamName: string;
  totalScore: number;
  averageScore: number;
  speechesCount: number;
  ineligible?: boolean;
  metrics: Partial<Record<SpeakerMetricId, number>>;
}

export interface PublicTabs {
  /** Completed preliminary rounds the tabs cover. */
  roundCount: number;
  teamTab?: PublicTeamTabRow[];
  speakerTab?: PublicSpeakerTabRow[];
  repliesTab?: PublicSpeakerTabRow[];
  /** Per public speaker category (released with the speaker tab), the category's own limit applied. */
  speakerCategoryTabs?: Record<string, PublicSpeakerTabRow[]>;
  /**
   * Per break category: the category's teams ranked within the category (every team for a general
   * category), cut at the category's own public tab limit.
   */
  breakCategoryTabs?: Record<string, PublicTeamTabRow[]>;
  /** The limits applied (0 = none), so pages can say "top N". */
  limits: { team: number; speaker: number; replies: number; breakCategories?: Record<string, number> };
}

export interface PublicAdjudicatorTabRow {
  adjudicatorId: string;
  name: string;
  anonymous?: true;
  institutionName?: string;
  /** Pre-feedback (test) score: shown for "test" and "all". */
  baseScore?: number;
  /** Feedback-blended score: shown for "final" and "all". */
  finalScore?: number;
  /** "all" only: average feedback (feedback scale) per round, by round id. */
  roundScores?: Record<string, number>;
  feedbackCount?: number;
}

export interface PublicAdjudicatorTab {
  shows: AdjudicatorTabShows;
  rounds: Array<{ id: string; name: string; seq: number }>;
  rows: PublicAdjudicatorTabRow[];
}

export interface PublicSideAllocations {
  rounds: Array<{ id: string; name: string; seq: number }>;
  /** teamId -> roundId -> side. */
  teams: Record<string, Record<string, TwoTeamSide>>;
}

/** `label` null = not specified. */
export interface PublicDiversityCount {
  label: string | null;
  count: number;
}

export interface PublicDiversityAverage {
  label: string | null;
  count: number;
  average: number;
}

export interface PublicDiversity {
  speakers: { gender: PublicDiversityCount[]; region: PublicDiversityCount[]; categories: PublicDiversityCount[]; total: number };
  adjudicators: {
    gender: PublicDiversityCount[];
    region: PublicDiversityCount[];
    total: number;
    /** Gender make-up of groups (all, chairs, panellists, trainees, adjudication core). */
    roles: Array<{ role: "all" | "chair" | "panellist" | "trainee" | "core"; gender: PublicDiversityCount[] }>;
  };
  /** Average substantive speaker score by speaker gender (public speaker scores only). */
  speakerScores: PublicDiversityAverage[];
  /** Average feedback score received by adjudicator gender (counted feedback). */
  feedbackReceived: PublicDiversityAverage[];
  /** Average feedback score given to adjudicators, by the giving adjudicator's gender. */
  feedbackGiven: PublicDiversityAverage[];
}

export interface PublicFeedbackProgressRow {
  sourceType: "team" | "adjudicator";
  sourceId: string;
  name: string;
  expected: number;
  submitted: number;
  /**
   * Submissions no path expected (Tabbycat `show_unexpected_feedback`, shown with a question mark);
   * present only when the setting is on and there are some.
   */
  unexpected?: number;
}

export interface PublicDerived {
  breakMetrics?: { metricIds: TeamMetricId[]; teams: Record<string, Partial<Record<TeamMetricId, number>>> };
  adjudicatorTab?: PublicAdjudicatorTab;
  sideAllocations?: PublicSideAllocations;
  /** motionId -> side -> vetoes. */
  vetoes?: Record<string, Partial<Record<DebateSide, number>>>;
  diversity?: PublicDiversity;
  feedbackProgress?: { roundIds: string[]; rows: PublicFeedbackProgressRow[] };
  /** Pickers of the public ballot / feedback forms (src/lib/publicForms.ts); absent when both are off. */
  publicForms?: PublicFormsDirectory;
}

export interface DerivedInput {
  tournament: Pick<Tournament, "id" | "format" | "preferences">;
  settings: PublicSiteSettings;
  release: { teamTab: boolean; speakerTab: boolean; repliesTab: boolean; breakCategoryIds: Set<string>; adjudicatorCore: boolean };
  rounds: Round[];
  teams: Team[];
  adjudicators: Adjudicator[];
  debates: Debate[];
  ballots: BallotSubmission[];
  motions: Motion[];
  institutions: Institution[];
  breakCategories: BreakCategory[];
  feedback: FeedbackSubmission[];
  namer: PublicNamer;
  /** Rounds whose speaker scores are public (results and team speaks released). */
  speakerScoreRoundIds: Set<string>;
  /** Rounds whose results are public (motion statistics use the same set). */
  resultRoundIds: Set<string>;
  /** Rounds whose panels are public. */
  revealedRoundIds: Set<string>;
  visibleMotionIds: Set<string>;
  publicTeamIds: Set<string>;
  publicAdjudicatorIds: Set<string>;
}

function confirmedBallots(ballots: BallotSubmission[]): BallotSubmission[] {
  return ballots.filter((ballot) => ballot.confirmed === true && ballot.discarded !== true);
}

function isCompletedPrelim(round: Round): boolean {
  return round.stage === "preliminary" && round.cancelled !== true && round.completed === true;
}

function pickMetrics<T extends string>(metrics: Partial<Record<T, number>> | undefined, ids: T[]): Partial<Record<T, number>> {
  return Object.fromEntries(ids.filter((id) => typeof metrics?.[id] === "number").map((id) => [id, metrics![id]])) as Partial<Record<T, number>>;
}

/** Rows ranked at or above `limit` (ties at the cutoff are kept); 0 = all rows. */
function withinLimit<T extends { rank: number; ineligible?: boolean }>(rows: T[], limit: number): T[] {
  return limit > 0 ? rows.filter((row) => !row.ineligible && row.rank > 0 && row.rank <= limit) : rows;
}

/** A break category's public tab limit; absent, invalid or 0 = none. */
function categoryLimit(category: BreakCategory): number {
  return Number.isInteger(category.limit) && (category.limit ?? 0) > 0 ? category.limit! : 0;
}

/**
 * Teams in a break category's team tab (Tabbycat: the category's team_set). A general category
 * holds every team unless the tab director marked it ineligible; any other category holds the
 * teams marked eligible for it.
 */
function inBreakCategory(category: BreakCategory, team: Team | undefined): boolean {
  if (!team) return false;
  if (category.isGeneral) return category.teamOverrides?.[team.id] !== "ineligible";
  return Boolean(team.breakCategories?.includes(category.id));
}

function computeStandings(input: DerivedInput) {
  const tabRounds = input.rounds.filter(isCompletedPrelim);
  const tabRoundIds = new Set(tabRounds.map((round) => round.id));
  const standings = calculateStandings(
    input.tournament as Tournament,
    tabRounds,
    input.teams,
    input.debates.filter((debate) => tabRoundIds.has(debate.roundId)),
    confirmedBallots(input.ballots).filter((ballot) => tabRoundIds.has(ballot.roundId))
  );
  return { standings, roundCount: tabRounds.length };
}

export function buildPublicTabs(input: DerivedInput, computed = computeStandings(input)): PublicTabs | undefined {
  const { settings, release, namer } = input;
  const wantsCategoryTabs = settings.breakCategoryTabs;
  if (!release.teamTab && !release.speakerTab && !release.repliesTab && !wantsCategoryTabs) return undefined;
  const { standings, roundCount } = computed;
  const preferences = input.tournament.preferences;
  const teamExtra = resolveTeamExtra(preferences);
  const speakerExtra = resolveSpeakerExtra(preferences);
  const teamRow = (row: TeamStandingRow): PublicTeamTabRow => ({
    rank: row.rank,
    teamId: row.teamId,
    teamName: namer.team(row.teamId, row.teamName),
    ...(settings.showTeamInstitutions && row.institutionCode ? { institutionCode: row.institutionCode } : {}),
    points: row.points,
    ...(row.wins !== undefined ? { wins: row.wins } : {}),
    totalSpeakerScore: row.totalSpeakerScore,
    averageSpeakerScore: row.averageSpeakerScore,
    metrics: pickMetrics(row.metrics, teamExtra),
  });
  let anonymousIndex = 0;
  const anonymousIds = new Map<string, string>();
  const speakerRow = (row: SpeakerStandingRow): PublicSpeakerTabRow => {
    const anonymous = namer.isSpeakerAnonymous(row.speakerId);
    if (anonymous && !anonymousIds.has(row.speakerId)) anonymousIds.set(row.speakerId, `anonymous-${(anonymousIndex += 1)}`);
    return {
      rank: row.rank,
      speakerId: anonymous ? anonymousIds.get(row.speakerId)! : row.speakerId,
      speakerName: namer.speaker(row.speakerId, row.speakerName),
      ...(anonymous ? { anonymous: true as const } : {}),
      teamId: anonymous ? "" : row.teamId,
      teamName: anonymous ? "" : namer.team(row.teamId, row.teamName),
      totalScore: row.totalScore,
      averageScore: row.averageScore,
      speechesCount: row.speechesCount,
      ...(row.ineligible ? { ineligible: true } : {}),
      metrics: pickMetrics(row.metrics, speakerExtra),
    };
  };
  const publicSpeakerCategories: SpeakerCategory[] = (preferences?.speakerCategories ?? []).filter((category) => category.public);
  const tabs: PublicTabs = {
    roundCount,
    limits: { team: settings.teamTabLimit, speaker: settings.speakerTabLimit, replies: settings.repliesTabLimit },
  };
  if (release.teamTab) tabs.teamTab = withinLimit(standings.teams, settings.teamTabLimit).map(teamRow);
  if (release.speakerTab) {
    tabs.speakerTab = withinLimit(standings.speakers, settings.speakerTabLimit).map(speakerRow);
    tabs.speakerCategoryTabs = Object.fromEntries(
      publicSpeakerCategories.map((category) => [
        category.id,
        speakerRowsInCategory(standings.speakers, category.id, publicSpeakerCategories, category.limit).map(speakerRow),
      ])
    );
  }
  if (release.repliesTab) tabs.repliesTab = withinLimit(standings.replies, settings.repliesTabLimit).map(speakerRow);
  if (wantsCategoryTabs) {
    const teamById = new Map(input.teams.map((team) => [team.id, team]));
    const precedence = resolveTeamPrecedence(input.tournament.format ?? "two_team", preferences);
    const categories = [...input.breakCategories].sort((left, right) => left.seq - right.seq);
    tabs.breakCategoryTabs = Object.fromEntries(
      categories.map((category) => [
        category.id,
        withinLimit(
          rankTeamSubset(standings.teams.filter((row) => inBreakCategory(category, teamById.get(row.teamId))), precedence),
          categoryLimit(category)
        ).map(teamRow),
      ])
    );
    tabs.limits.breakCategories = Object.fromEntries(categories.map((category) => [category.id, categoryLimit(category)]));
  }
  return tabs;
}

/** Team precedence metrics for teams in released breaks (Tabbycat `public_break_metrics_to_show`). */
export function buildBreakMetrics(
  input: DerivedInput,
  breakingTeamIds: Set<string>,
  computed = computeStandings(input)
): PublicDerived["breakMetrics"] {
  if (input.settings.breakMetrics === 0 || breakingTeamIds.size === 0) return undefined;
  const precedence = [...new Set(resolveTeamPrecedence(input.tournament.format, input.tournament.preferences))]
    // Who-beat-whom is a pairwise tiebreak, not a value a team has on its own.
    .filter((metric) => metric !== "wbw");
  const metricIds = input.settings.breakMetrics > 0 ? precedence.slice(0, input.settings.breakMetrics) : precedence;
  if (metricIds.length === 0) return undefined;
  return {
    metricIds,
    teams: Object.fromEntries(
      computed.standings.teams
        .filter((row) => breakingTeamIds.has(row.teamId))
        .map((row) => [row.teamId, pickMetrics(row.metrics, metricIds)])
    ),
  };
}

export function buildAdjudicatorTab(input: DerivedInput): PublicAdjudicatorTab | undefined {
  const { settings, namer } = input;
  if (!settings.adjudicatorTab) return undefined;
  const shows = settings.adjudicatorTabShows;
  const preferences = input.tournament.preferences;
  const rounds = input.rounds.filter((round) => round.cancelled !== true).sort((left, right) => left.seq - right.seq);
  // The final score blends feedback with the weight of the latest round with a published draw,
  // as the tab room's feedback page does with its active round.
  const weightRound = [...rounds].reverse().find((round) => isDrawPubliclyReleased(round)) ?? rounds[rounds.length - 1];
  const summaries = shows === "test" ? new Map() : calculateFeedbackSummaries(input.feedback, input.debates, preferences);
  const rows = input.adjudicators.map((adjudicator): PublicAdjudicatorTabRow => {
    const anonymous = namer.isAdjudicatorAnonymous(adjudicator.id);
    const summary = summaries.get(adjudicator.id);
    const row: PublicAdjudicatorTabRow = {
      adjudicatorId: adjudicator.id,
      name: namer.adjudicator(adjudicator.id, adjudicator.name),
      ...(anonymous ? { anonymous: true as const } : {}),
      ...(settings.showAdjudicatorInstitutions && adjudicator.institutionName ? { institutionName: adjudicator.institutionName } : {}),
    };
    if (shows !== "final") row.baseScore = preFeedbackScore(adjudicator);
    if (shows !== "test") {
      row.finalScore = blendAdjudicatorScore(adjudicator, summary?.scaledAverage, weightRound?.feedbackWeight);
      row.feedbackCount = summary?.count ?? 0;
    }
    if (shows === "all") {
      row.roundScores = Object.fromEntries(
        adjudicatorScoreHistory(adjudicator, rounds, input.debates, input.feedback, preferences)
          .filter((entry) => entry.summary)
          .map((entry) => [entry.roundId, entry.summary!.average])
      );
    }
    return row;
  });
  rows.sort(
    (left, right) =>
      (right.finalScore ?? right.baseScore ?? 0) - (left.finalScore ?? left.baseScore ?? 0) ||
      left.name.localeCompare(right.name) ||
      left.adjudicatorId.localeCompare(right.adjudicatorId)
  );
  return {
    shows,
    rounds: shows === "all" ? rounds.map((round) => ({ id: round.id, name: round.name, seq: round.seq })) : [],
    rows,
  };
}

export function buildSideAllocations(input: DerivedInput): PublicSideAllocations | undefined {
  if (!input.settings.sideAllocations) return undefined;
  const rounds = input.rounds
    .filter((round) => round.cancelled !== true && round.stage === "preliminary" && round.preallocatedSides && Object.keys(round.preallocatedSides).length > 0)
    .sort((left, right) => left.seq - right.seq);
  const knownTeams = new Set(input.teams.map((team) => team.id));
  const teams: PublicSideAllocations["teams"] = {};
  for (const round of rounds) {
    for (const [teamId, side] of Object.entries(round.preallocatedSides ?? {})) {
      if (!knownTeams.has(teamId) || (side !== "AFF" && side !== "NEG")) continue;
      (teams[teamId] ??= {})[round.id] = side;
    }
  }
  return { rounds: rounds.map((round) => ({ id: round.id, name: round.name, seq: round.seq })), teams };
}

/** Veto counts per public motion, from ballots whose results are public. */
export function buildVetoes(input: DerivedInput): PublicDerived["vetoes"] {
  if (!input.settings.vetoStatistics) return undefined;
  const vetoes: NonNullable<PublicDerived["vetoes"]> = {};
  const latestByDebate = new Map<string, BallotSubmission>();
  for (const ballot of confirmedBallots(input.ballots)) {
    if (!input.resultRoundIds.has(ballot.roundId)) continue;
    const current = latestByDebate.get(ballot.debateId);
    if (!current || (ballot.version ?? 0) > (current.version ?? 0)) latestByDebate.set(ballot.debateId, ballot);
  }
  for (const ballot of latestByDebate.values()) {
    for (const [side, motionId] of Object.entries(ballot.vetoes ?? {}) as Array<[DebateSide, string | undefined]>) {
      if (!motionId || !input.visibleMotionIds.has(motionId)) continue;
      const bySide = (vetoes[motionId] ??= {});
      bySide[side] = (bySide[side] ?? 0) + 1;
    }
  }
  return vetoes;
}

function countBy(values: Array<string | undefined>): PublicDiversityCount[] {
  const counts = new Map<string, PublicDiversityCount>();
  for (const value of values) {
    const key = value?.toLowerCase() ?? "";
    const entry = counts.get(key) ?? { label: value ?? null, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort(
    (left, right) => right.count - left.count || (left.label ?? "￿").localeCompare(right.label ?? "￿")
  );
}

function averageBy(entries: Array<{ label: string | undefined; value: number }>): PublicDiversityAverage[] {
  const totals = new Map<string, { label: string | null; count: number; sum: number }>();
  for (const { label, value } of entries) {
    if (!Number.isFinite(value)) continue;
    const key = label?.toLowerCase() ?? "";
    const entry = totals.get(key) ?? { label: label ?? null, count: 0, sum: 0 };
    entry.count += 1;
    entry.sum += value;
    totals.set(key, entry);
  }
  return [...totals.values()]
    .map(({ label, count, sum }) => ({ label, count, average: sum / count }))
    .sort((left, right) => right.count - left.count || (left.label ?? "￿").localeCompare(right.label ?? "￿"));
}

export function buildDiversity(input: DerivedInput): PublicDiversity | undefined {
  if (!input.settings.diversity) return undefined;
  const institutionsById = new Map(input.institutions.map((institution) => [institution.id, institution]));
  const speakers = input.teams
    .filter((team) => team.isSwing !== true)
    .flatMap((team) => (team.speakers ?? []).map((speaker) => ({ speaker, team })));
  const publicCategories = (input.tournament.preferences?.speakerCategories ?? []).filter((category) => category.public);
  const categoryName = new Map(publicCategories.map((category) => [category.id, category.name]));
  const speakerGender = new Map(speakers.map(({ speaker }) => [speaker.id, participantGender(speaker)]));
  const adjudicatorGender = new Map(input.adjudicators.map((adjudicator) => [adjudicator.id, participantGender(adjudicator)]));

  const roleGender = (role: "chair" | "panellist" | "trainee") => {
    const ids: string[] = [];
    for (const debate of input.debates) {
      if (!input.revealedRoundIds.has(debate.roundId)) continue;
      const panel = debate.adjudicators;
      if (role === "chair" && panel?.chairId) ids.push(panel.chairId);
      if (role === "panellist") ids.push(...(panel?.panellistIds ?? []));
      if (role === "trainee") ids.push(...(panel?.traineeIds ?? []));
    }
    return countBy(ids.map((id) => adjudicatorGender.get(id)));
  };

  const rules = { format: input.tournament.format, preferences: input.tournament.preferences };
  const speakerScores: Array<{ label: string | undefined; value: number }> = [];
  const latestByDebate = new Map<string, BallotSubmission>();
  for (const ballot of confirmedBallots(input.ballots)) {
    if (!input.speakerScoreRoundIds.has(ballot.roundId)) continue;
    const current = latestByDebate.get(ballot.debateId);
    if (!current || (ballot.version ?? 0) > (current.version ?? 0)) latestByDebate.set(ballot.debateId, ballot);
  }
  for (const ballot of latestByDebate.values()) {
    for (const entries of Object.values(ballot.speakerScores ?? {})) {
      for (const entry of entries ?? []) {
        if (entry.ghost || isReplyEntry(entry, rules) || !speakerGender.has(entry.speakerId)) continue;
        speakerScores.push({ label: speakerGender.get(entry.speakerId), value: entry.score });
      }
    }
  }

  const counted = input.feedback.filter(isFeedbackCountedForScore);
  return {
    speakers: {
      total: speakers.length,
      gender: countBy(speakers.map(({ speaker }) => participantGender(speaker))),
      region: countBy(
        speakers.map(({ speaker, team }) =>
          participantRegion({ region: speaker.region, institutionId: team.institutionId }, institutionsById)
        )
      ),
      categories: countBy(
        speakers.flatMap(({ speaker, team }) =>
          resolveSpeakerCategoryIds(speaker.categories ?? team.speakerCategories ?? [], publicCategories).map((id) => categoryName.get(id))
        )
      ).filter((entry) => entry.label !== null),
    },
    adjudicators: {
      total: input.adjudicators.length,
      gender: countBy(input.adjudicators.map(participantGender)),
      region: countBy(input.adjudicators.map((adjudicator) => participantRegion(adjudicator, institutionsById))),
      roles: [
        { role: "all", gender: countBy(input.adjudicators.map(participantGender)) },
        { role: "chair", gender: roleGender("chair") },
        { role: "panellist", gender: roleGender("panellist") },
        { role: "trainee", gender: roleGender("trainee") },
        ...(input.release.adjudicatorCore
          ? [{ role: "core" as const, gender: countBy(input.adjudicators.filter((item) => item.adjCore).map(participantGender)) }]
          : []),
      ],
    },
    speakerScores: averageBy(speakerScores),
    feedbackReceived: averageBy(
      counted.map((submission) => ({ label: adjudicatorGender.get(submission.targetAdjudicatorId ?? ""), value: submission.score }))
    ),
    feedbackGiven: averageBy(
      counted
        .filter((submission) => submission.sourceType === "adjudicator")
        .map((submission) => ({ label: adjudicatorGender.get(submission.sourceId), value: submission.score }))
    ),
  };
}

/**
 * Tabbycat's public "feedback progress": per public team and adjudicator, the feedback they owe
 * (in rounds whose panels are public) and how much they have submitted. Names only, no content.
 */
export function buildFeedbackProgress(input: DerivedInput): PublicDerived["feedbackProgress"] {
  const preferences = input.tournament.preferences;
  if (!input.settings.feedbackProgress || preferences?.feedbackEnabled === false) return undefined;
  const inElims = preferences?.feedbackInEliminationRounds !== false;
  const rounds = input.rounds
    .filter((round) => round.cancelled !== true && input.revealedRoundIds.has(round.id))
    .filter((round) => isFeedbackEnabledForRound({ postponed: false }, round, inElims))
    .sort((left, right) => left.seq - right.seq);
  const teamName = new Map(input.teams.map((team) => [team.id, team.name]));
  const showUnexpected = preferences?.showUnexpectedFeedback !== false;
  const totals = new Map<string, PublicFeedbackProgressRow>();
  const isPublicSource = (sourceType: "team" | "adjudicator", sourceId: string) =>
    sourceType === "team" ? input.publicTeamIds.has(sourceId) : input.publicAdjudicatorIds.has(sourceId);
  const rowFor = (sourceType: "team" | "adjudicator", sourceId: string) => {
    const key = `${sourceType}|${sourceId}`;
    const row = totals.get(key) ?? {
      sourceType,
      sourceId,
      name: sourceType === "team"
        ? input.namer.team(sourceId, teamName.get(sourceId))
        : input.namer.adjudicator(sourceId),
      expected: 0,
      submitted: 0,
    };
    totals.set(key, row);
    return row;
  };
  for (const round of rounds) {
    // Same matching as the tab room's feedback progress: any submission from the source about
    // the target in the round counts, confirmed or not.
    const received = new Set(
      input.feedback
        .filter((submission) => submission.roundId === round.id)
        .map((submission) => `${submission.sourceType}|${submission.sourceId}|${submission.targetAdjudicatorId ?? ""}`)
    );
    const path = feedbackPathsForRound(preferences, round);
    for (const debate of input.debates) {
      if (debate.roundId !== round.id) continue;
      for (const item of expectedFeedbackForDebate(debate, path)) {
        if (!isPublicSource(item.sourceType, item.sourceId)) continue;
        const row = rowFor(item.sourceType, item.sourceId);
        row.expected += 1;
        if (received.has(`${item.sourceType}|${item.sourceId}|${item.targetAdjudicatorId}`)) row.submitted += 1;
      }
    }
    // Tabbycat's participants pages count feedback nobody expected, unless switched off.
    if (showUnexpected) {
      for (const submission of unexpectedFeedback(round, input.debates, input.feedback, path)) {
        if (!isPublicSource(submission.sourceType, submission.sourceId)) continue;
        const row = rowFor(submission.sourceType, submission.sourceId);
        row.unexpected = (row.unexpected ?? 0) + 1;
      }
    }
  }
  return {
    roundIds: rounds.map((round) => round.id),
    rows: [...totals.values()].sort(
      (left, right) =>
        (right.expected - right.submitted) - (left.expected - left.submitted) ||
        left.name.localeCompare(right.name) ||
        left.sourceId.localeCompare(right.sourceId)
    ),
  };
}

export function buildPublicDerived(input: DerivedInput, breakingTeamIds: Set<string>): { tabs?: PublicTabs; derived: PublicDerived } {
  const needsStandings =
    input.release.teamTab || input.release.speakerTab || input.release.repliesTab || input.settings.breakCategoryTabs || breakingTeamIds.size > 0;
  const computed = needsStandings ? computeStandings(input) : undefined;
  const derived: PublicDerived = {};
  const tabs = computed ? buildPublicTabs(input, computed) : undefined;
  const breakMetrics = computed ? buildBreakMetrics(input, breakingTeamIds, computed) : undefined;
  if (breakMetrics) derived.breakMetrics = breakMetrics;
  const adjudicatorTab = buildAdjudicatorTab(input);
  if (adjudicatorTab) derived.adjudicatorTab = adjudicatorTab;
  const sideAllocations = buildSideAllocations(input);
  if (sideAllocations) derived.sideAllocations = sideAllocations;
  const vetoes = buildVetoes(input);
  if (vetoes) derived.vetoes = vetoes;
  const diversity = buildDiversity(input);
  if (diversity) derived.diversity = diversity;
  const feedbackProgress = buildFeedbackProgress(input);
  if (feedbackProgress) derived.feedbackProgress = feedbackProgress;
  const publicForms = buildPublicFormsDirectory({
    preferences: input.tournament.preferences,
    rounds: input.rounds,
    debates: input.debates,
    teams: input.teams,
    adjudicators: input.adjudicators,
    motions: input.motions,
    namer: input.namer,
    revealedRoundIds: input.revealedRoundIds,
  });
  if (publicForms) derived.publicForms = publicForms;
  return { ...(tabs ? { tabs } : {}), derived };
}

/**
 * The diversity statistics for tournament staff (#25): the same breakdowns as the public page, but
 * over every round and every confirmed ballot, whatever has been released.
 */
export function buildAdminDiversity(
  tournament: Pick<Tournament, "id" | "format" | "preferences">,
  data: Pick<DerivedInput, "rounds" | "teams" | "adjudicators" | "debates" | "ballots" | "institutions" | "feedback">,
  namer: PublicNamer
): PublicDiversity {
  const roundIds = new Set(data.rounds.filter((round) => round.cancelled !== true).map((round) => round.id));
  return buildDiversity({
    ...data,
    tournament,
    settings: { diversity: true } as PublicSiteSettings,
    release: { teamTab: false, speakerTab: false, repliesTab: false, breakCategoryIds: new Set(), adjudicatorCore: true },
    motions: [],
    breakCategories: [],
    namer,
    speakerScoreRoundIds: roundIds,
    resultRoundIds: roundIds,
    revealedRoundIds: roundIds,
    visibleMotionIds: new Set(),
    publicTeamIds: new Set(),
    publicAdjudicatorIds: new Set(),
  })!;
}
