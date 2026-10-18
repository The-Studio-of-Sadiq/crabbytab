import { ballotMatchesDebate } from "@/lib/ballots/result";
import { Team, Debate, BallotSubmission, DebateSide, DebateTeamSlot, TournamentFormat } from "@/types";

export interface EliminationRoomDraft {
  roomNumber: number;
  bracketName: string;
  teams: { team: Team; seed: number; side: DebateSide }[];
}

export function applyEliminationAdvancement(
  teams: Team[],
  debates: Debate[],
  advancingTeamIds: Set<string>,
  roundId: string
): Team[] {
  const participatingTeamIds = new Set(
    debates.flatMap((debate) => Object.values(debate.teams).map((slot) => slot?.teamId).filter(Boolean))
  );

  return teams.map((team) => {
    if (!participatingTeamIds.has(team.id)) return team;
    if (advancingTeamIds.has(team.id)) {
      return team.eliminatedInRoundId === roundId
        ? { ...team, breakStatus: "breaking", eliminatedInRoundId: undefined }
        : team;
    }
    return { ...team, breakStatus: "eliminated", eliminatedInRoundId: roundId };
  });
}

export function getAdvancingTeamIds(
  debates: Debate[],
  ballots: BallotSubmission[],
  format: TournamentFormat,
  isFinalRound = false
): Set<string> {
  const ballotByDebateId = new Map(
    ballots.filter((ballot) => ballot.confirmed && !ballot.discarded).map((ballot) => [ballot.debateId, ballot])
  );
  const advancingTeamIds = new Set<string>();

  for (const debate of debates) {
    // Partial-elimination byes advance without a ballot.
    if (debate.byeTeamId) {
      advancingTeamIds.add(debate.byeTeamId);
      continue;
    }
    const ballot = ballotByDebateId.get(debate.id);
    if (!ballot) throw new Error(`A confirmed ballot is required for ${debate.venueName || debate.id}.`);
    if (!ballotMatchesDebate(ballot, debate)) {
      throw new Error(
        `The confirmed ballot for ${debate.venueName || debate.id} names different teams from the draw. ` +
        "Re-enter the ballot for the current matchup."
      );
    }

    for (const [side, slot] of Object.entries(debate.teams)) {
      if (!slot?.teamId) continue;
      const score = ballot.teamScores[side as DebateSide];
      if (!score) throw new Error(`A confirmed team result is missing for ${slot.teamName || slot.teamId}.`);

      const advances = format === "bp"
        ? (score.rank !== undefined ? score.rank <= (isFinalRound ? 1 : 2) : score.points >= (isFinalRound ? 3 : 2))
        : (score.win ?? (score.rank === 1 || score.points === 1));
      if (advances) advancingTeamIds.add(slot.teamId);
    }
  }

  return advancingTeamIds;
}

/**
 * Standard seeded elimination brackets for British Parliamentary and 2-Team tournaments.
 */
