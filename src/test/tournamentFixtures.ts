import type {
  Adjudicator,
  AdjudicatorSheet,
  BallotSubmission,
  Debate,
  DebateSide,
  Round,
  RoundStage,
  SpeakerScoreEntry,
  Team,
  Tournament,
  TournamentFormat,
  TournamentPreferences,
  Venue,
} from "@/types";
import {
  ballotSides,
  buildBallotResult,
  replySpeechesEnabled,
  substantiveSpeakerCount,
  usesVotingBallots,
  validateBallotEntry,
  type BallotEntry,
  type BallotRules,
} from "@/lib/ballots/result";
import { randomInt, shuffle, type Rng } from "@/lib/draw/rng";

/**
 * Deterministic builders for tests that drive whole tournaments: no clocks, no Math.random. Every
 * random choice goes through a seeded Rng from the caller.
 */

export const FIXED_TIME = "2026-10-01T09:00:00.000Z";

export function makePreferences(
  format: TournamentFormat,
  overrides: Partial<TournamentPreferences> = {}
): TournamentPreferences {
  const isBP = format === "bp";
  return {
    teamsInDebate: isBP ? 4 : 2,
    substantiveSpeakers: isBP ? 2 : 3,
    replyScoresEnabled: !isBP,
    minSpeakerScore: isBP ? 50 : 60,
    maxSpeakerScore: isBP ? 100 : 80,
    stepSpeakerScore: isBP ? 1 : 0.5,
    minReplyScore: 30,
    maxReplyScore: 40,
    drawRule: "power_paired",
    sideAllocationRule: "balanced",
    ballotDoubleEntry: false,
    publicDraw: true,
    publicResults: true,
    publicStandings: true,
    publicMotions: true,
    feedbackEnabled: false,
    feedbackMinScore: 1,
    feedbackMaxScore: 5,
    ...overrides,
  };
}

export function makeTournament(
  format: TournamentFormat,
  overrides: Partial<TournamentPreferences> = {},
  id = `t-${format}`
): Tournament {
  return {
    id,
    name: `${format.toUpperCase()} Open`,
    shortName: format.toUpperCase(),
    slug: `${format}-open`,
    format,
    active: true,
    ownerId: "owner",
    admins: { owner: true },
    preferences: makePreferences(format, overrides),
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  };
}

export function makeRound(
  tournamentId: string,
  seq: number,
  overrides: Partial<Round> & { stage?: RoundStage } = {}
): Round {
  return {
    id: `round-${tournamentId}-${seq}`,
    tournamentId,
    seq,
    name: `Round ${seq}`,
    abbreviation: `R${seq}`,
    stage: "preliminary",
    drawType: seq === 1 ? "random" : "power_paired",
    drawStatus: "none",
    feedbackWeight: 1,
    silent: false,
    motionsReleased: false,
    resultsReleased: false,
    completed: false,
    createdAt: FIXED_TIME,
    ...overrides,
  };
}

export interface TeamFixtureOptions {
  tournamentId: string;
  institutionCount?: number;
  speakersPerTeam?: number;
  divisions?: string[];
  prefix?: string;
}

export function makeTeams(count: number, options: TeamFixtureOptions): Team[] {
  const { tournamentId, institutionCount = 0, speakersPerTeam = 3, divisions, prefix = "team" } = options;
  return Array.from({ length: count }, (_, index) => {
    const id = `${prefix}-${index + 1}`;
    const institution = institutionCount > 0 ? index % institutionCount : undefined;
    return {
      id,
      tournamentId,
      name: `Team ${String(index + 1).padStart(2, "0")}`,
      speakers: Array.from({ length: speakersPerTeam }, (_, speaker) => ({
        id: `${id}-s${speaker + 1}`,
        name: `Speaker ${index + 1}.${speaker + 1}`,
      })),
      breakCategories: [],
      speakerCategories: [],
      checkedIn: true,
      ...(institution !== undefined
        ? { institutionId: `inst-${institution + 1}`, institutionName: `Institution ${institution + 1}` }
        : {}),
      ...(divisions ? { divisionId: divisions[index % divisions.length] } : {}),
    };
  });
}

