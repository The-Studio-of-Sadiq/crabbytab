import { describe, expect, it, vi } from "vitest";

import type { Adjudicator, BallotSubmission, Team } from "@/types";
import { createTournamentEntityCommands, type EntityCommandDependencies } from "./entities";
import { ballotsWithSpeaker, checkSpeakerRemoval } from "./stateGuards";
import { isAdjudicatorScoreChange } from "@/lib/feedback/scoreHistory";

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: "team-1",
    tournamentId: "t",
    name: "Alpha",
    speakers: [
      { id: "s1", name: "Ann Lee" },
      { id: "s2", name: "Bo Kim" },
    ],
    breakCategories: [],
    speakerCategories: [],
    ...overrides,
  };
}

function ballot(overrides: Partial<BallotSubmission> = {}): BallotSubmission {
  return {
    id: "b1",
    tournamentId: "t",
    roundId: "r1",
    debateId: "d1",
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "tabroom",
    speakerScores: {
      AFF: [{ speakerId: "s1", speakerName: "Ann Lee", position: 1, score: 75 }],
    } as BallotSubmission["speakerScores"],
    teamScores: {} as BallotSubmission["teamScores"],
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function setup(overrides: Partial<EntityCommandDependencies> = {}) {
  const saved = { teams: vi.fn(), adjudicators: vi.fn() };
  const dependencies: EntityCommandDependencies = {
    tournamentId: "t",
    institutions: [],
    teams: [team()],
    adjudicators: [],
    venues: [],
    motions: [],
    debates: [],
    ballots: [],
    feedback: [],
    repositories: {
      institutions: { save: vi.fn() },
      teams: { save: saved.teams },
      adjudicators: { save: saved.adjudicators },
      venues: { save: vi.fn() },
      motions: { save: vi.fn() },
    },
    recordAuditEvent: async () => undefined,
    createId: (prefix) => `${prefix}-new`,
    generatePrivateKey: () => "key",
    now: () => "2026-02-01T10:00:00Z",
    ...overrides,
  };
  return { commands: createTournamentEntityCommands(dependencies), saved };
}

describe("speakers on an existing team", () => {
  it("adds a speaker", async () => {
    const { commands, saved } = setup();
    const next = team({ speakers: [...team().speakers, { id: "s3", name: "Cy Ng" }] });
    await commands.updateTeam(next);
    expect(saved.teams.mock.calls[0][0][0].speakers.map((speaker: { id: string }) => speaker.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("removes a speaker without results", async () => {
    const { commands, saved } = setup({ ballots: [ballot()] });
    await commands.updateTeam(team({ speakers: [{ id: "s1", name: "Ann Lee" }] }));
    expect(saved.teams).toHaveBeenCalledTimes(1);
  });

  it("refuses to remove a speaker with recorded speeches", async () => {
    const { commands, saved } = setup({ ballots: [ballot()] });
    await expect(commands.updateTeam(team({ speakers: [{ id: "s2", name: "Bo Kim" }] }))).rejects.toThrow(/Ann Lee has speaker scores/);
    expect(saved.teams).not.toHaveBeenCalled();
  });

  it("counts scoresheets and ignores discarded ballots", () => {
    const sheetOnly = ballot({
      speakerScores: {} as BallotSubmission["speakerScores"],
      sheets: [{ adjudicatorId: "a", speakerScores: { NEG: [{ speakerId: "s2", speakerName: "Bo", position: 1, score: 70 }] } as BallotSubmission["speakerScores"] }],
    });
    expect(ballotsWithSpeaker("s2", [sheetOnly])).toHaveLength(1);
    expect(ballotsWithSpeaker("s1", [ballot({ discarded: true })])).toHaveLength(0);
    expect(checkSpeakerRemoval(undefined, team(), { ballots: [ballot()] })).toEqual([]);
  });
});

describe("code names never stand in for the real name", () => {
  it("does not store the team name as a new team's code name", async () => {
    const { commands, saved } = setup({ teams: [] });
    await commands.addTeams([{ ...team(), codeName: "Alpha" }]);
    expect(saved.teams.mock.calls[0][0][0].codeName).toBeUndefined();
  });

  it("clears a legacy code name equal to the old name when the team is renamed", async () => {
    const { commands, saved } = setup({ teams: [team({ codeName: "Alpha" })] });
    await commands.updateTeam(team({ name: "Alpha Renamed", codeName: "Alpha" }));
    expect(saved.teams.mock.calls[0][0][0]).toMatchObject({ name: "Alpha Renamed", codeName: undefined });
  });

  it("keeps a real code name", async () => {
    const { commands, saved } = setup({ teams: [team({ codeName: "Fox" })] });
    await commands.updateTeam(team({ name: "Alpha Renamed", codeName: "Fox" }));
    expect(saved.teams.mock.calls[0][0][0].codeName).toBe("Fox");
  });
});

describe("base score history", () => {
  const adjudicator: Adjudicator = {
    id: "a1",
    tournamentId: "t",
    name: "Judge",
    baseScore: 5,
    trainee: false,
    independent: true,
    conflicts: [],
  };

  it("records the current round with each score change", async () => {
    const { commands, saved } = setup({ adjudicators: [adjudicator], currentRoundId: () => "round-3" });
    await commands.updateAdjudicator({ ...adjudicator, baseScore: 6 });
    expect(saved.adjudicators.mock.calls[0][0][0].scoreHistory).toEqual([
      expect.objectContaining({ field: "baseScore", previous: 5, value: 6, roundId: "round-3" }),
    ]);
  });

  it("omits the round before any round exists", async () => {
    const { commands, saved } = setup({ adjudicators: [adjudicator], currentRoundId: () => undefined });
    await commands.updateAdjudicators([{ ...adjudicator, baseScore: 4 }]);
    expect(saved.adjudicators.mock.calls[0][0][0].scoreHistory[0]).not.toHaveProperty("roundId");
  });

  it("accepts the round in stored history entries and rejects a malformed one", () => {
    expect(isAdjudicatorScoreChange({ field: "baseScore", timestamp: "x", roundId: "r1", value: 5 })).toBe(true);
    expect(isAdjudicatorScoreChange({ field: "baseScore", timestamp: "x", roundId: 3 })).toBe(false);
  });

  it("saves the tester flag like any other field", async () => {
    const { commands, saved } = setup({ adjudicators: [adjudicator] });
    await commands.updateAdjudicators([{ ...adjudicator, isTester: true }]);
    expect(saved.adjudicators.mock.calls[0][0][0].isTester).toBe(true);
  });
});