export function generateEliminationDraw(
  breakingTeams: { team: Team; seed: number }[],
  format: TournamentFormat,
  bracketSize: number // 16, 8, 4, 2
): EliminationRoomDraft[] {
  const isBP = format === "bp";
  const bpSides: DebateSide[] = ["OG", "OO", "CG", "CO"];
  const twoTeamSides: DebateSide[] = ["AFF", "NEG"];

  if (isBP) {
    if (bracketSize === 16) {
      // 4 Quarter-final rooms of 4 teams each
      const roomSeedings = [
        [1, 8, 9, 16],
        [4, 5, 12, 13],
        [2, 7, 10, 15],
        [3, 6, 11, 14],
      ];

      return roomSeedings.map((seeds, rIdx) => {
        const roomTeams = seeds.map((s, sIdx) => {
          const entry = breakingTeams.find((b) => b.seed === s);
          return {
            team: entry?.team || ({ id: `t-placeholder-${s}`, name: `Seed ${s}`, breakCategories: [], speakers: [] } as any),
            seed: s,
            side: bpSides[sIdx % 4],
          };
        });

        return {
          roomNumber: rIdx + 1,
          bracketName: `Quarter-Final Room ${rIdx + 1}`,
          teams: roomTeams,
        };
      });
    } else if (bracketSize === 8) {
      // 2 Semi-final rooms of 4 teams each
      const roomSeedings = [
        [1, 4, 5, 8],
        [2, 3, 6, 7],
      ];

      return roomSeedings.map((seeds, rIdx) => {
        const roomTeams = seeds.map((s, sIdx) => {
          const entry = breakingTeams.find((b) => b.seed === s);
          return {
            team: entry?.team || ({ id: `t-placeholder-${s}`, name: `Seed ${s}`, breakCategories: [], speakers: [] } as any),
            seed: s,
            side: bpSides[sIdx % 4],
          };
        });

        return {
          roomNumber: rIdx + 1,
          bracketName: `Semi-Final Room ${rIdx + 1}`,
          teams: roomTeams,
        };
      });
    } else if (bracketSize === 4) {
      // Grand Final
      const roomTeams = [1, 2, 3, 4].map((s, sIdx) => {
        const entry = breakingTeams.find((b) => b.seed === s);
        return {
          team: entry?.team || ({ id: `t-placeholder-${s}`, name: `Seed ${s}`, breakCategories: [], speakers: [] } as any),
          seed: s,
          side: bpSides[sIdx % 4],
        };
      });

      return [
        {
          roomNumber: 1,
          bracketName: "Grand Final",
          teams: roomTeams,
        },
      ];
    }

    if (bracketSize >= 4 && bracketSize % 4 === 0 && (bracketSize & (bracketSize - 1)) === 0) {
      const roomCount = bracketSize / 4;
      const roomSeeds = Array.from({ length: roomCount }, () => [] as number[]);
      for (let seed = 1; seed <= bracketSize; seed++) {
        const row = Math.floor((seed - 1) / roomCount);
        const offset = (seed - 1) % roomCount;
        const roomIndex = row % 2 === 0 ? offset : roomCount - offset - 1;
        roomSeeds[roomIndex].push(seed);
      }

      return roomSeeds.map((seeds, roomIndex) => ({
        roomNumber: roomIndex + 1,
        bracketName: `Elimination Room ${roomIndex + 1}`,
        teams: seeds.map((seed, seat) => ({
          team: breakingTeams.find((entry) => entry.seed === seed)?.team || ({
            id: `t-placeholder-${seed}`,
            name: `Seed ${seed}`,
            breakCategories: [],
            speakers: [],
          } as any),
          seed,
          side: bpSides[seat],
        })),
      }));
    }
  } else {
    // 2-Team Format (UADC / Australs / WSDC)
    const pairs: [number, number][] = [];
    if (bracketSize === 16) {
      pairs.push([1, 16], [8, 9], [4, 13], [5, 12], [2, 15], [7, 10], [3, 14], [6, 11]);
    } else if (bracketSize === 8) {
      pairs.push([1, 8], [4, 5], [2, 7], [3, 6]);
    } else if (bracketSize === 4) {
      pairs.push([1, 4], [2, 3]);
    } else if (bracketSize === 2) {
      pairs.push([1, 2]);
    }

    if (pairs.length === 0 && bracketSize >= 2 && (bracketSize & (bracketSize - 1)) === 0) {
      for (let seed = 1; seed <= bracketSize / 2; seed++) {
        pairs.push([seed, bracketSize + 1 - seed]);
      }
    }

    if (pairs.length === 0) {
      throw new Error(`A full two-team elimination bracket cannot be built for ${bracketSize} teams.`);
    }
    return pairs.map(([s1, s2], idx) => {
      const e1 = breakingTeams.find((b) => b.seed === s1);
      const e2 = breakingTeams.find((b) => b.seed === s2);
      return {
        roomNumber: idx + 1,
        bracketName: `Elimination Match ${idx + 1}`,
        teams: [
          {
            team: e1?.team || ({ id: `t-${s1}`, name: `Seed ${s1}`, breakCategories: [], speakers: [] } as any),
            seed: s1,
            side: "AFF",
          },
          {
            team: e2?.team || ({ id: `t-${s2}`, name: `Seed ${s2}`, breakCategories: [], speakers: [] } as any),
            seed: s2,
            side: "NEG",
          },
        ],
      };
    });
  }

  throw new Error(
    `A full ${isBP ? "BP" : "two-team"} elimination bracket cannot be built for ${bracketSize} teams.`
  );
}

