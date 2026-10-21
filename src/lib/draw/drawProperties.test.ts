import { describe, expect, it } from "vitest";

import type {
  Adjudicator,
  BallotSubmission,
  ConflictAvoidance,
  Debate,
  OddBracketMethod,
  PairingMethod,
  Round,
  Team,
  Tournament,
  TournamentFormat,
  Venue,
} from "@/types";
import {
  makeAdjudicators,
  makeRound,
  makeTeams,
  makeTournament,
  makeVenues,
  simulateBallot,
  teamIdsInDebates,
} from "@/test/tournamentFixtures";
import { calculateStandings } from "@/lib/standings/calculator";
import { autoAllocateAdjudicators, buildPastAdjTeams } from "./allocator";
import { generateRoundDraw, getEligibleTeamsForRound } from "./generator";
import { createSeededRng, randomInt, shuffle, type Rng } from "./rng";
import { drawErrors, validateDraw } from "./validateDraw";

/**
 * Property-style checks: many tournaments built from deterministic seeds (odd team counts with
 * byes, divisions, withdrawn teams, institution clashes, venue requirements, enough rounds for
 * repeat matchups), each drawn, allocated and resulted round by round. Every generated draw must
 * pass validateDraw with no errors, and the same seed must reproduce the same draw.
 */

const SEEDS = Array.from({ length: 60 }, (_, index) => 1000 + index * 7919);
const PAIRING_METHODS: PairingMethod[] = ["slide", "fold", "adjacent", "random", "fold_top_adjacent_rest"];
const ODD_BRACKETS: OddBracketMethod[] = ["pullup_top", "pullup_bottom", "pullup_random", "intermediate", "intermediate_bubble"];
const CONFLICT_AVOIDANCE: ConflictAvoidance[] = ["off", "one_up_one_down", "min_cost"];
const NOW = Date.parse("2026-10-01T10:00:00.000Z");

interface Scenario {
  seed: number;
  tournament: Tournament;
  teams: Team[];
  adjudicators: Adjudicator[];
  venues: Venue[];
  roundCount: number;
  divisionId?: string;
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[randomInt(rng, items.length)];
}

function buildScenario(seed: number): Scenario {
  const rng = createSeededRng(seed);
  const format: TournamentFormat = seed % 2 === 0 ? "bp" : "wsdc";
  const isBP = format === "bp";
  const teamCount = isBP ? 8 + randomInt(rng, 17) : 6 + randomInt(rng, 13);
  const usesDivisions = !isBP && randomInt(rng, 4) === 0;
  const tournament = makeTournament(format, {
    byeTeamSelectionMethod: pick(rng, ["random", "lowest_ranked"] as const),
    byeTeamResults: pick(rng, ["absent", "win"] as const),
    sideAllocationRule: pick(rng, ["balanced", "balanced", "random"] as const),
    maxTimesPerSide: isBP ? 5 : 4,
    ...(isBP
      ? {}
      : {
          pairingMethod: pick(rng, PAIRING_METHODS),
          oddBracketMethod: pick(rng, ODD_BRACKETS),
          conflictAvoidance: pick(rng, CONFLICT_AVOIDANCE),
        }),
  }, `t-${seed}`);
  const teams = makeTeams(teamCount, {
    tournamentId: tournament.id,
    institutionCount: 3 + randomInt(rng, 4),
    speakersPerTeam: isBP ? 2 : 3,
    ...(usesDivisions ? { divisions: ["north", "south"] } : {}),
  });
  // A couple of withdrawals, and one team that needs an accessible room.
  const withdrawn = new Set(shuffle(teams, rng).slice(0, randomInt(rng, 3)).map((team) => team.id));
  const accessibleTeam = pick(rng, teams).id;
  const preparedTeams = teams.map((team) => ({
    ...team,
    checkedIn: !withdrawn.has(team.id),
    ...(team.id === accessibleTeam ? { venueRequirements: { accessible: true } } : {}),
  }));
  const rooms = Math.ceil(teamCount / (isBP ? 4 : 2));
  const venues = makeVenues(rooms + 2, tournament.id).map((venue, index) => ({
    ...venue,
    accessible: index % 3 === 0,
  }));
  const adjudicators = makeAdjudicators(rooms * (isBP ? 2 : 4), {
    tournamentId: tournament.id,
    institutionCount: 6,
    rng,
  });
  return {
    seed,
    tournament,
    teams: preparedTeams,
    adjudicators,
    venues,
    roundCount: isBP ? 4 : 5,
    divisionId: usesDivisions ? "north" : undefined,
  };
}

