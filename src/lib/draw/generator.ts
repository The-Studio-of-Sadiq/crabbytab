import {
  Tournament,
  Round,
  Team,
  Venue,
  Debate,
  DebateSide,
  DebateResultStatus,
  TeamStandingRow,
  BPSide,
  TwoTeamSide,
} from "@/types";
import { generatePowerPairedDraw, MatchupHistory } from "./powerPaired";
import { allocateSidesForDebate } from "./sideAllocator";
import { generateRoundRobinDraw } from "./roundRobin";
import { generateTwoTeamDraw } from "./twoTeamDraw";

export interface GenerateDrawParams {
  tournament: Tournament;
  round: Round;
  teams: Team[];
  venues: Venue[];
  pastDebates: Debate[];
  standings: TeamStandingRow[];
}

export function getEligibleTeamsForRound(teams: Team[], round: Round | null): Team[] {
  if (!round || round.stage !== "elimination") return teams;

  const breakHasBeenGenerated = teams.some((team) => team.breakCategoryIds !== undefined);
  if (!breakHasBeenGenerated) return teams;

  const { breakCategoryId } = round;
  if (breakCategoryId) {
    return teams.filter((team) => team.breakCategoryIds?.includes(breakCategoryId));
  }

  return teams.filter((team) => team.breakStatus === "breaking");
}

/**
 * Builds historical matchup graph and side histories from all completed debates.
 */
export function buildMatchupHistory(debates: Debate[]): MatchupHistory {
  const opponents = new Map<string, Set<string>>();
  const sides = new Map<string, DebateSide[]>();

  for (const d of debates) {
    const teamSlots = Object.values(d.teams).filter((t) => t && t.teamId);
    for (let i = 0; i < teamSlots.length; i++) {
      const t1 = teamSlots[i];
      if (!opponents.has(t1.teamId)) opponents.set(t1.teamId, new Set());
      if (!sides.has(t1.teamId)) sides.set(t1.teamId, []);

      sides.get(t1.teamId)!.push(t1.side);

      for (let j = 0; j < teamSlots.length; j++) {
        if (i !== j) {
          opponents.get(t1.teamId)!.add(teamSlots[j].teamId);
        }
      }
    }
  }

  return { opponents, sides };
}

/**
 * Master draw generator function for any tournament round.
 */
