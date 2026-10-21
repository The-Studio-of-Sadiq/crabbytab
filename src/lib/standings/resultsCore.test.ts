import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, DebateSide, Round, SpeakerScoreEntry, Team, Tournament } from "@/types";
import { calculateStandings } from "@/lib/standings/calculator";

const tournament = {
  id: "t1",
  format: "wsdc",
  preferences: { substantiveSpeakers: 3, replyScoresEnabled: true },
} as unknown as Tournament;

const teams: Team[] = [
  { id: "aff", name: "Aff", speakers: [{ id: "a1", name: "A1" }, { id: "a2", name: "A2" }, { id: "a3", name: "A3" }] },
  { id: "neg", name: "Neg", speakers: [{ id: "n1", name: "N1" }, { id: "n2", name: "N2" }, { id: "n3", name: "N3" }] },
].map((team) => ({ ...team, tournamentId: "t1", breakCategories: [], speakerCategories: [] }) as Team);

const rounds = [
  { id: "r1", seq: 1, stage: "preliminary" },
  { id: "r2", seq: 2, stage: "preliminary" },
  { id: "qf", seq: 3, stage: "elimination" },
] as Round[];

function debate(id: string, roundId: string, roundSeq: number): Debate {
  return {
    id,
    roundId,
    roundSeq,
    teams: {
      AFF: { teamId: "aff", teamName: "Aff", side: "AFF" },
      NEG: { teamId: "neg", teamName: "Neg", side: "NEG" },
    },
  } as unknown as Debate;
}

function entries(prefix: string, scores: number[], extra: Partial<SpeakerScoreEntry>[] = []): SpeakerScoreEntry[] {
  return [
    ...scores.map((score, index) => ({ speakerId: `${prefix}${index + 1}`, speakerName: `${prefix}${index + 1}`, position: index + 1, score })),
    ...extra.map((entry) => entry as SpeakerScoreEntry),
  ];
}

function ballot(debateId: string, roundId: string, overrides: Partial<BallotSubmission> = {}): BallotSubmission {
  return {
    id: `b-${debateId}`,
    tournamentId: "t1",
    roundId,
    debateId,
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "tabroom",
    timestamp: "2026-10-18T00:00:00.000Z",
    speakerScores: {
      AFF: entries("a", [75, 75, 75], [{ speakerId: "a1", speakerName: "a1", position: 4, score: 37 }]),
      NEG: entries("n", [70, 70, 70], [{ speakerId: "n1", speakerName: "n1", position: 4, score: 35 }]),
    } as Record<DebateSide, SpeakerScoreEntry[]>,
    teamScores: {
      AFF: { side: "AFF", teamId: "aff", points: 1, win: true, rank: 1, totalSpeakerScore: 262, margin: 17 },
      NEG: { side: "NEG", teamId: "neg", points: 0, win: false, rank: 2, totalSpeakerScore: 245, margin: -17 },
    } as BallotSubmission["teamScores"],
    ...overrides,
  };
}

describe("standings and the results core", () => {
  it("leaves elimination rounds out of the team and speaker tabs", () => {
    const result = calculateStandings(
      tournament,
      rounds,
      teams,
      [debate("d1", "r1", 1), debate("d3", "qf", 3)],
      [ballot("d1", "r1"), ballot("d3", "qf")]
    );
    const aff = result.teams.find((row) => row.teamId === "aff")!;
    expect(aff.wins).toBe(1);
    expect(aff.metrics.margin_sum).toBe(17);
    expect(result.speakers.find((row) => row.speakerId === "a1")!.speechesCount).toBe(1);
  });

  it("counts a forfeit as a result without speaker scores", () => {
    const forfeit = ballot("d2", "r2", {
      forfeitSide: "NEG",
      speakerScores: { AFF: [], NEG: [] } as unknown as BallotSubmission["speakerScores"],
      teamScores: {
        AFF: { side: "AFF", teamId: "aff", points: 1, win: true, rank: 1, totalSpeakerScore: 0, margin: 0 },
        NEG: { side: "NEG", teamId: "neg", points: 0, win: false, rank: 2, totalSpeakerScore: 0, margin: 0, forfeit: true },
      } as BallotSubmission["teamScores"],
    });
    const result = calculateStandings(tournament, rounds, teams, [debate("d1", "r1", 1), debate("d2", "r2", 2)], [ballot("d1", "r1"), forfeit]);
    const aff = result.teams.find((row) => row.teamId === "aff")!;
    expect(aff.wins).toBe(2);
    expect(aff.metrics.speaks_avg).toBe(262);
    expect(aff.averageSpeakerScore).toBe(87.33);
  });

  it("keeps ghost speeches and legacy reply placeholders out of the speaker tabs", () => {
    const ironPerson = ballot("d1", "r1", {
      speakerScores: {
        AFF: [
          { speakerId: "a1", speakerName: "a1", position: 1, score: 75 },
          { speakerId: "a2", speakerName: "a2", position: 2, score: 75 },
          { speakerId: "a1", speakerName: "a1", position: 3, score: 75, ghost: true },
          { speakerId: "reply-AFF", speakerName: "Aff Reply", position: 4, score: 37 },
        ],
        NEG: entries("n", [70, 70, 70], [{ speakerId: "n1", speakerName: "n1", position: 4, score: 35 }]),
      } as Record<DebateSide, SpeakerScoreEntry[]>,
    });
    const result = calculateStandings(tournament, rounds, teams, [debate("d1", "r1", 1)], [ironPerson]);
    expect(result.speakers.find((row) => row.speakerId === "a1")!.speechesCount).toBe(1);
    expect(result.replies.some((row) => row.speakerId === "reply-AFF")).toBe(false);
    expect(result.replies.find((row) => row.speakerId === "n1")!.totalScore).toBe(35);
  });

  it("ignores a ballot whose teams do not match the debate it points to", () => {
    const redrawn = { ...debate("d1", "r1", 1), teams: {
      AFF: { teamId: "neg", teamName: "Neg", side: "AFF" },
      NEG: { teamId: "aff", teamName: "Aff", side: "NEG" },
    } } as unknown as Debate;
    const result = calculateStandings(tournament, rounds, teams, [redrawn], [ballot("d1", "r1")]);
    expect(result.teams.find((row) => row.teamId === "aff")!.wins).toBe(0);
    expect(result.teams.find((row) => row.teamId === "neg")!.wins).toBe(0);
  });
});