function allocate(scenario: Scenario, roundDebates: Debate[], pastDebates: Debate[]): Debate[] {
  const teamsById = new Map(scenario.teams.map((team) => [team.id, team]));
  const allocations = autoAllocateAdjudicators(
    roundDebates,
    teamsById,
    scenario.adjudicators,
    buildPastAdjTeams(pastDebates),
    {
      panelSize: scenario.tournament.format === "bp" ? 1 : 3,
      balancePanels: true,
      respectInstitutionConflicts: true,
      respectPersonalConflicts: true,
      respectHistoryConflicts: true,
      preferences: scenario.tournament.preferences,
    }
  );
  return roundDebates.map((debate, index) => ({
    ...debate,
    adjudicators: {
      chairId: allocations[index]?.chairId,
      chairName: allocations[index]?.chairName,
      panellistIds: allocations[index]?.panellistIds ?? [],
      panellistNames: allocations[index]?.panellistNames ?? [],
      traineeIds: allocations[index]?.traineeIds ?? [],
      traineeNames: allocations[index]?.traineeNames ?? [],
    },
  }));
}

function playPreliminaries(scenario: Scenario) {
  const { tournament, teams, venues } = scenario;
  const rng = createSeededRng(scenario.seed ^ 0x5bd1e995);
  const rounds: Round[] = [];
  let debates: Debate[] = [];
  let ballots: BallotSubmission[] = [];
  const drawsByRound: Debate[][] = [];
  for (let seq = 1; seq <= scenario.roundCount; seq++) {
    const round = makeRound(tournament.id, seq, scenario.divisionId ? { divisionId: scenario.divisionId } : {});
    rounds.push(round);
    const standings = calculateStandings(tournament, rounds, teams, debates, ballots).teams;
    const generated = generateRoundDraw({
      tournament,
      round,
      teams,
      venues,
      pastDebates: debates,
      standings,
      seed: scenario.seed + seq,
    });
    const allocated = allocate(scenario, generated, debates);
    drawsByRound.push(allocated);
    const issues = validateDraw({ tournament, round, rounds, debates: [...debates, ...allocated], teams, adjudicators: scenario.adjudicators, venues, now: NOW });
    expect(drawErrors(issues), `seed ${scenario.seed}, ${round.name}`).toEqual([]);
    debates = [...debates, ...allocated];
    ballots = [
      ...ballots,
      ...allocated
        .filter((debate) => !debate.byeTeamId)
        .map((debate) => simulateBallot(debate, teams, tournament, rng, { dissenters: randomInt(rng, 2) })),
    ];
    rounds[rounds.length - 1] = { ...round, completed: true };
  }
  return { rounds, debates, ballots, drawsByRound };
}