export function generateRoundDraw(params: GenerateDrawParams): Debate[] {
  const { tournament, round, teams, venues, pastDebates, standings } = params;
  const isBP = tournament.format === "bp";
  const teamsPerDebate = isBP ? 4 : 2;

  // Filter checked-in teams (or all active if checkins aren't used)
  const activeTeams = getEligibleTeamsForRound(teams, round).filter((t) => t.checkedIn !== false);
  const totalTeams = activeTeams.length;

  if (totalTeams < teamsPerDebate) {
    throw new Error(`At least ${teamsPerDebate} teams are required to generate a draw.`);
  }

  if (totalTeams % teamsPerDebate !== 0) {
    throw new Error(
      `Number of teams (${totalTeams}) must be divisible by ${teamsPerDebate} for ${tournament.format.toUpperCase()} format.`
    );
  }

  const history = buildMatchupHistory(pastDebates);
  const sortedVenues = [...venues].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const sideRule = tournament.preferences?.sideAllocationRule || "balanced";

  // Handle Manual draw: create empty debates with room ranks and venues
  if (round.drawType === "manual") {
    const numDebates = totalTeams / teamsPerDebate;
    const debates: Debate[] = [];
    const sidesList: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];

    for (let idx = 0; idx < numDebates; idx++) {
      const venue = sortedVenues[idx];
      const emptyTeamsSlot: Record<string, any> = {};
      sidesList.forEach((s) => {
        emptyTeamsSlot[s] = {
          teamId: "",
          teamName: "Unassigned",
          side: s,
        };
      });

      const debateObj: Debate = {
        id: `debate-${round.id}-${idx + 1}`,
        tournamentId: tournament.id,
        roundId: round.id,
        roundSeq: round.seq,
        venueName: venue?.name || `Room ${idx + 1}`,
        bracket: 0,
        roomRank: idx + 1,
        importance: 0,
        resultStatus: "none" as DebateResultStatus,
        sidesConfirmed: false,
        flags: [],
        teams: emptyTeamsSlot as Record<DebateSide, any>,
        adjudicators: {
          panellistIds: [],
          panellistNames: [],
          traineeIds: [],
          traineeNames: [],
        },
      };

      if (venue?.id) {
        debateObj.venueId = venue.id;
      }
      debates.push(debateObj);
    }

    return debates;
  }

  let debateDrafts: {
    bracket: number;
    teamsWithSides: Record<DebateSide, Team>;
  }[] = [];

  if (round.drawType === "round_robin") {
    if (isBP) {
      throw new Error("Round-robin scheduling is only supported for two-team formats.");
    }
    const rrMatchups = generateRoundRobinDraw(activeTeams, round.seq, history.sides, tournament.format, sideRule);
    debateDrafts = rrMatchups;
  } else if (
    round.drawType === "random" ||
    round.seq === 1 ||
    !standings ||
    standings.length === 0 ||
    standings.every((s) => s.points === 0 && s.totalSpeakerScore === 0)
  ) {
    // Round 1, random drawType, or no standings yet: Shuffle teams randomly
    const shuffled = [...activeTeams].sort(() => Math.random() - 0.5);
    const numDebates = shuffled.length / teamsPerDebate;

    for (let i = 0; i < numDebates; i++) {
      const group = shuffled.slice(i * teamsPerDebate, (i + 1) * teamsPerDebate);
      const teamsWithSides = allocateSidesForDebate(group, history.sides, tournament.format, sideRule);
      debateDrafts.push({
        bracket: 0,
        teamsWithSides,
      });
    }
  } else if (isBP) {
    // BP keeps its cost-based clash-minimizing approach, with configurable penalties.
    const penalties = {
      repeatMatchupPenalty: tournament.preferences?.repeatMatchupPenalty ?? 1000,
      institutionClashPenalty: tournament.preferences?.institutionClashPenalty ?? 200,
    };
    const powerDraw = generatePowerPairedDraw(activeTeams, standings, history, tournament.format, sideRule, penalties);
    debateDrafts = powerDraw.map((p) => ({
      bracket: p.bracket,
      teamsWithSides: p.teamsWithSides,
    }));
  } else {
    // Two-team formats: full C2 pipeline (bracket by wins -> resolve odd brackets
    // -> pair -> avoid conflicts -> allocate sides), each stage configurable.
    const twoTeamDraw = generateTwoTeamDraw(activeTeams, standings, history, tournament.format, {
      pairingMethod: tournament.preferences?.pairingMethod,
      oddBracketMethod: tournament.preferences?.oddBracketMethod,
      conflictAvoidance: tournament.preferences?.conflictAvoidance,
      pullupRestriction: tournament.preferences?.pullupRestriction,
      sideRule,
    });
    debateDrafts = twoTeamDraw.map((p) => ({
      bracket: p.bracket,
      teamsWithSides: p.teamsWithSides,
    }));
  }

  // Map drafts to complete Debate objects with venues and adjudicator slots
  return debateDrafts.map((draft, idx) => {
    const venue = sortedVenues[idx];
    const teamsSlotRecord: Record<string, any> = {};

    Object.entries(draft.teamsWithSides).forEach(([side, team]) => {
      teamsSlotRecord[side] = {
        teamId: team.id,
        teamName: team.name,
        side: side as DebateSide,
      };
    });

    const debateObj: Debate = {
      id: `debate-${round.id}-${idx + 1}`,
      tournamentId: tournament.id,
      roundId: round.id,
      roundSeq: round.seq,
      venueName: venue?.name || `Room ${idx + 1}`,
      bracket: draft.bracket,
      roomRank: idx + 1,
      importance: 0,
      resultStatus: "none" as DebateResultStatus,
      sidesConfirmed: true,
      flags: [],
      teams: teamsSlotRecord as Record<DebateSide, any>,
      adjudicators: {
        panellistIds: [],
        panellistNames: [],
        traineeIds: [],
        traineeNames: [],
      },
    };

    if (venue?.id) {
      debateObj.venueId = venue.id;
    }

    return debateObj;
  });
}
