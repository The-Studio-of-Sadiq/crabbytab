import { describe, expect, it } from "vitest";
import {
  fetchCompletePublicProjection,
  fetchPublicRound,
  publicRoundsToLoad,
  replaceRoundRecords,
} from "./publicView";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("loading the public projection by round", () => {
  it("loads rounds that are missing or whose content changed", () => {
    const hashes = { r1: "a", r2: "b", r3: "c" };
    const loaded = new Map([["r1", "a"], ["r2", "old"]]);
    expect(publicRoundsToLoad(hashes, loaded)).toEqual(["r2", "r3"]);
    expect(publicRoundsToLoad(hashes, loaded, ["r1", "r3", "gone"])).toEqual(["r3"]);
  });

  it("replaces only the loaded rounds' records", () => {
    const current = [{ id: "d1", roundId: "r1" }, { id: "d2", roundId: "r2" }, { id: "d3", roundId: "r2" }];
    expect(replaceRoundRecords(current, [{ roundId: "r2", records: [{ id: "d4", roundId: "r2" }] }])).toEqual([
      { id: "d1", roundId: "r1" },
      { id: "d4", roundId: "r2" },
    ]);
  });

  it("requests a round by id and content hash", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return jsonResponse({ version: "v", roundId: "r 1", hash: "h", debates: [], ballots: [] });
    }) as unknown as typeof fetch;
    await fetchPublicRound("open", "r 1", "h", fetchImpl);
    expect(urls).toEqual(["/api/public/tournaments/open?round=r%201&h=h"]);
    const failing = (async () => jsonResponse({ error: "This round is not public." }, 404)) as unknown as typeof fetch;
    await expect(fetchPublicRound("open", "r9", "h", failing)).rejects.toThrow("not public");
  });

  it("assembles every round for a private portal", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith("/api/public/tournaments/open")) {
        return jsonResponse({
          version: "v1",
          tournament: { id: "t" },
          collections: { rounds: [{ id: "r1" }, { id: "r2" }], debates: [{ id: "d2", roundId: "r2" }], ballots: [] },
          roundSections: { r1: "h1", r2: "h2" },
          loadedRoundIds: ["r2"],
        });
      }
      expect(url).toBe("/api/public/tournaments/open?round=r1&h=h1");
      return jsonResponse({ version: "v1", roundId: "r1", hash: "h1", debates: [{ id: "d1", roundId: "r1" }], ballots: [{ id: "b1", roundId: "r1" }] });
    }) as unknown as typeof fetch;
    const projection = await fetchCompletePublicProjection("open", fetchImpl);
    expect(projection.collections.debates).toEqual([{ id: "d2", roundId: "r2" }, { id: "d1", roundId: "r1" }]);
    expect(projection.collections.ballots).toEqual([{ id: "b1", roundId: "r1" }]);
    expect(projection.loadedRoundIds).toEqual(["r1", "r2"]);
  });

  it("uses a response that already holds every round as it is", async () => {
    const full = { tournament: { id: "t" }, collections: { rounds: [], debates: [{ id: "d1", roundId: "r1" }], ballots: [] } };
    const fetchImpl = (async () => jsonResponse(full)) as unknown as typeof fetch;
    expect(await fetchCompletePublicProjection("open", fetchImpl)).toEqual(full);
  });
});
