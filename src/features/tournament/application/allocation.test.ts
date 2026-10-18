import { describe, expect, it } from "vitest";

import type { Adjudicator, Debate, DebateSide, Round, Team, Tournament, TournamentPreferences } from "@/types";
import { autoAllocateCommand, updateDebatesCommand, type AllocationDependencies } from "./allocation";

function makeDebate(): Debate {
  const sides: DebateSide[] = ["OG", "OO", "CG", "CO", "AFF", "NEG"];
  return {
    id: "debate-1",
    tournamentId: "tournament-1",
    roundId: "round-1",
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance: 1,
    resultStatus: "none",
    sidesConfirmed: false,
    flags: [],
    teams: Object.fromEntries(sides.map((side) => [side, {
      teamId: `team-${side}`,
      teamName: `Team ${side}`,
      side,
    }])) as Debate["teams"],
    adjudicators: {
      chairId: "chair-1",
      chairName: "Chair",
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
    },
  };
}

describe("updateDebatesCommand", () => {
  it("persists changes before hiding revealed panels and auditing assignments", async () => {
    const previous = makeDebate();
    const updated = { ...previous, adjudicators: { ...previous.adjudicators, chairId: "chair-2" } };
    const calls: string[] = [];

    await updateDebatesCommand([updated], [previous], {
      repository: {
        saveDebates(debates) {
          calls.push("local");
          expect(debates).toEqual([updated]);
        },
      },
      cloudRepository: {
        async saveDebates(debates) {
          calls.push("cloud");
          expect(debates).toEqual([updated]);
        },
      },
      async hideRevealedAdjudicators(roundIds) {
        calls.push("hide");
        expect(roundIds).toEqual(new Set(["round-1"]));
      },
      async recordAuditEvent(event) {
        calls.push("audit");
        expect(event).toMatchObject({
          action: "adjudicators.manual_assignments_updated",
          roundId: "round-1",
          debateId: "debate-1",
        });
      },
    });

    expect(calls).toEqual(["local", "cloud", "hide", "audit"]);
  });
});
describe("autoAllocateCommand", () => {
  const teams: Team[] = ["a", "b", "c", "d"].map((id) => ({
    id,
    tournamentId: "t",
    name: id,
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
  }));
  const twoTeamDebate = (id: string, teamIds: [string, string], importance: number): Debate => ({
    id,
    tournamentId: "t",
    roundId: "r1",
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: {
      AFF: { teamId: teamIds[0], teamName: teamIds[0], side: "AFF" },
      NEG: { teamId: teamIds[1], teamName: teamIds[1], side: "NEG" },
    } as Debate["teams"],
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
  });
  const judge = (id: string, baseScore: number): Adjudicator => ({
    id,
    tournamentId: "t",
    name: id,
    baseScore,
    trainee: false,
    independent: true,
    checkedIn: true,
    conflicts: [],
  });

  function run(
    preferences: Partial<TournamentPreferences>,
    round: Partial<Round>,
    panelSize = 1,
    extra: Partial<AllocationDependencies> = {}
  ) {
    let saved: Debate[] = [];
    const dependencies: AllocationDependencies = {
      tournament: { id: "t", format: "wsdc", preferences } as Tournament,
      rounds: [{ id: "r1", seq: 1, stage: "preliminary", feedbackWeight: 1, ...round } as Round],
      teams,
      debates: [twoTeamDebate("top", ["a", "b"], 10), twoTeamDebate("bottom", ["c", "d"], 0)],
      adjudicators: [judge("rated", 4), judge("unrated", 6), judge("spare-1", 2), judge("spare-2", 2)],
      standings: [],
      breakCategories: [],
      feedback: [{
        id: "f1", tournamentId: "t", roundId: "r0", debateId: "old", targetAdjudicatorId: "rated",
        sourceType: "team", sourceId: "a", sourceName: "a", score: 5, confirmed: true, timestamp: "",
      }],
      venues: [],
      repository: { saveDebates: (debates) => { saved = debates; } },
      hideRevealedAdjudicators: async () => undefined,
      recordAuditEvent: async () => undefined,
      ...extra,
    };
    return autoAllocateCommand("r1", panelSize, dependencies).then(() => ({
      ...Object.fromEntries(saved.map((debate) => [debate.id, debate.adjudicators])),
      savedIds: saved.map((debate) => debate.id),
    })) as Promise<Record<string, Debate["adjudicators"]> & { savedIds: string[] }>;
  }

  it("blends feedback, scaled to the adjudicator range, with the round's feedback weight", async () => {
    // Feedback 5 on a 1-5 scale maps to 10; with weight 1 the rated judge outranks 6.
    const weighted = await run({ feedbackMinScore: 1, feedbackMaxScore: 5 }, { feedbackWeight: 1 });
    expect(weighted.top.chairId).toBe("rated");
    const ignored = await run({ feedbackMinScore: 1, feedbackMaxScore: 5 }, { feedbackWeight: 0 });
    expect(ignored.top.chairId).toBe("unrated");
  });

  it("places the round's preformed panels only when the preference is on", async () => {
    const preformedPanels = [{ id: "p", chairId: "spare-1", panellistIds: ["spare-2"], traineeIds: [], importance: 10 }];
    const on = await run({ usePreformedPanels: true }, { preformedPanels });
    expect(on.top).toMatchObject({ chairId: "spare-1", panellistIds: ["spare-2"] });
    const off = await run({ usePreformedPanels: false }, { preformedPanels });
    expect(off.top.chairId).not.toBe("spare-1");
  });

  it("sizes panels by priority when the tournament asks for it", async () => {
    const sized = await run({ panelSizingMode: "by_priority" }, {}, 3);
    expect([sized.top.chairId, ...sized.top.panellistIds]).toHaveLength(3);
    expect([sized.bottom.chairId, ...sized.bottom.panellistIds]).toHaveLength(1);
  });

  it("saves on top of edits made to other rounds while it was computing", async () => {
    const otherRound = { ...twoTeamDebate("elsewhere", ["a", "c"], 0), roundId: "r2" };
    const result = await run({}, {}, 1, {
      latestDebates: () => [twoTeamDebate("top", ["a", "b"], 10), twoTeamDebate("bottom", ["c", "d"], 0), otherRound],
    });
    expect(result.savedIds.sort()).toEqual(["bottom", "elsewhere", "top"]);
  });

  it("saves nothing when the round itself changed while it was computing", async () => {
    const edited = { ...twoTeamDebate("top", ["a", "b"], 10), venueName: "Moved" };
    await expect(run({}, {}, 1, {
      latestDebates: () => [edited, twoTeamDebate("bottom", ["c", "d"], 0)],
    })).rejects.toThrow("was changed while this was being computed");
  });
});
