import type { DrawType, Round, RoundStage } from "@/types";

interface CreateRoundRecordInput {
  tournamentId: string;
  roundSeq: number;
  name: string;
  abbr: string;
  stage: RoundStage;
  customDrawType?: DrawType;
  defaultDrawRule?: DrawType | "bracket";
}

export function createRoundRecord({
  tournamentId,
  roundSeq,
  name,
  abbr,
  stage,
  customDrawType,
  defaultDrawRule = "power_paired",
}: CreateRoundRecordInput): Round {
  const normalizedDefaultRule = defaultDrawRule === "bracket" ? "random" : defaultDrawRule;
  const mappedDrawType: DrawType =
    customDrawType ||
    (roundSeq === 1 && normalizedDefaultRule === "power_paired" ? "random" : (normalizedDefaultRule as DrawType));

  return {
    id: `round-${tournamentId}-${roundSeq}`,
    tournamentId,
    seq: roundSeq,
    name,
    abbreviation: abbr,
    stage,
    drawType: mappedDrawType,
    drawStatus: "none",
    feedbackWeight: 1.0,
    silent: false,
    motionsReleased: false,
    resultsReleased: false,
    teamSpeaksReleased: false,
    completed: false,
    createdAt: new Date().toISOString(),
  };
}

export function getRoundChangeSummary(previous: Round, next: Round) {
  const trackedFields = [
    "drawStatus",
    "adjudicatorsRevealed",
    "completed",
    "resultsReleased",
    "teamSpeaksReleased",
    "motionsReleased",
    "silent",
    "cancelled",
  ] as const;

  return Object.fromEntries(
    trackedFields
      .filter((field) => previous[field] !== next[field])
      .map((field) => [field, { from: previous[field], to: next[field] }])
  );
}
