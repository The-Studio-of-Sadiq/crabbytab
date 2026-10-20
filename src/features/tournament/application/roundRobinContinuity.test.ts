import { describe, expect, it } from "vitest";
import type { Debate, Round, Team } from "@/types";
import type { GenerateDrawParams } from "@/lib/draw/generator";
import { generateRoundRobinDraw, legacyRotationPairings } from "@/lib/draw/roundRobin";
import { createSeededRng } from "@/lib/draw/rng";
import { makeRound, makeTournament } from "@/test/tournamentFixtures";
import { generateDrawCommand, type GenerateDrawDependencies } from "./draws";

const tournament = makeTournament("wsdc");
const tid = tournament.id;

// Stored order differs from seed order, so the legacy rotation and the Berger schedule differ.
const teams: Team[] = ["d", "b", "f", "a", "c", "e"].map((letter, index) => ({
  id: `team-${letter}`,
  tournamentId: tid,
  name: `Team ${letter.toUpperCase()}`,
  seed: index % 2 === 0 ? 6 - index : index,
  speakers: [],
  breakCategories: [],
  speakerCategories: [],
}));
const pairKey = (a: string, b: string) => [a, b].sort().join(" v ");

describe("round-robin cycles begun with the legacy rotation", () => {
  it("finishes the cycle without repeats when it keeps the legacy rotation", () => {
    const seen = new Set<string>();
    for (let index = 1; index <= 2; index++) {
      for (const [a, b] of legacyRotationPairings(teams, index)) seen.add(pairKey(a.id, b.id));
    }
    for (let index = 3; index <= 5; index++) {
      const draw = generateRoundRobinDraw(teams, index, new Map(), "wsdc", "balanced", undefined, createSeededRng(1), true);
      for (const room of draw) {
        const pair = pairKey(room.teamsWithSides.AFF.id, room.teamsWithSides.NEG.id);
        expect(seen.has(pair)).toBe(false);
        seen.add(pair);
      }
    }
    expect(seen.size).toBe(15);
  });

  it("would repeat pairings if it switched to the Berger schedule mid-cycle (why the legacy rotation is kept)", () => {
    const played = new Set<string>();
    for (let index = 1; index <= 2; index++) {
      for (const [a, b] of legacyRotationPairings(teams, index)) played.add(pairKey(a.id, b.id));
    }
    const repeats = [3, 4, 5].flatMap((index) =>
      generateRoundRobinDraw(teams, index, new Map(), "wsdc", "balanced", undefined, createSeededRng(1))
        .map((room) => pairKey(room.teamsWithSides.AFF.id, room.teamsWithSides.NEG.id))
        .filter((pair) => played.has(pair))
    );
    expect(repeats.length).toBeGreaterThan(0);
  });
});

describe("generateDrawCommand round-robin schedule marker", () => {
  const round1 = makeRound(tid, 1, { id: "rr1", drawType: "round_robin", scheduleGroup: 1 });
  const round2 = makeRound(tid, 2, { id: "rr2", drawType: "round_robin", scheduleGroup: 2 });
  const drawnDebate = { id: "d1", roundId: "rr1", teams: {} } as unknown as Debate;

  async function generate(rounds: Round[], debates: Debate[]) {
    let params: GenerateDrawParams | undefined;
    let saved: Round | undefined;
    const dependencies: GenerateDrawDependencies = {
      tournament,
      rounds,
      teams,
      venues: [],
      debates,
      ballots: [],
      motions: [],
      standings: [],
      generateRoundDraw(input) {
        params = input;
        return [];
      },
      localRepository: {
        saveDebates() {},
        saveBallots() {},
        markDebatesRemoved() {},
        saveRounds(_rounds, active) {
          saved = active;
        },
      },
      async recordAuditEvent() {},
    };
    await generateDrawCommand("rr2", dependencies, { override: { reason: "test" } });
    return { params, saved };
  }

  it("continues the legacy rotation when an earlier round-robin round was drawn without the marker", async () => {
    const { params, saved } = await generate([{ ...round1, drawStatus: "confirmed", completed: true }, round2], [drawnDebate]);
    expect(params?.legacyRoundRobin).toBe(true);
    expect(saved?.roundRobinAlgorithm).toBeUndefined();
  });

  it("uses and records the Berger schedule for a new cycle or one begun with it", async () => {
    const fresh = await generate([round1, round2], []);
    expect(fresh.params?.legacyRoundRobin).toBeUndefined();
    expect(fresh.saved?.roundRobinAlgorithm).toBe("berger_seed");

    const marked = await generate(
      [{ ...round1, drawStatus: "confirmed", completed: true, roundRobinAlgorithm: "berger_seed" }, round2],
      [drawnDebate]
    );
    expect(marked.params?.legacyRoundRobin).toBeUndefined();
    expect(marked.saved?.roundRobinAlgorithm).toBe("berger_seed");
  });
});
