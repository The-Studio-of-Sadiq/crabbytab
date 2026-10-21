import Papa from "papaparse";
import type {
  Adjudicator,
  Debate,
  DebateSide,
  FeedbackAnswer,
  FeedbackQuestion,
  FeedbackSubmission,
  Round,
  SideNames,
  SpeakerStandingRow,
  Team,
  TeamStandingRow,
  TournamentFormat,
} from "@/types";
import { ballotSides } from "@/lib/ballots/result";
import { compareSides, isPolyFormat, isPolySide } from "@/lib/debateSides";
import { sideLabel } from "@/lib/sideNames";

/**
 * CSV exports as pure functions returning text. PapaParse quotes commas, quotes and newlines;
 * `escapeFormulae` prefixes cells starting with =, +, -, @ so spreadsheets never run them.
 */

type Cell = string | number | boolean | null | undefined;

export function toCsv(fields: string[], rows: Cell[][]): string {
  return Papa.unparse(
    { fields, data: rows.map((row) => row.map((cell) => cell ?? "")) },
    { escapeFormulae: true, newline: "\r\n" }
  );
}

function fixed(value: number | undefined, digits: number): string {
  return value === undefined || !Number.isFinite(value) ? "" : value.toFixed(digits);
}

export function teamStandingsCsv(rows: TeamStandingRow[]): string {
  return toCsv(
    ["Rank", "Team", "Institution", "Points", "Total Speaker Score", "Average Speaker Score", "1st Places", "2nd Places", "3rd Places", "4th Places", "Wins", "Margin"],
    rows.map((row) => [
      row.rank,
      row.teamName,
      row.institutionCode,
      row.points,
      row.totalSpeakerScore,
      row.averageSpeakerScore,
      row.firstPlaces ?? 0,
      row.secondPlaces ?? 0,
      row.thirdPlaces ?? 0,
      row.fourthPlaces ?? 0,
      row.wins ?? 0,
      row.margins ?? 0,
    ])
  );
}

/** Speaker or reply standings with one column per round (several speeches in a round are joined). */
export function speakerStandingsCsv(
  rows: SpeakerStandingRow[],
  options: { reply?: boolean; categoryNames?: (refs: string[]) => string[] } = {}
): string {
  const roundSeqs = [...new Set(rows.flatMap((row) => row.scoresByRound.map((score) => score.roundSeq)))].sort((a, b) => a - b);
  const fields = [
    "Rank",
    options.reply ? "Reply Speaker" : "Speaker",
    "Team",
    "Institution",
    ...(options.reply ? [] : ["Categories"]),
    "Speeches",
    "Total Score",
    "Average Score",
    ...roundSeqs.map((seq) => `Round ${seq}`),
  ];
  return toCsv(
    fields,
    rows.map((row) => [
      row.ineligible ? "" : row.rank,
      row.speakerName,
      row.teamName,
      row.institutionCode,
      ...(options.reply ? [] : [(options.categoryNames?.(row.categories ?? []) ?? row.categories ?? []).join("; ")]),
      row.speechesCount,
      fixed(row.totalScore, 2),
      fixed(row.averageScore, 2),
      ...roundSeqs.map((seq) =>
        row.scoresByRound.filter((score) => score.roundSeq === seq).map((score) => score.score).join("; ")
      ),
    ])
  );
}

export interface DrawCsvOptions {
  format: TournamentFormat;
  /** The tournament's side names (Tabbycat `side_names`) for the two-team column headers. */
  sideNames?: SideNames;
  /** Poly only: teams per debate (columns Team 1 … Team N). */
  teamsInDebate?: number;
  /** Leave adjudicators out, e.g. when they are not yet revealed to the public. */
  includeAdjudicators?: boolean;
  /** Adds the motion column (only when motions are released, or for tab-room use). */
  includeMotion?: boolean;
}

