import { scopesAllow } from "@/lib/apiScopes";
import { ballotMatchesDebate } from "@/lib/ballots/result";
import { getPublicSiteSettings } from "@/lib/publicFeatures";
import { canShowAggregateTeamScores } from "@/lib/publicScoreVisibility";
import { speakerRowsInCategory } from "@/lib/speakerCategories";
import { ALL_SPEAKER_METRICS, ALL_TEAM_METRICS, EXTRA_ONLY_TEAM_METRICS } from "@/lib/standings/metrics";
import { resolveTeamPrecedence } from "@/lib/standings/precedence";
import { rankTeamSubset } from "@/lib/standings/subset";
import { calculateFeedbackSummaries } from "@/lib/feedback/scores";
import { getPublicRelease, isAnyTabReleased, isTabRound } from "@/lib/publicRelease";
import type { PublicSpeakerTabRow, PublicTabs, PublicTeamTabRow } from "@/lib/publicView/derived";
import { calculateStandings, countedSubstantiveSpeeches, type StandingsCalculationResult } from "@/lib/standings/calculator";
import type {
  Adjudicator,
  BallotSubmission,
  Debate,
  FeedbackSubmission,
  Round,
  SpeakerStandingRow,
  Team,
  TeamStandingRow,
  Tournament,
} from "@/types";
import { ApiError, notFound } from "../errors";
import { defineRoute, listOf, slugParam } from "../router";
import { s } from "../schema";
import { asType } from "../serializers";
import { idSchema, roundSeqSchema, type AnyContext } from "./shared";

/**
 * Standings are computed with the same calculator, precedence and round rules as the tab room
 * (lib/standings/calculator.ts): preliminary, non-cancelled rounds; confirmed ballots only.
 *
 * Public tokens get exactly the public site's tab: only once the team / speaker / replies tab is
 * released, over completed preliminary rounds (lib/publicRelease.ts), computed from the published
 * public view. Administrator tokens get the live standings, optionally after a given round.
 */

type Tab = "teams" | "speakers" | "replies";

const RELEASE_KIND = { teams: "teamTab", speakers: "speakerTab", replies: "repliesTab" } as const;

interface StandingsOptions {
  /** Round sequence number: the standings after that round. */
  round?: string;
  /** Precedence override (Tabbycat's `metrics`), already validated. */
  metrics?: string[];
}

/** Tabbycat's `metrics` query: comma-separated metric ids, most important first. */
function parseMetrics(value: string | undefined, tab: Tab): string[] | undefined {
  if (value === undefined) return undefined;
  const ids = value.split(",").map((id) => id.trim()).filter(Boolean);
  const valid: readonly string[] = tab === "teams"
    ? ALL_TEAM_METRICS.filter((id) => !EXTRA_ONLY_TEAM_METRICS.includes(id))
    : ALL_SPEAKER_METRICS;
  const unknown = ids.filter((id) => !valid.includes(id));
  if (ids.length === 0 || ids.length > 8 || unknown.length > 0) {
    throw new ApiError(422, "validation_failed", "The request is not valid.", {
      issues: [{ path: "metrics", message: unknown.length ? `unknown metric ${unknown.join(", ")}` : "must list 1 to 8 metric ids" }],
    });
  }
  return ids;
}

/** The tournament with a per-request ranking precedence (never saved). */
function withPrecedence(tournament: Tournament, tab: Tab, metrics: string[] | undefined): Tournament {
  if (!metrics) return tournament;
  const key = tab === "teams" ? "teamStandingsPrecedence" : "speakerStandingsPrecedence";
  return { ...tournament, preferences: { ...tournament.preferences, [key]: metrics } };
}

/**
 * The rounds a request counts. Public tokens: the released tab's rounds (completed preliminary
 * rounds), optionally up to `round` among them; administrator tokens: every non-cancelled round,
 * optionally up to `round`.
 */