/* -------------------------------------------------------------------------- */
/* Partial eliminations and bracket positions                                 */
/* -------------------------------------------------------------------------- */

export interface PositionedTeam {
  team: Team;
  /** Bracket position: the break seed in the first elimination round, inherited afterwards. */
  position: number;
}

export interface PlannedEliminationRoom {
  roomNumber: number;
  bracketName: string;
  teams: { team: Team; seed: number; side: DebateSide; position: number }[];
}

export interface EliminationRoundPlan {
  rooms: PlannedEliminationRoom[];
  /** Top seeds that skip a partial elimination round and join the next one. */
  byes: PositionedTeam[];
}

function teamsPerRoom(format: TournamentFormat): 2 | 4 {
  return format === "bp" ? 4 : 2;
}

/** A field that halves cleanly every round: 2^k for two-team formats, 4 x 2^k for BP. */
export function isFullEliminationField(teamCount: number, format: TournamentFormat): boolean {
  const roomSize = teamsPerRoom(format);
  if (!Number.isInteger(teamCount) || teamCount < roomSize) return false;
  const rooms = teamCount / roomSize;
  if (format === "bp") return Number.isInteger(rooms) && (rooms & (rooms - 1)) === 0;
  return (teamCount & (teamCount - 1)) === 0;
}

/** Returns an error message, or "" when this many teams can play an elimination round. */
export function validateEliminationField(teamCount: number, format: TournamentFormat): string {
  if (!Number.isInteger(teamCount)) return "The number of teams must be a whole number.";
  if (format === "bp") {
    if (teamCount < 4) return `A BP elimination round needs at least 4 teams; ${teamCount} are eligible.`;
    if (teamCount % 2 !== 0) {
      return `A BP elimination round needs an even number of teams (two advance from each room); ${teamCount} are eligible.`;
    }
    return "";
  }
  if (teamCount < 2) return `An elimination round needs at least 2 teams; ${teamCount} are eligible.`;
  return "";
}

/** The largest full field strictly below `teamCount` (the size a partial round reduces to). */
function partialTarget(teamCount: number, format: TournamentFormat): number {
  let target = teamsPerRoom(format);
  while (target * 2 < teamCount) target *= 2;
  return target;
}

/**
 * Number of top seeds that skip this round. A full field has none; otherwise
 * (Tabbycat-style partial elimination) the top `2T - N` seeds advance
 * directly, where T is the full field size below N.
 */
export function eliminationByeCount(teamCount: number, format: TournamentFormat): number {
  if (validateEliminationField(teamCount, format) || isFullEliminationField(teamCount, format)) return 0;
  return 2 * partialTarget(teamCount, format) - teamCount;
}

/** Number of rooms an elimination round of `teamCount` teams needs (0 when it cannot be drawn). */
export function eliminationRoomCount(teamCount: number, format: TournamentFormat): number {
  if (validateEliminationField(teamCount, format)) return 0;
  return (teamCount - eliminationByeCount(teamCount, format)) / teamsPerRoom(format);
}

/**
 * Plans one elimination round from teams with bracket positions.
 *
 * - A full field uses the standard seeded bracket (generateEliminationDraw).
 * - Any other valid field is a partial elimination: the top `B = 2T - N`
 *   seeds get byes and the rest are folded (best remaining seed against the
 *   weakest). For BP, room j holds seeds B+j, T+1-j, T+j and N+1-j, so its two
 *   advancing teams take positions B+j and T+1-j in the next (full) round.
 *
 * Teams are ordered by position, so positions inherited from earlier rounds
 * keep each team in its half of the bracket instead of re-seeding from
 * preliminary rank.
 */
