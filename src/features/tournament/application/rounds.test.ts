import { describe, expect, it } from "vitest";
import type { Round } from "@/types";

import {
  createRoundCommand,
  createRoundRecord,
  getRoundChangeSummary,
  updateRoundCommand,
} from "./rounds";

describe("createRoundRecord", () => {
  it("uses a random draw for the first power-paired preliminary round", () => {
    const round = createRoundRecord({
      tournamentId: "tournament-1",
      roundSeq: 1,
      name: "Round 1",
      abbr: "R1",
      stage: "preliminary",
      defaultDrawRule: "power_paired",
    });

    expect(round.drawType).toBe("random");
    expect(round.name).toBe("Round 1");
    expect(round.id).toBe("round-tournament-1-1");
  });

  it("keeps explicit custom draw types intact", () => {
    const round = createRoundRecord({
      tournamentId: "tournament-1",
      roundSeq: 2,
      name: "Round 2",
      abbr: "R2",
      stage: "preliminary",
      customDrawType: "round_robin",
      defaultDrawRule: "power_paired",
    });

    expect(round.drawType).toBe("round_robin");
  });
});

describe("getRoundChangeSummary", () => {
  it("tracks only the rounds fields that changed", () => {
    const previous = createRoundRecord({
      tournamentId: "tournament-1",
      roundSeq: 1,
      name: "Round 1",
      abbr: "R1",
      stage: "preliminary",
    });

    const next = {
      ...previous,
      drawStatus: "released" as const,
      resultsReleased: true,
    };

    expect(getRoundChangeSummary(previous, next)).toEqual({
      drawStatus: { from: "none", to: "released" },
      resultsReleased: { from: false, to: true },
    });
  });
});

describe("round management commands", () => {
  const round = createRoundRecord({
    tournamentId: "tournament-1",
    roundSeq: 1,
    name: "Round 1",
    abbr: "R1",
    stage: "preliminary",
  });

  it("persists a created round before recording its audit event", async () => {
    const calls: string[] = [];
    let savedRounds: Round[] = [];
    let activeRound: Round | undefined;

    const created = await createRoundCommand(
      {
        tournamentId: "tournament-1",
        roundSeq: 1,
        name: "Round 1",
        abbr: "R1",
        stage: "preliminary",
      },
      [],
      {
        localRepository: {
          saveRounds(rounds, active) {
            calls.push("local");
            savedRounds = rounds;
            activeRound = active;
          },
        },
        async recordAuditEvent(event) {
          calls.push("audit");
          expect(event).toMatchObject({
            action: "round.created",
            roundId: "round-tournament-1-1",
          });
        },
      }
    );

    expect(calls).toEqual(["local", "audit"]);
    expect(savedRounds).toEqual([created]);
    expect(activeRound).toEqual(created);
  });

  it("preserves cloud, local, and audit ordering for updates", async () => {
    const calls: string[] = [];
    const updatedRound = { ...round, drawStatus: "released" as const };

    await updateRoundCommand(updatedRound, [round], round, {
      cloudRepository: {
        async saveRound(savedRound) {
          calls.push("cloud");
          expect(savedRound).toEqual(updatedRound);
        },
      },
      localRepository: {
        saveRounds(updatedRounds, activeRound) {
          calls.push("local");
          expect(updatedRounds).toEqual([updatedRound]);
          expect(activeRound).toEqual(updatedRound);
        },
      },
      async recordAuditEvent(event) {
        calls.push("audit");
        expect(event).toMatchObject({
          action: "draw.status_changed",
          category: "draw",
          roundId: round.id,
        });
      },
    });

    expect(calls).toEqual(["cloud", "local", "audit"]);
  });

  it("does not update local state or audit when cloud persistence fails", async () => {
    const calls: string[] = [];
    const updatedRound = { ...round, drawStatus: "released" as const };

    await expect(
      updateRoundCommand(updatedRound, [round], round, {
        cloudRepository: {
          async saveRound() {
            calls.push("cloud");
            throw new Error("Firestore unavailable");
          },
        },
        localRepository: {
          saveRounds() {
            calls.push("local");
          },
        },
        async recordAuditEvent() {
          calls.push("audit");
        },
      })
    ).rejects.toThrow("Firestore unavailable");

    expect(calls).toEqual(["cloud"]);
  });
});