async function countedRounds(context: AnyContext, tab: Tab, afterRoundSeq?: string): Promise<Round[]> {
  const allRounds = (await context.data.all("rounds")).map((record) => asType<Round>(record));
  let rounds: Round[];
  if (context.data.view === "public") {
    const release = getPublicRelease(context.tournament.preferences);
    if (!release[RELEASE_KIND[tab]]) {
      throw new ApiError(403, "forbidden", "This tab has not been released to the public.");
    }
    rounds = isAnyTabReleased(release) ? allRounds.filter(isTabRound) : [];
  } else {
    rounds = allRounds.filter((round) => !round.cancelled);
  }
  if (afterRoundSeq !== undefined) {
    const seq = Number(afterRoundSeq);
    // Public tokens may only step back within the released tab's rounds.
    if (!rounds.some((round) => round.seq === seq)) throw notFound("Round");
    rounds = rounds.filter((round) => round.seq <= seq);
  }
  return rounds;
}

async function standingsInputs(context: AnyContext, rounds: Round[]) {
  const roundIds = new Set(rounds.map((round) => round.id));
  const [teams, debates, ballots] = await Promise.all([
    context.data.all("teams"),
    context.data.all("debates"),
    // Unconfirmed ballots never count, so they are not read.
    context.data.all("ballots", [{ field: "confirmed", op: "==", value: true }]),
  ]);
  return {
    teams: teams.map((record) => asType<Team>(record)),
    debates: debates.map((record) => asType<Debate>(record)).filter((debate) => roundIds.has(debate.roundId)),
    ballots: ballots.map((record) => asType<BallotSubmission>(record)).filter((ballot) => roundIds.has(ballot.roundId)),
  };
}

async function computeStandings(context: AnyContext, tab: Tab, options: StandingsOptions = {}): Promise<StandingsCalculationResult> {
  const rounds = await countedRounds(context, tab, options.round);
  const { teams, debates, ballots } = await standingsInputs(context, rounds);
  return calculateStandings(withPrecedence(context.tournament, tab, options.metrics), rounds, teams, debates, ballots);
}

/** Teams eligible for a break category, ranked among themselves (as Tabbycat's category standings). */
async function teamsInBreakCategory(context: AnyContext, rows: TeamStandingRow[], categoryId: string, metrics?: string[]): Promise<TeamStandingRow[]> {
  if (context.data.view === "public") {
    const site = getPublicSiteSettings(context.tournament.preferences);
    if (!site.breakCategoriesOnParticipants && !site.breakCategoryTabs) {
      throw new ApiError(403, "forbidden", "Break category eligibility has not been released to the public.");
    }
  }
  if (!(await context.data.get("breakCategories", categoryId))) throw notFound("Break category");
  const tournament = withPrecedence(context.tournament, "teams", metrics);
  return rankTeamSubset(
    rows.filter((row) => (row.breakCategories ?? []).includes(categoryId)),
    resolveTeamPrecedence(tournament.format, tournament.preferences)
  );
}

/** Speakers in a speaker category, ranked within it (public tokens: public categories only). */
function speakersInCategory(context: AnyContext, rows: SpeakerStandingRow[], categoryId: string): SpeakerStandingRow[] {
  const categories = context.tournament.preferences?.speakerCategories ?? [];
  if (!categories.some((category) => category.id === categoryId)) throw notFound("Speaker category");
  return speakerRowsInCategory(rows, categoryId, categories);
}

/**
 * The tab as the public site shows it, when recomputing from the public view would not give it.
 * With a site-wide top-N limit the public view carries no results for the tab's rounds (so ranks
 * below the cutoff cannot be rebuilt), and a speaker or break category tab can have a limit of its
 * own: then public tokens get the tab computed at publish time, exactly as the public page shows
 * it. `round` and `metrics` need the full results, so they are refused in that case. Returns
 * undefined when the request is answered by recomputing as before.
 */
