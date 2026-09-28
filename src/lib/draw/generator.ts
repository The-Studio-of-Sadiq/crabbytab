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

export interface GenerateDrawParams {
  tournament: Tournament;
  round: Round;
  teams: Team[];
  venues: Venue[];
  pastDebates: Debate[];
  standings: TeamStandingRow[];
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
  const activeTeams = teams.filter((t) => t.checkedIn !== false);
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

  let debateDrafts: {
    bracket: number;
    teamsWithSides: Record<DebateSide, Team>;
  }[] = [];

  if (round.seq === 1 || round.drawType === "random") {
    // Round 1 or Random: Shuffle teams randomly
    const shuffled = [...activeTeams].sort(() => Math.random() - 0.5);
    const numDebates = shuffled.length / teamsPerDebate;

    for (let i = 0; i < numDebates; i++) {
      const group = shuffled.slice(i * teamsPerDebate, (i + 1) * teamsPerDebate);
      const sideRule = tournament.preferences?.sideAllocationRule || "balanced";
      const teamsWithSides = allocateSidesForDebate(group, history.sides, tournament.format, sideRule);
      debateDrafts.push({
        bracket: 0,
        teamsWithSides,
      });
    }
  } else {
    // Power-paired Swiss draw for subsequent preliminary rounds
    const sideRule = tournament.preferences?.sideAllocationRule || "balanced";
    const powerDraw = generatePowerPairedDraw(activeTeams, standings, history, tournament.format, sideRule);
    debateDrafts = powerDraw.map((p) => ({
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
