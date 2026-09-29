import { Team, Debate, BallotSubmission, DebateSide, TournamentFormat } from "@/types";

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
    const ballot = ballotByDebateId.get(debate.id);
    if (!ballot) throw new Error(`A confirmed ballot is required for ${debate.venueName || debate.id}.`);

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

  return [];
}