async function publishedTab(
  context: AnyContext,
  tab: Tab,
  options: StandingsOptions & { category?: string }
): Promise<Array<Record<string, unknown>> | undefined> {
  if (context.data.view !== "public" || !context.data.publicTabs) return undefined;
  const preferences = context.tournament.preferences;
  const site = getPublicSiteSettings(preferences);
  const siteLimited = site.teamTabLimit > 0 || site.speakerTabLimit > 0 || site.repliesTabLimit > 0;
  const tabs: PublicTabs | null = await context.data.publicTabs();
  const categoryLimited = options.category !== undefined && (tab === "teams"
    ? (tabs?.limits.breakCategories?.[options.category] ?? 0) > 0
    : (preferences?.speakerCategories?.find((category) => category.id === options.category)?.limit ?? 0) > 0);
  if (!siteLimited && !categoryLimited) return undefined;
  if (!(options.category !== undefined && tab === "teams") && !getPublicRelease(preferences)[RELEASE_KIND[tab]]) {
    throw new ApiError(403, "forbidden", "This tab has not been released to the public.");
  }
  if (options.round !== undefined || options.metrics) {
    throw new ApiError(422, "validation_failed", "The public tab shows only its top ranks, so it cannot be recomputed.", {
      issues: [{ path: options.round !== undefined ? "round" : "metrics", message: "is not available while a public tab limit is set" }],
    });
  }
  if (!tabs) throw new ApiError(503, "unavailable", "The public tab has not been published yet; publish the public view again.");
  const teamRows = (rows: PublicTeamTabRow[] | undefined) => (rows ?? []).map(publishedTeamRow);
  const speakerRows = (rows: PublicSpeakerTabRow[] | undefined) => (rows ?? []).map(publishedSpeakerRow);
  if (tab === "teams") {
    if (options.category === undefined) return teamRows(tabs.teamTab);
    const rows = tabs.breakCategoryTabs?.[options.category];
    if (!rows) throw new ApiError(403, "forbidden", "This break category's tab has not been released to the public.");
    return teamRows(rows);
  }
  if (tab === "replies") return speakerRows(tabs.repliesTab);
  if (options.category === undefined) return speakerRows(tabs.speakerTab);
  const rows = tabs.speakerCategoryTabs?.[options.category];
  if (!rows) throw notFound("Speaker category");
  return speakerRows(rows);
}

/** A published team tab row in the API's row shape (only the tab's "extra" metrics are published). */
function publishedTeamRow(row: PublicTeamTabRow): Record<string, unknown> {
  return {
    rank: row.rank,
    teamId: row.teamId,
    teamName: row.teamName,
    institution: row.institutionCode || undefined,
    points: row.points,
    totalSpeakerScore: row.totalSpeakerScore,
    averageSpeakerScore: row.averageSpeakerScore,
    metrics: row.metrics,
  };
}

function publishedSpeakerRow(row: PublicSpeakerTabRow): Record<string, unknown> {
  return {
    rank: row.rank,
    ineligible: row.ineligible === true,
    speakerId: row.speakerId,
    speakerName: row.speakerName,
    teamId: row.teamId,
    teamName: row.teamName,
    totalScore: row.totalScore,
    averageScore: row.averageScore,
    speechesCount: row.speechesCount,
    metrics: row.metrics,
  };
}

type SpeechKind = "substantive" | "reply" | "ghost";

/**
 * Every listed speech per speaker, with the calculator's own rules: confirmed ballots that still
 * match their debate, no postponed debates or elimination rounds, swing speakers left out; a ghost
 * is a substantive speech the speaker tab does not count.
 */
