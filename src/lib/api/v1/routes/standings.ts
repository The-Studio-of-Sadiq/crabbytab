import { scopesAllow } from "@/lib/apiScopes";
import { calculateFeedbackSummaries } from "@/lib/feedback/scores";
import { getPublicRelease, isAnyTabReleased, isTabRound } from "@/lib/publicRelease";
import { calculateStandings, type StandingsCalculationResult } from "@/lib/standings/calculator";
import type {
  Adjudicator,
  BallotSubmission,
  Debate,
  FeedbackSubmission,
  Round,
  SpeakerStandingRow,
  Team,
  TeamStandingRow,
} from "@/types";
import { ApiError, notFound } from "../errors";
import { defineRoute, listOf, slugParam } from "../router";
import { s } from "../schema";
import { asType } from "../serializers";
import { roundSeqSchema, type AnyContext } from "./shared";

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

async function computeStandings(context: AnyContext, tab: Tab, afterRoundSeq?: string): Promise<StandingsCalculationResult> {
  const allRounds = (await context.data.all("rounds")).map((record) => asType<Round>(record));
  let rounds: Round[];
  if (context.data.view === "public") {
    const release = getPublicRelease(context.tournament.preferences);
    if (!release[RELEASE_KIND[tab]]) {
      throw new ApiError(403, "forbidden", "This tab has not been released to the public.");
    }
    if (afterRoundSeq !== undefined) throw new ApiError(400, "bad_request", "Public tabs cover the whole released tab; omit `round`.");
    rounds = isAnyTabReleased(release) ? allRounds.filter(isTabRound) : [];
  } else {
    rounds = allRounds.filter((round) => !round.cancelled);
    if (afterRoundSeq !== undefined) {
      const seq = Number(afterRoundSeq);
      if (!allRounds.some((round) => round.seq === seq)) throw notFound("Round");
      rounds = rounds.filter((round) => round.seq <= seq);
    }
  }
  const roundIds = new Set(rounds.map((round) => round.id));
  const [teams, debates, ballots] = await Promise.all([
    context.data.all("teams"),
    context.data.all("debates"),
    // Unconfirmed ballots never count, so they are not read.
    context.data.all("ballots", [{ field: "confirmed", op: "==", value: true }]),
  ]);
  return calculateStandings(
    context.tournament,
    rounds,
    teams.map((record) => asType<Team>(record)),
    debates.map((record) => asType<Debate>(record)).filter((debate) => roundIds.has(debate.roundId)),
    ballots.map((record) => asType<BallotSubmission>(record)).filter((ballot) => roundIds.has(ballot.roundId))
  );
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
const roundQueryDescription =
  " Administrator tokens may pass `round` (a round sequence number) for the standings after that round.";

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
    query: roundQuery,
    response: listOf(teamStandingSchema),
    async handler(context) {
      const standings = await computeStandings(context, "teams", context.query.round);
      return { data: standings.teams.map(teamRow) };
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
      const standings = await computeStandings(context, "teams", context.query.round);
      return {
        data: standings.teams.map((row) => ({ id: row.teamId, name: row.teamName, rounds: row.roundResults })),
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
    query: roundQuery,
    response: listOf(speakerStandingSchema),
    async handler(context) {
      const standings = await computeStandings(context, "speakers", context.query.round);
      return { data: standings.speakers.map(speakerRow) };
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
    query: roundQuery,
    response: listOf(speakerStandingSchema),
    async handler(context) {
      const standings = await computeStandings(context, "replies", context.query.round);
      return { data: standings.replies.map(speakerRow) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/speakers/standings/rounds",
    operationId: "getSpeakerRoundScores",
    summary: "Speaker scores by round",
    description: "Each speaker's substantive score in every counted round." + roundQueryDescription,
    tag: "standings",
    auth: access,
    params,
    query: roundQuery,
    response: listOf(roundResultSchema),
    async handler(context) {
      const standings = await computeStandings(context, "speakers", context.query.round);
      return {
        data: standings.speakers.map((row) => ({ id: row.speakerId, name: row.speakerName, rounds: row.scoresByRound })),
      };
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