export function drawCsv(debates: Debate[], options: DrawCsvOptions): string {
  // Poly: a column for every position any room uses (a short last room has fewer).
  const sides = isPolyFormat(options.format)
    ? [...new Set([
        ...ballotSides(options.format, options.teamsInDebate),
        ...debates.flatMap((debate) => Object.keys(debate.teams || {}).filter(isPolySide)),
      ])].sort(compareSides) as DebateSide[]
    : ballotSides(options.format);
  const includeAdjudicators = options.includeAdjudicators ?? true;
  const fields = [
    "Room Rank",
    "Venue",
    ...sides.map((side) => sideLabel(side, { sideNames: options.sideNames }, "full")),
    ...(includeAdjudicators ? ["Chair", "Panellists", "Trainees"] : []),
    ...(options.includeMotion ? ["Motion"] : []),
    "Notes",
  ];
  const ordered = [...debates].sort((a, b) => Number(Boolean(a.byeTeamId)) - Number(Boolean(b.byeTeamId)) || a.roomRank - b.roomRank);
  return toCsv(
    fields,
    ordered.map((debate) => {
      const byeTeam = debate.byeTeamId ? Object.values(debate.teams || {}).find((slot) => slot?.teamId === debate.byeTeamId) : undefined;
      const notes = [
        ...(debate.byeTeamId ? [`Bye: ${byeTeam?.teamName ?? ""}`.trim()] : []),
        ...(debate.postponed ? ["Postponed"] : []),
      ].join("; ");
      return [
        debate.roomRank,
        debate.byeTeamId ? "" : debate.venueName,
        ...sides.map((side) => (debate.byeTeamId ? "" : debate.teams?.[side]?.teamName)),
        ...(includeAdjudicators
          ? [
              debate.adjudicators?.chairName,
              (debate.adjudicators?.panellistNames ?? []).join("; "),
              (debate.adjudicators?.traineeNames ?? []).join("; "),
            ]
          : []),
        ...(options.includeMotion ? [debate.motionText] : []),
        notes,
      ];
    })
  );
}

export interface AdjudicatorScoreCsvRow {
  adjudicator: Adjudicator;
  feedbackCount: number;
  feedbackAverage?: number;
  /** Score after blending feedback with the test/base score. */
  score: number;
}

/** Admin only: adjudicator scores are private tab-room data. */
export function adjudicatorScoresCsv(rows: AdjudicatorScoreCsvRow[]): string {
  return toCsv(
    ["Adjudicator", "Institution", "Base Score", "Test Score", "Counted Feedback", "Weighted Feedback Average", "Score", "Trainee", "Independent"],
    rows.map(({ adjudicator, feedbackCount, feedbackAverage, score }) => [
      adjudicator.name,
      adjudicator.institutionName,
      adjudicator.baseScore,
      adjudicator.testScore,
      feedbackCount,
      fixed(feedbackAverage, 2),
      fixed(score, 2),
      adjudicator.trainee ? "yes" : "no",
      adjudicator.independent ? "yes" : "no",
    ])
  );
}

function answerText(answer: FeedbackAnswer | undefined): string {
  if (answer === undefined || answer === null) return "";
  if (Array.isArray(answer)) return answer.join("; ");
  if (typeof answer === "boolean") return answer ? "yes" : "no";
  return String(answer);
}

export interface FeedbackCsvContext {
  rounds: Round[];
  questions: FeedbackQuestion[];
  adjudicators: Adjudicator[];
  teams: Team[];
}

/** Admin only: includes sources, comments and unconfirmed or ignored submissions. */
export function feedbackSubmissionsCsv(submissions: FeedbackSubmission[], context: FeedbackCsvContext): string {
  const roundsById = new Map(context.rounds.map((round) => [round.id, round]));
  const adjudicatorNames = new Map(context.adjudicators.map((adjudicator) => [adjudicator.id, adjudicator.name]));
  const teamNames = new Map(context.teams.map((team) => [team.id, team.name]));
  const questions = context.questions.filter(
    (question, index, all) => all.findIndex((candidate) => candidate.id === question.id) === index
  );
  const ordered = [...submissions].sort(
    (a, b) => (roundsById.get(a.roundId)?.seq ?? 0) - (roundsById.get(b.roundId)?.seq ?? 0) || a.timestamp.localeCompare(b.timestamp)
  );
  return toCsv(
    ["Round", "Target", "Target Type", "Source", "Source Type", "Score", "Agrees With Decision", "Confirmed", "Ignored", "Comments", ...questions.map((question) => question.label), "Submitted At"],
    ordered.map((item) => {
      const target = item.targetType === "team"
        ? item.targetTeamName ?? teamNames.get(item.targetTeamId ?? "")
        : item.targetAdjudicatorName ?? adjudicatorNames.get(item.targetAdjudicatorId ?? "");
      return [
        roundsById.get(item.roundId)?.abbreviation ?? roundsById.get(item.roundId)?.name,
        target,
        item.targetType ?? "adjudicator",
        item.sourceName || (item.sourceType === "team" ? teamNames.get(item.sourceId) : adjudicatorNames.get(item.sourceId)),
        item.sourceType,
        item.score,
        item.agreeWithDecision === undefined ? "" : item.agreeWithDecision ? "yes" : "no",
        item.confirmed ? "yes" : "no",
        item.ignored ? "yes" : "no",
        item.comments,
        ...questions.map((question) => answerText(item.answers?.[question.id])),
        item.timestamp,
      ];
    })
  );
}

/** A filesystem-safe file name stem from a tournament or round name. */
export function csvFileStem(...parts: string[]): string {
  return parts
    .map((part) => part.trim().replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, ""))
    .filter(Boolean)
    .join("_") || "export";
}
