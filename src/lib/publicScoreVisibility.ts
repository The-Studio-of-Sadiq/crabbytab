import { Round } from "@/types";

export function canShowAggregateTeamScores(rounds: Round[]): boolean {
  const publicRounds = rounds.filter((round) => round.resultsReleased && !round.silent);
  return publicRounds.length > 0 && publicRounds.every((round) => round.teamSpeaksReleased === true);
}