export function makeAdjudicators(
  count: number,
  options: { tournamentId: string; institutionCount?: number; rng?: Rng; traineeEvery?: number }
): Adjudicator[] {
  const { tournamentId, institutionCount = 0, rng, traineeEvery = 0 } = options;
  return Array.from({ length: count }, (_, index) => {
    // Every other adjudicator is independent, so a conflict-free allocation always exists.
    const institution = institutionCount > 0 && index % 2 === 1 ? index % institutionCount : undefined;
    return {
      id: `adj-${index + 1}`,
      tournamentId,
      name: `Adjudicator ${String(index + 1).padStart(2, "0")}`,
      baseScore: rng ? 2 + randomInt(rng, 7) : 5,
      trainee: traineeEvery > 0 && (index + 1) % traineeEvery === 0,
      independent: institution === undefined,
      checkedIn: true,
      conflicts: [],
      ...(institution !== undefined
        ? { institutionId: `inst-${institution + 1}`, institutionName: `Institution ${institution + 1}` }
        : {}),
    };
  });
}

export function makeVenues(count: number, tournamentId: string): Venue[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `venue-${index + 1}`,
    tournamentId,
    name: `Room ${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) : ""}`,
    priority: count - index,
    available: true,
  }));
}

export function rulesFor(tournament: Tournament): BallotRules {
  return { format: tournament.format, preferences: tournament.preferences };
}

/** A scoresheet in which side order `ranking[0]` beats `ranking[1]` and so on, with ghost/reply rules respected. */
function sheetScores(
  debate: Debate,
  teamsById: Map<string, Team>,
  ranking: DebateSide[],
  rules: BallotRules,
  rng: Rng,
  ironPersonSide?: DebateSide
): Record<DebateSide, SpeakerScoreEntry[]> {
  const substantive = substantiveSpeakerCount(rules);
  const minimum = rules.preferences?.minSpeakerScore ?? 60;
  const maximum = rules.preferences?.maxSpeakerScore ?? 80;
  const scores = {} as Record<DebateSide, SpeakerScoreEntry[]>;
  ranking.forEach((side, place) => {
    const team = teamsById.get(debate.teams[side]!.teamId)!;
    // Separate bands per place so totals are strictly ordered and never tied.
    const base = maximum - 4 - place * 3;
    const entries: SpeakerScoreEntry[] = Array.from({ length: substantive }, (_, index) => {
      const speaker = ironPersonSide === side && index === substantive - 1 ? team.speakers[0] : team.speakers[index];
      return {
        speakerId: speaker.id,
        speakerName: speaker.name,
        position: index + 1,
        score: Math.max(minimum, base - (randomInt(rng, 2) === 0 ? 0 : 1)),
      };
    });
    if (replySpeechesEnabled(rules)) {
      entries.push({
        speakerId: team.speakers[0].id,
        speakerName: team.speakers[0].name,
        position: substantive + 1,
        score: (rules.preferences?.maxReplyScore ?? 40) - 1 - place,
      });
    }
    scores[side] = entries;
  });
  return scores;
}

export interface SimulatedBallotOptions {
  id?: string;
  version?: number;
  confirmed?: boolean;
  /**
   * Side whose last substantive speech is given again by its first speaker (an iron-person speech).
   * That side places last, since the repeated speech does not count towards its total.
   */
  ironPersonSide?: DebateSide;
  forfeitSide?: DebateSide;
  submitterId?: string;
  submitterType?: BallotSubmission["submitterType"];
  /** Voting ballots: number of dissenting sheets (each sheet otherwise agrees with the result). */
  dissenters?: number;
  timestamp?: string;
}

/**
 * Builds a ballot through the same validation and result assembly as the tab-room form, so the
 * stored scores follow every ballot rule (ghosts, replies, voting majorities, forfeits).
 */