export function planEliminationRound(teams: PositionedTeam[], format: TournamentFormat): EliminationRoundPlan {
  const error = validateEliminationField(teams.length, format);
  if (error) throw new Error(error);
  const ordered = [...teams].sort(
    (left, right) => left.position - right.position || left.team.id.localeCompare(right.team.id)
  );
  const duplicate = ordered.find((entry, index) => index > 0 && ordered[index - 1].position === entry.position);
  if (duplicate) {
    throw new Error(
      `Two teams hold bracket position ${duplicate.position}. Check the previous elimination round's teams before drawing this one.`
    );
  }
  const bySeed = (seed: number) => ordered[seed - 1];
  const seatSides: DebateSide[] = format === "bp" ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];

  if (isFullEliminationField(ordered.length, format)) {
    const rooms = generateEliminationDraw(
      ordered.map((entry, index) => ({ team: entry.team, seed: index + 1 })),
      format,
      ordered.length
    );
    return {
      rooms: rooms.map((room) => ({
        ...room,
        teams: room.teams.map((slot) => ({ ...slot, position: bySeed(slot.seed).position })),
      })),
      byes: [],
    };
  }

  const count = ordered.length;
  const target = partialTarget(count, format);
  const byeCount = 2 * target - count;
  const roomSeeds: number[][] = [];
  if (format === "bp") {
    for (let j = 1; j <= (count - target) / 2; j++) {
      roomSeeds.push([byeCount + j, target + 1 - j, target + j, count + 1 - j]);
    }
  } else {
    for (let j = 1; j <= (count - byeCount) / 2; j++) {
      roomSeeds.push([byeCount + j, count + 1 - j]);
    }
  }

  return {
    rooms: roomSeeds.map((seeds, index) => ({
      roomNumber: index + 1,
      bracketName: `Partial Elimination Room ${index + 1}`,
      teams: seeds.map((seed, seat) => ({
        team: bySeed(seed).team,
        seed,
        side: seatSides[seat],
        position: bySeed(seed).position,
      })),
    })),
    byes: ordered.slice(0, byeCount),
  };
}

/**
 * Bracket position for each surviving team. A team that played an earlier
 * elimination debate with recorded positions inherits the best positions of
 * that room (one per advancing team, the better position going to the
 * better-placed team); a team without one (first round, or a bye) keeps its
 * break seed.
 */
export function resolveBracketPositions(
  survivors: Team[],
  initialSeed: (team: Team) => number,
  pastDebates: Debate[]
): PositionedTeam[] {
  const survivorIds = new Set(survivors.map((team) => team.id));
  const latestDebateByTeam = new Map<string, Debate>();
  for (const debate of pastDebates) {
    for (const slot of Object.values(debate.teams)) {
      if (!slot?.teamId || slot.bracketPosition === undefined) continue;
      const current = latestDebateByTeam.get(slot.teamId);
      if (!current || current.roundSeq < debate.roundSeq) latestDebateByTeam.set(slot.teamId, debate);
    }
  }

  return survivors.map((team) => {
    const debate = latestDebateByTeam.get(team.id);
    if (!debate) return { team, position: initialSeed(team) };
    const slots = Object.values(debate.teams).filter(
      (slot): slot is DebateTeamSlot & { bracketPosition: number } =>
        Boolean(slot?.teamId) && slot.bracketPosition !== undefined
    );
    const roomPositions = slots.map((slot) => slot.bracketPosition).sort((left, right) => left - right);
    const advancing = slots
      .filter((slot) => survivorIds.has(slot.teamId))
      .sort((left, right) => left.bracketPosition - right.bracketPosition);
    const index = advancing.findIndex((slot) => slot.teamId === team.id);
    return { team, position: roomPositions[index] };
  });
}
