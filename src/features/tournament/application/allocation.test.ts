import { describe, expect, it } from "vitest";

import type { Debate, DebateSide } from "@/types";
import { updateDebatesCommand } from "./allocation";

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