export function simulateBallot(
  debate: Debate,
  teams: Team[],
  tournament: Tournament,
  rng: Rng,
  options: SimulatedBallotOptions = {}
): BallotSubmission {
  const rules = rulesFor(tournament);
  const sides = ballotSides(tournament.format);
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const teamIds = Object.fromEntries(sides.map((side) => [side, debate.teams[side]?.teamId]));
  const shuffled = shuffle(sides, rng);
  // A ghost speech does not count towards the team total, so the iron-person team places last.
  const ranking = options.ironPersonSide
    ? [...shuffled.filter((side) => side !== options.ironPersonSide), options.ironPersonSide]
    : shuffled;
  let entry: BallotEntry;
  if (options.forfeitSide) {
    entry = { speakerScores: {}, forfeitSide: options.forfeitSide };
  } else if (usesVotingBallots(rules)) {
    const voters = [debate.adjudicators.chairId, ...debate.adjudicators.panellistIds].filter(
      (id): id is string => Boolean(id)
    );
    if (voters.length === 0) throw new Error(`Debate ${debate.id} has no voting adjudicators.`);
    const dissenters = Math.min(options.dissenters ?? 0, Math.floor((voters.length - 1) / 2));
    const sheets: AdjudicatorSheet[] = voters.map((adjudicatorId, index) => ({
      adjudicatorId,
      speakerScores: sheetScores(
        debate,
        teamsById,
        index >= voters.length - dissenters ? [...ranking].reverse() : ranking,
        rules,
        rng,
        options.ironPersonSide
      ),
    }));
    entry = { speakerScores: sheets[0].speakerScores, sheets };
  } else {
    const speakerScores = sheetScores(debate, teamsById, ranking, rules, rng, options.ironPersonSide);
    entry = {
      speakerScores,
      ranks: Object.fromEntries(ranking.map((side, index) => [side, index + 1])),
    };
  }
  const rosters = Object.fromEntries(sides.map((side) => [side, teamsById.get(teamIds[side] ?? "")?.speakers ?? []]));
  if (options.ironPersonSide) {
    // The form marks the repeat speech as a ghost before validation.
    for (const sheet of entry.sheets ?? [{ speakerScores: entry.speakerScores }]) {
      const repeated = sheet.speakerScores[options.ironPersonSide]?.find(
        (speech, index, all) => all.findIndex((other) => other.speakerId === speech.speakerId) !== index &&
          speech.position <= substantiveSpeakerCount(rules)
      );
      if (repeated) repeated.ghost = true;
    }
  }
  const errors = validateBallotEntry(entry, { ...rules, rosters });
  if (errors.length > 0) throw new Error(`Simulated ballot for ${debate.id} is invalid: ${errors.join(" ")}`);
  const result = buildBallotResult(entry, teamIds, debate.adjudicators.chairId, rules);
  const version = options.version ?? 1;
  return {
    id: options.id ?? `ballot-${debate.id}-v${version}`,
    tournamentId: tournament.id,
    roundId: debate.roundId,
    debateId: debate.id,
    version,
    confirmed: options.confirmed ?? true,
    discarded: false,
    submitterType: options.submitterType ?? "tabroom",
    ...(options.submitterId ? { submitterId: options.submitterId } : {}),
    speakerScores: result.speakerScores,
    teamScores: result.teamScores,
    ...(result.sheets ? { sheets: result.sheets } : {}),
    ...(options.forfeitSide ? { forfeitSide: options.forfeitSide } : {}),
    chairId: debate.adjudicators.chairId,
    timestamp: options.timestamp ?? FIXED_TIME,
  };
}

/** Team ids in each debate (bye debates included), for invariant checks. */
export function teamIdsInDebates(debates: Debate[]): string[] {
  return debates.flatMap((debate) =>
    debate.byeTeamId
      ? [debate.byeTeamId]
      : Object.values(debate.teams).map((slot) => slot?.teamId).filter((id): id is string => Boolean(id))
  );
}

export function adjudicatorIdsInDebates(debates: Debate[]): string[] {
  return debates.flatMap((debate) => [
    ...(debate.adjudicators.chairId ? [debate.adjudicators.chairId] : []),
    ...debate.adjudicators.panellistIds,
    ...debate.adjudicators.traineeIds,
  ]);
}
