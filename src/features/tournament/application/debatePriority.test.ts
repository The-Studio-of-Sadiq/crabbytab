import { describe, expect, it } from "vitest";
import type { BreakCategory, Debate } from "@/types";
import { calculateBreakLiveness } from "@/lib/breakqual/liveness";
import { DebatePriorityUnavailableError, prioritiseDebates } from "./debatePriority";

function debate(id: string, bracket: number, teamIds: [string, string]): Debate {
  return {
    id,
    roundId: "r3",
    bracket,
    importance: 5,
    teams: { AFF: { teamId: teamIds[0], teamName: teamIds[0] }, NEG: { teamId: teamIds[1], teamName: teamIds[1] } },
  } as unknown as Debate;
}

const open: BreakCategory = {
  id: "open", tournamentId: "t", name: "Open", slug: "open", seq: 1, breakSize: 4, reserveSize: 0, isGeneral: true, priority: 10,
};

// 16 teams, before round 3 of 3, open break 4: safe 3, dead 0 (see liveness.test.ts).
const teamIds = Array.from({ length: 16 }, (_, index) => `t${index + 1}`);
const teams = teamIds.map((id) => ({ id, tournamentId: "t", name: id, speakers: [], breakCategories: [], speakerCategories: [] }));
const points = new Map<string, number>([["t1", 2], ["t2", 2], ["t3", 1], ["t4", 1], ["t5", 0], ["t6", 0]]);
const liveness = {
  ...calculateBreakLiveness({ teamsPerDebate: 2, categories: [open], teams, pointsByTeam: points, roundSeq: 3, totalPrelimRounds: 3 }),
  pointsByTeam: points,
};
const debates = [debate("top", 2, ["t1", "t2"]), debate("middle", 1, ["t3", "t4"]), debate("bottom", 0, ["t5", "t6"])];

describe("prioritiseDebates", () => {
  it("by liveness: live rooms 10, dead rooms 0", () => {
    const result = prioritiseDebates(debates, "liveness", [open], liveness);
    expect(result.map((item) => [item.id, item.importance])).toEqual([["top", 10], ["middle", 10], ["bottom", 0]]);
  });

  it("by bracket: quarters of the rooms by bracket", () => {
    const four = [...debates, debate("lowest", -1, ["t7", "t8"])];
    const result = prioritiseDebates(four, "bracket", [open], null);
    expect(result.map((item) => [item.id, item.importance])).toEqual([["top", 10], ["middle", 7], ["bottom", 3], ["lowest", 0]]);
  });

  it("refuses liveness without a general category or outside a preliminary round", () => {
    expect(() => prioritiseDebates(debates, "liveness", [{ ...open, isGeneral: false }], liveness)).toThrow(DebatePriorityUnavailableError);
    expect(() => prioritiseDebates(debates, "liveness", [open], null)).toThrow(DebatePriorityUnavailableError);
  });
});
