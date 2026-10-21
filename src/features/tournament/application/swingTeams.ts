import type { Round, Speaker, Team, Tournament } from "@/types";
import { isAvailableForRound } from "@/lib/roundAvailability";
import { getEligibleTeamsForRound } from "@/lib/draw/generator";
import { teamsInDebateFor } from "@/lib/debateSides";

/**
 * Swing teams: a composite team formed for a round to fill a room when the field does not divide
 * into full debates (instead of, or as well as, automatic byes). Its speakers are reserves or
 * speakers of other teams; each gets its own speaker id, so their swing speeches never mix with
 * their own team's. The team is marked `isSwing`, is drawn only in its `swingRoundIds`, never
 * takes a bye, and is left out of team and speaker standings and breaks; its results still count
 * for its opponents. (Tabbycat has a swing team type but leaves the exclusion to the tab director:
 * break eligibility, duplicate speeches and "speeches missable".)
 */

export interface SwingSpeakerInput {
  name: string;
  /** The registered speaker standing in, if the speaker comes from another team. */
  sourceSpeakerId?: string;
}

export interface SwingTeamInput {
  name: string;
  speakers: SwingSpeakerInput[];
  round: Pick<Round, "id" | "stage">;
  teams: Team[];
  tournament: Pick<Tournament, "format" | "preferences">;
}

/** Teams that still need a debate in `round`: available, eligible and not divisible into full rooms. */
export function roundFieldSize(
  tournament: Pick<Tournament, "format" | "preferences">,
  round: Round,
  teams: Team[],
  now = Date.now()
): { available: number; teamsPerDebate: number; excess: number } {
  const teamsPerDebate = teamsInDebateFor(tournament);
  const available = getEligibleTeamsForRound(teams, round).filter((team) =>
    isAvailableForRound(team, round, tournament.preferences?.checkInExpiresAfterHours, now)
  ).length;
  return { available, teamsPerDebate, excess: available % teamsPerDebate };
}

/** Swing teams needed to fill the last room (0 when the field already divides evenly). */
export function swingTeamsNeeded(field: { teamsPerDebate: number; excess: number }): number {
  return field.excess === 0 ? 0 : field.teamsPerDebate - field.excess;
}

/** Checks a swing team request; returns the problems in words a tab director can act on. */
export function validateSwingTeam(input: SwingTeamInput): string[] {
  const problems: string[] = [];
  const name = input.name.trim();
  if (!name) problems.push("Give the swing team a name.");
  else if (input.teams.some((team) => team.name.trim().toLowerCase() === name.toLowerCase())) {
    problems.push(`A team called ${name} already exists.`);
  }
  if (input.round.stage !== "preliminary") problems.push("Swing teams can only debate in preliminary rounds.");
  const expected = input.tournament.preferences?.substantiveSpeakers ?? (input.tournament.format === "bp" ? 2 : 3);
  const speakers = input.speakers.filter((speaker) => speaker.name.trim());
  if (speakers.length !== expected) {
    problems.push(`A swing team needs ${expected} speaker${expected === 1 ? "" : "s"}; ${speakers.length} given.`);
  }
  const names = speakers.map((speaker) => speaker.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) problems.push("Each swing speaker must be a different person.");
  const knownSpeakers = new Set(input.teams.flatMap((team) => (team.speakers || []).map((speaker) => speaker.id)));
  for (const speaker of speakers) {
    if (speaker.sourceSpeakerId && !knownSpeakers.has(speaker.sourceSpeakerId)) {
      problems.push(`${speaker.name.trim()} is not a registered speaker.`);
    }
  }
  return problems;
}

/**
 * The new swing team, available for `round` only. Throws with the validation problems when the
 * request is invalid. `idFor` makes speaker ids (injected so tests are deterministic).
 */
export function buildSwingTeam(
  input: SwingTeamInput,
  idFor: (index: number) => string
): Omit<Team, "id" | "tournamentId"> {
  const problems = validateSwingTeam(input);
  if (problems.length > 0) throw new Error(problems.join(" "));
  const speakers: Speaker[] = input.speakers
    .filter((speaker) => speaker.name.trim())
    .map((speaker, index) => ({
      id: idFor(index),
      name: speaker.name.trim(),
      ...(speaker.sourceSpeakerId ? { swingSourceSpeakerId: speaker.sourceSpeakerId } : {}),
    }));
  return {
    name: input.name.trim(),
    speakers,
    breakCategories: [],
    speakerCategories: [],
    isSwing: true,
    swingRoundIds: [input.round.id],
    roundAvailability: { [input.round.id]: true },
  };
}

/** An existing swing team, also drawn (and available) in `round`. */
export function withSwingRound(team: Team, round: Pick<Round, "id" | "stage">): Team {
  if (!team.isSwing) throw new Error(`${team.name} is not a swing team.`);
  if (round.stage !== "preliminary") throw new Error("Swing teams can only debate in preliminary rounds.");
  if (team.swingRoundIds?.includes(round.id)) return team;
  return {
    ...team,
    swingRoundIds: [...(team.swingRoundIds ?? []), round.id],
    roundAvailability: { ...team.roundAvailability, [round.id]: true },
  };
}

/** A swing team no longer drawn in `round` (its other rounds are kept). */
export function withoutSwingRound(team: Team, round: Pick<Round, "id">): Team {
  return {
    ...team,
    swingRoundIds: (team.swingRoundIds ?? []).filter((id) => id !== round.id),
    roundAvailability: { ...team.roundAvailability, [round.id]: false },
  };
}