describe("generated draws over seeded random tournaments", () => {
  it.each(SEEDS)("seed %i: every preliminary draw passes the draw check", (seed) => {
    const scenario = buildScenario(seed);
    const { drawsByRound } = playPreliminaries(scenario);
    const round = makeRound(scenario.tournament.id, 1, scenario.divisionId ? { divisionId: scenario.divisionId } : {});
    const expected = getEligibleTeamsForRound(scenario.teams, round).filter((team) => team.checkedIn !== false);
    for (const draw of drawsByRound) {
      const placed = teamIdsInDebates(draw);
      // Every checked-in, eligible team is placed exactly once (a bye counts), and nobody else is.
      expect([...placed].sort()).toEqual(expected.map((team) => team.id).sort());
    }
  });

  it("the seeds cover byes, divisions, withdrawals, pull-ups and repeat matchups", () => {
    const seen = { byes: 0, divisions: 0, withdrawals: 0, pullups: 0, repeats: 0, bp: 0, twoTeam: 0 };
    for (const seed of SEEDS) {
      const scenario = buildScenario(seed);
      const { rounds, debates } = playPreliminaries(scenario);
      seen[scenario.tournament.format === "bp" ? "bp" : "twoTeam"] += 1;
      if (debates.some((debate) => debate.byeTeamId)) seen.byes += 1;
      if (scenario.divisionId) seen.divisions += 1;
      if (scenario.teams.some((team) => team.checkedIn === false)) seen.withdrawals += 1;
      if (debates.some((debate) => Object.values(debate.teams).some((slot) => slot?.pulledUp))) seen.pullups += 1;
      const last = rounds[rounds.length - 1];
      const issues = validateDraw({ ...scenario, round: last, rounds, debates, now: NOW });
      if (issues.some((issue) => issue.code === "repeat_matchup")) seen.repeats += 1;
    }
    for (const [property, count] of Object.entries(seen)) expect(count, property).toBeGreaterThan(2);
  });

  it.each(SEEDS.slice(0, 8))("seed %i: the same inputs and seed reproduce the same draws", (seed) => {
    const first = playPreliminaries(buildScenario(seed));
    const second = playPreliminaries(buildScenario(seed));
    expect(second.debates).toEqual(first.debates);
    expect(second.ballots).toEqual(first.ballots);
  });

  it.each(SEEDS.filter((seed) => seed % 2 === 1).slice(0, 6))(
    "seed %i: two-team elimination rounds (incl. partial eliminations) pass the draw check",
    (seed) => {
      const scenario = buildScenario(seed);
      const { rounds, debates, ballots } = playPreliminaries(scenario);
      const { tournament, venues } = scenario;
      const standings = calculateStandings(tournament, rounds, scenario.teams, debates, ballots).teams;
      // A 6-team break is a partial elimination: the top two seeds get byes into the semifinals.
      const breakSize = Math.min(6, standings.filter((row) => scenario.teams.find((team) => team.id === row.teamId)?.checkedIn).length);
      const breaking = new Set(
        standings
          .filter((row) => {
            const team = scenario.teams.find((item) => item.id === row.teamId)!;
            return team.checkedIn !== false && (!scenario.divisionId || team.divisionId === scenario.divisionId);
          })
          .slice(0, breakSize)
          .map((row) => row.teamId)
      );
      const teams = scenario.teams.map((team): Team => ({
        ...team,
        breakStatus: breaking.has(team.id) ? "breaking" : "eliminated",
        breakCategoryIds: breaking.has(team.id) ? ["open"] : [],
      }));
      const elimination = makeRound(tournament.id, rounds.length + 1, {
        stage: "elimination",
        drawType: "elimination",
        name: "Quarterfinals",
        breakCategoryIds: ["open"],
      });
      const draw = generateRoundDraw({
        tournament,
        round: elimination,
        teams,
        venues,
        pastDebates: debates,
        standings,
        seed,
      });
      const allocated = allocate({ ...scenario, teams }, draw, debates);
      const issues = validateDraw({
        tournament,
        round: elimination,
        rounds: [...rounds, elimination],
        debates: [...debates, ...allocated],
        teams,
        adjudicators: scenario.adjudicators,
        venues,
        now: NOW,
      });
      expect(drawErrors(issues)).toEqual([]);
      expect(teamIdsInDebates(allocated).sort()).toEqual([...breaking].sort());
      if (breaking.size === 6) expect(allocated.filter((debate) => debate.byeTeamId)).toHaveLength(2);
    }
  );
});
