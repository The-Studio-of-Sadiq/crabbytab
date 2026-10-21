import { describe, expect, it } from "vitest";
import {
  portalRoundProjection,
  loadBallotsForDebates,
  loadParticipantDebates,
  loadPortalVenues,
  loadTeamsById,
  type TournamentReferenceLike,
} from "./privateParticipantData";
import { debateParticipantIds } from "./privateSync";
import type { Debate } from "@/types";

type Data = Record<string, unknown>;

/** The slice of a firebase-admin tournament reference the helpers use, counting billed reads. */
function fakeTournament(collections: Record<string, Record<string, Data>>) {
  const counter = { reads: 0, queries: [] as string[] };
  const docs = (name: string) => Object.entries(collections[name] || {}).map(([id, data]) => ({ id, data: () => structuredClone(data) }));
  const result = (name: string, matches: ReturnType<typeof docs>) => {
    counter.reads += Math.max(1, matches.length);
    return { docs: matches };
  };
  const ref: TournamentReferenceLike = {
    collection: (name) => ({
      get: async () => {
        counter.queries.push(`${name}: all`);
        return result(name, docs(name));
      },
      doc: (id) => ({
        get: async () => {
          counter.reads += 1;
          const data = collections[name]?.[id];
          return { id, exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined) };
        },
      }),
      where: (field, operator, value) => ({
        get: async () => {
          counter.queries.push(`${name}: ${field} ${operator}`);
          if (operator === "in" && (value as unknown[]).length > 30) throw new Error("'in' supports up to 30 values");
          const matches = docs(name).filter((document) => {
            const fieldValue = document.data()[field];
            return operator === "array-contains"
              ? Array.isArray(fieldValue) && fieldValue.includes(value)
              : (value as unknown[]).includes(fieldValue);
          });
          return result(name, matches);
        },
      }),
    }),
  };
  return { ref, counter };
}

/** A 1000-team BP tournament's debates: 250 rooms a round, 9 rounds. */
function bpDebates(withIndex: boolean): Record<string, Data> {
  const debates: Record<string, Data> = {};
  for (let round = 1; round <= 9; round++) {
    for (let room = 0; room < 250; room++) {
      const teams = Object.fromEntries(["OG", "OO", "CG", "CO"].map((side, index) => [
        side, { teamId: `team-${(room * 4 + index + round * 7) % 1000}` },
      ]));
      const adjudicators = { chairId: `adj-${(room + round) % 550}`, panellistIds: [`adj-${(room + 250 + round) % 550}`] };
      const debate: Data = { roundId: `r-${round}`, teams, adjudicators };
      if (withIndex) debate.participantIds = debateParticipantIds(debate as unknown as Debate);
      debates[`d-${round}-${room}`] = debate;
    }
  }
  return debates;
}

describe("participant-scoped private reads", () => {
  it("reads only the participant's debates once the tournament is indexed", async () => {
    const { ref, counter } = fakeTournament({
      data: { participantIndex: { version: 1 } },
      debates: bpDebates(true),
    });
    const { debates, indexed } = await loadParticipantDebates(ref, "team-3");
    expect(indexed).toBe(true);
    expect(debates.size).toBe(9);
    expect([...debates.values()].every((debate) => Object.values(debate.teams).some((slot) => slot?.teamId === "team-3"))).toBe(true);
    // The index stays on the server.
    expect([...debates.values()].some((debate) => "participantIds" in debate)).toBe(false);
    expect(counter.queries).toEqual(["debates: participantIds array-contains"]);
    expect(counter.reads).toBe(1 + 9); // marker + own debates (was 2,250 debates)
  });

  it("falls back to reading every debate for a tournament not indexed yet", async () => {
    const { ref, counter } = fakeTournament({ debates: bpDebates(false) });
    const { debates, indexed } = await loadParticipantDebates(ref, "adj-7");
    expect(indexed).toBe(false);
    expect(counter.queries).toEqual(["debates: all"]);
    expect(debates.size).toBe(2250);
  });

  it("leaves soft-deleted debates, teams and ballots out", async () => {
    const { ref } = fakeTournament({
      data: { participantIndex: { version: 1 } },
      debates: {
        live: { participantIds: ["team-a"], teams: { OG: { teamId: "team-a" } } },
        gone: { participantIds: ["team-a"], teams: { OG: { teamId: "team-a" } }, deletedAt: "2026-10-01" },
      },
      teams: { "team-a": { name: "A" }, "team-b": { name: "B", deletedAt: "2026-10-01" } },
      ballots: { b1: { debateId: "live" }, b2: { debateId: "live", deletedAt: "2026-10-01" }, b3: { debateId: "other" } },
    });
    expect([...(await loadParticipantDebates(ref, "team-a")).debates.keys()]).toEqual(["live"]);
    expect([...(await loadTeamsById(ref, ["team-a", "team-b", "team-missing", "team-a"])).keys()]).toEqual(["team-a"]);
    expect((await loadBallotsForDebates(ref, ["live"])).map((ballot) => ballot.id)).toEqual(["b1"]);
  });

  it("splits ballot lookups into Firestore's 30-value 'in' queries", async () => {
    const ballots = Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`b${index}`, { debateId: `d${index}` }]));
    const { ref, counter } = fakeTournament({ ballots });
    const found = await loadBallotsForDebates(ref, Array.from({ length: 70 }, (_, index) => `d${index}`));
    expect(found).toHaveLength(70);
    expect(counter.queries).toHaveLength(3);
  });
});

describe("loadPortalVenues", () => {
  it("reads each room once and publishes only safe links", async () => {
    const { ref, counter } = fakeTournament({
      venues: {
        v1: { name: "Online 1", url: "https://meet.example.org/a", category: "Online", priority: 1 },
        v2: { name: "Bad", url: "javascript:alert(1)", priority: 1 },
        v3: { name: "Gone", deletedAt: "2026-10-01T00:00:00Z" },
      },
    });
    const venues = await loadPortalVenues(ref, [{ venueId: "v1" }, { venueId: "v1" }, { venueId: "v2" }, { venueId: "v3" }, {}]);
    expect(venues).toEqual([
      { id: "v1", name: "Online 1", category: "Online", url: "https://meet.example.org/a" },
      { id: "v2", name: "Bad" },
    ]);
    expect(counter.reads).toBe(3);
  });
});

describe("portalRoundProjection", () => {
  // Regression: the team portal returned stored round documents with the tab room's working data.
  it("sends portals only whitelisted round fields", () => {
    const projected = portalRoundProjection({
      id: "r1", tournamentId: "t1", seq: 1, name: "Round 1", abbreviation: "R1", stage: "preliminary",
      drawStatus: "released", motionsReleased: true, silent: false, completed: false, feedbackEnabled: true,
      preformedPanels: [{ id: "p1", panellistIds: [], traineeIds: [], importance: 0 }],
      preallocatedSides: { team1: "AFF" }, drawSeed: 42, roundRobinAlgorithm: "berger", deletedAt: undefined,
    });
    expect(projected).toMatchObject({ id: "r1", name: "Round 1", drawStatus: "released", feedbackEnabled: true });
    for (const hidden of ["preformedPanels", "preallocatedSides", "drawSeed", "roundRobinAlgorithm"]) {
      expect(projected).not.toHaveProperty(hidden);
    }
  });
});