export function speechesByRound(
  tournament: Tournament,
  rounds: Round[],
  teams: Team[],
  debates: Debate[],
  ballots: BallotSubmission[],
  wanted: Record<SpeechKind, boolean>
) {
  const replyEnabled = Boolean(tournament.preferences?.replyScoresEnabled) && tournament.format !== "bp";
  const prelimIds = new Set(rounds.filter((round) => round.stage !== "elimination" && !round.cancelled).map((round) => round.id));
  const debateById = new Map(debates.filter((debate) => prelimIds.has(debate.roundId) && !debate.postponed).map((debate) => [debate.id, debate]));
  const swing = new Set(teams.filter((team) => team.isSwing).flatMap((team) => (team.speakers ?? []).map((speaker) => speaker.id)));
  const known = new Map(teams.flatMap((team) => (team.speakers ?? []).map((speaker) => [speaker.id, { team, speaker }] as const)));
  type Speech = { roundSeq: number; position: number; score: number; kind: SpeechKind };
  const bySpeaker = new Map<string, { id: string; name: string; teamId: string; rounds: Speech[] }>();
  for (const ballot of ballots) {
    const debate = debateById.get(ballot.debateId);
    if (!debate || !ballot.confirmed || ballot.discarded || !ballotMatchesDebate(ballot, debate)) continue;
    for (const entries of Object.values(ballot.speakerScores ?? {})) {
      const counted = new Set(countedSubstantiveSpeeches(entries ?? [], replyEnabled));
      for (const entry of entries ?? []) {
        if (!entry.speakerId || swing.has(entry.speakerId)) continue;
        const kind: SpeechKind = replyEnabled && entry.position === 4 ? "reply" : counted.has(entry) ? "substantive" : "ghost";
        if (!wanted[kind]) continue;
        const found = known.get(entry.speakerId);
        const row = bySpeaker.get(entry.speakerId) ?? {
          id: entry.speakerId,
          name: found?.speaker.name ?? entry.speakerName,
          teamId: found?.team.id ?? "",
          rounds: [],
        };
        row.rounds.push({ roundSeq: debate.roundSeq, position: entry.position, score: entry.score, kind });
        bySpeaker.set(entry.speakerId, row);
      }
    }
  }
  return [...bySpeaker.values()]
    .map((row) => ({ ...row, rounds: row.rounds.sort((left, right) => left.roundSeq - right.roundSeq || left.position - right.position) }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function teamRow(row: TeamStandingRow) {
  return {
    rank: row.rank,
    teamId: row.teamId,
    teamName: row.teamName,
    institution: row.institutionCode || undefined,
    points: row.points,
    totalSpeakerScore: row.totalSpeakerScore,
    averageSpeakerScore: row.averageSpeakerScore,
    metrics: row.metrics,
    ...(row.whoBeatWhom ? { whoBeatWhom: row.whoBeatWhom } : {}),
  };
}

function speakerRow(row: SpeakerStandingRow) {
  return {
    rank: row.rank,
    ineligible: row.ineligible === true,
    speakerId: row.speakerId,
    speakerName: row.speakerName,
    teamId: row.teamId,
    teamName: row.teamName,
    totalScore: row.totalScore,
    averageScore: row.averageScore,
    speechesCount: row.speechesCount,
    metrics: row.metrics,
  };
}

const roundQuery = s.object({
  round: s.optional(roundSeqSchema),
});
const metricsSchema = s.optional(s.string({
  min: 1,
  max: 400,
  pattern: /^[a-z_]+(,[a-z_]+)*$/,
  description: "Comma-separated metric ids to rank by, most important first (overrides the configured precedence for this request only). Every metric is returned whatever the ranking, so Tabbycat's extra_metrics is not needed.",
}));
const roundQueryDescription =
  " `round` (a round sequence number) gives the standings after that round; public tokens may pick any round of the released tab.";

const teamStandingSchema = s.object({
  rank: s.integer({ description: "Shared ranks are equal." }),
  teamId: s.string(),
  teamName: s.string(),
  institution: s.optional(s.string()),
  points: s.number(),
  totalSpeakerScore: s.number(),
  averageSpeakerScore: s.number(),
  metrics: s.unknown("Every team metric by id (wins, points, speaks_sum, draw_strength_wins, ...)."),
  whoBeatWhom: s.optional(s.array(s.nullable(s.number()))),
}, { strict: false });

const speakerStandingSchema = s.object({
  rank: s.integer({ description: "0 when the speaker missed too many speeches to be ranked." }),
  ineligible: s.boolean(),
  speakerId: s.string(),
  speakerName: s.string(),
  teamId: s.string(),
  teamName: s.string(),
  totalScore: s.number(),
  averageScore: s.number(),
  speechesCount: s.integer(),
  metrics: s.unknown("Every speaker metric by id."),
}, { strict: false });

const roundResultSchema = s.object({
  id: s.string(),
  name: s.string(),
  rounds: s.array(s.unknown("One entry per round: side, points/score, opponents.")),
}, { strict: false });

const params = s.object({ slug: slugParam });
const access = { kind: "token", resource: "standings", access: "read", public: true } as const;

export const standingsReadRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/teams/standings",
    operationId: "getTeamStandings",
    summary: "Team standings",
    description: "Ranked by the tournament's team precedence." + roundQueryDescription,
    tag: "standings",
    auth: access,
    params,
    query: s.object({
      round: s.optional(roundSeqSchema),
      category: s.optional(idSchema("Break category id: only its eligible teams, ranked among themselves.")),
      metrics: metricsSchema,
    }),
    response: listOf(teamStandingSchema),
    async handler(context) {
      const metrics = parseMetrics(context.query.metrics, "teams");
      const published = await publishedTab(context, "teams", { round: context.query.round, metrics, category: context.query.category });
      if (published) return { data: published };
      const standings = await computeStandings(context, "teams", { round: context.query.round, metrics });
      const rows = context.query.category
        ? await teamsInBreakCategory(context, standings.teams, context.query.category, metrics)
        : standings.teams;
      return { data: rows.map(teamRow) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/teams/standings/rounds",
    operationId: "getTeamRoundResults",
    summary: "Team results by round",
    description: "Each team's result in every counted round." + roundQueryDescription,
    tag: "standings",
    auth: access,
    params,
    query: roundQuery,
    response: listOf(roundResultSchema),
    async handler(context) {
      const standings = await computeStandings(context, "teams", { round: context.query.round });
      return {
        data: standings.teams.map((row) => ({ id: row.teamId, name: row.teamName, rounds: row.roundResults })),
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/teams/standings/current-rounds",
    operationId: "getCurrentRoundTeamResults",
    summary: "Team results in the rounds released so far",
    description:
      "Tabbycat's public team standings (current rounds): before any tab is released, each team's " +
      "results in the rounds whose results are public (released, not silent), as the public site's " +
      "Standings page shows them. Speaker scores appear only for rounds whose team speaks are " +
      "released, and points/speaker totals only when every such round has them. Public tokens need " +
      "the public standings page on (`publicStandings`).",
    tag: "standings",
    auth: access,
    params,
    response: s.object({
      rounds: s.array(s.object({ seq: s.integer(), name: s.string(), teamSpeaksReleased: s.boolean() })),
      data: s.array(s.unknown("rank, teamId, teamName, institution, points?, totalSpeakerScore?, rounds[]")),
    }),
    async handler(context) {
      if (context.data.view === "public" && context.tournament.preferences?.publicStandings === false) {
        throw new ApiError(403, "forbidden", "Public standings are turned off.");
      }
      const allRounds = (await context.data.all("rounds")).map((record) => asType<Round>(record));
      const rounds = allRounds
        .filter((round) => round.resultsReleased && !round.silent && !round.cancelled && round.stage !== "elimination")
        .sort((left, right) => left.seq - right.seq);
      const { teams, debates, ballots } = await standingsInputs(context, rounds);
      const standings = calculateStandings(context.tournament, rounds, teams, debates, ballots);
      const speaksBySeq = new Map(rounds.map((round) => [round.seq, round.teamSpeaksReleased === true]));
      const aggregates = canShowAggregateTeamScores(rounds);
      return {
        rounds: rounds.map((round) => ({ seq: round.seq, name: round.name, teamSpeaksReleased: round.teamSpeaksReleased === true })),
        data: standings.teams.map((row) => ({
          rank: row.rank,
          teamId: row.teamId,
          teamName: row.teamName,
          institution: row.institutionCode || undefined,
          ...(aggregates ? { points: row.points, totalSpeakerScore: row.totalSpeakerScore } : {}),
          rounds: row.roundResults.map(({ speakerScore, opponentTeamIds: _ids, ...result }) => ({
            ...result,
            ...(speaksBySeq.get(result.roundSeq) ? { speakerScore } : {}),
          })),
        })),
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/speakers/standings",
    operationId: "getSpeakerStandings",
    summary: "Speaker standings (substantive speeches)",
    description: "Ranked by the tournament's speaker precedence." + roundQueryDescription,
    tag: "standings",
    auth: access,
    params,
    query: s.object({
      round: s.optional(roundSeqSchema),
      category: s.optional(idSchema("Speaker category id: only its speakers, ranked within it.")),
      metrics: metricsSchema,
    }),
    response: listOf(speakerStandingSchema),
    async handler(context) {
      const metrics = parseMetrics(context.query.metrics, "speakers");
      const published = await publishedTab(context, "speakers", { round: context.query.round, metrics, category: context.query.category });
      if (published) return { data: published };
      const standings = await computeStandings(context, "speakers", { round: context.query.round, metrics });
      const rows = context.query.category ? speakersInCategory(context, standings.speakers, context.query.category) : standings.speakers;
      return { data: rows.map(speakerRow) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/speakers/standings/replies",
    operationId: "getReplyStandings",
    summary: "Reply speaker standings",
    description: "Empty when reply speeches are not used." + roundQueryDescription,
    tag: "standings",
    auth: access,
    params,
    query: s.object({ round: s.optional(roundSeqSchema), metrics: metricsSchema }),
    response: listOf(speakerStandingSchema),
    async handler(context) {
      const metrics = parseMetrics(context.query.metrics, "replies");
      const published = await publishedTab(context, "replies", { round: context.query.round, metrics });
      if (published) return { data: published };
      const standings = await computeStandings(context, "replies", { round: context.query.round, metrics });
      return { data: standings.replies.map(speakerRow) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/speakers/standings/rounds",
    operationId: "getSpeakerRoundScores",
    summary: "Speaker scores by round",
    description:
      "Each speaker's speeches in every counted round (confirmed ballots). `substantive` (default " +
      "true), `replies` and `ghost` (iron-person duplicate speeches; both default false) choose which " +
      "speeches are listed; each entry's `kind` says which it is. Public tokens need the speaker tab " +
      "released (the replies tab for replies)." + roundQueryDescription,
    tag: "standings",
    auth: access,
    params,
    query: s.object({
      round: s.optional(roundSeqSchema),
      substantive: s.optional(s.boolean("Include substantive speeches (default true).")),
      replies: s.optional(s.boolean("Include reply speeches (default false).")),
      ghost: s.optional(s.boolean("Include ghost (iron-person) speeches (default false).")),
    }),
    response: listOf(roundResultSchema),
    async handler(context) {
      const wanted = {
        substantive: context.query.substantive ?? true,
        reply: context.query.replies ?? false,
        ghost: context.query.ghost ?? false,
      };
      if (wanted.substantive || wanted.ghost) await countedRounds(context, "speakers", context.query.round);
      const rounds = await countedRounds(context, wanted.reply ? "replies" : "speakers", context.query.round);
      const { teams, debates, ballots } = await standingsInputs(context, rounds);
      return { data: speechesByRound(context.tournament, rounds, teams, debates, ballots, wanted) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/adjudicators/standings",
    operationId: "getAdjudicatorStandings",
    summary: "Adjudicator feedback summary",
    description:
      "Base and test scores with the weighted feedback average (confirmed, not ignored feedback; " +
      "the tournament's feedback source weights apply). Administrator tokens with read:standings " +
      "and read:feedback only.",
    tag: "standings",
    auth: { kind: "token", resource: "standings", access: "read" },
    params,
    response: listOf(s.object({
      adjudicatorId: s.string(),
      name: s.string(),
      baseScore: s.number(),
      testScore: s.nullable(s.number()),
      feedbackCount: s.integer(),
      feedbackAverage: s.nullable(s.number()),
      feedbackScaledAverage: s.nullable(s.number({ description: "Feedback average on the adjudicator score scale." })),
    })),
    async handler(context) {
      if (!context.token || !scopesAllow(context.token.scopes, "feedback", "read")) {
        throw new ApiError(403, "forbidden", "Adjudicator standings reveal feedback; the token also needs read:feedback.");
      }
      const [adjudicators, debates, feedback] = await Promise.all([
        context.data.all("adjudicators"),
        context.data.all("debates"),
        context.data.all("feedback", [{ field: "confirmed", op: "==", value: true }]),
      ]);
      const summaries = calculateFeedbackSummaries(
        feedback.map((record) => asType<FeedbackSubmission>(record)),
        debates.map((record) => asType<Debate>(record)),
        context.tournament.preferences
      );
      return {
        data: adjudicators
          .map((record) => asType<Adjudicator>(record))
          .map((adjudicator) => {
            const summary = summaries.get(adjudicator.id);
            return {
              adjudicatorId: adjudicator.id,
              name: adjudicator.name,
              baseScore: adjudicator.baseScore,
              testScore: adjudicator.testScore ?? null,
              feedbackCount: summary?.count ?? 0,
              feedbackAverage: summary?.average ?? null,
              feedbackScaledAverage: summary?.scaledAverage ?? null,
            };
          })
          .sort((left, right) => left.name.localeCompare(right.name) || left.adjudicatorId.localeCompare(right.adjudicatorId)),
      };
    },
  }),
];
