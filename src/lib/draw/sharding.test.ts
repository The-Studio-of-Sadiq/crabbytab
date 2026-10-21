import { describe, expect, it } from "vitest";
import { buildShards, interleave, shardLabel, splitIntoShards, type ShardableDebate } from "./sharding";

const debates: ShardableDebate[] = Array.from({ length: 8 }, (_, index) => ({
  id: `d${index + 1}`,
  bracket: 8 - index,
  importance: index % 3,
  roomRank: index + 1,
  venueName: `Room ${8 - index}`,
  venueCategory: index < 4 ? "B" : "A",
}));

describe("splitIntoShards", () => {
  it("balances shard sizes", () => {
    expect(splitIntoShards([1, 2, 3, 4, 5, 6, 7, 8], 3).map((shard) => shard.length)).toEqual([3, 3, 2]);
    expect(splitIntoShards([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
    expect(splitIntoShards([1, 2], 4)).toEqual([[1], [2]]);
    expect(splitIntoShards([], 3)).toEqual([]);
  });
});

describe("interleave", () => {
  it("deals items round-robin (Tabbycat sortInterleaved)", () => {
    expect(interleave([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([1, 4, 7, 2, 5, 3, 6]);
  });
});

describe("buildShards", () => {
  it("puts the top brackets in shard A when mixed top to bottom", () => {
    expect(buildShards(debates, { split: 2, sort: "bracket", mix: "top_to_bottom" })).toEqual([
      ["d1", "d2", "d3", "d4"],
      ["d5", "d6", "d7", "d8"],
    ]);
  });

  it("spreads brackets across shards when interleaved", () => {
    expect(buildShards(debates, { split: 2, sort: "bracket", mix: "interleaved" })).toEqual([
      ["d1", "d3", "d5", "d7"],
      ["d2", "d4", "d6", "d8"],
    ]);
  });

  it("sorts by importance, then room rank", () => {
    expect(buildShards(debates, { split: 2, sort: "importance", mix: "top_to_bottom" })[0]).toEqual(["d3", "d6", "d2", "d5"]);
  });

  it("groups by venue category and name", () => {
    expect(buildShards(debates, { split: 2, sort: "venue", mix: "top_to_bottom" })).toEqual([
      ["d8", "d7", "d6", "d5"],
      ["d4", "d3", "d2", "d1"],
    ]);
  });

  it("covers every debate exactly once", () => {
    const shards = buildShards(debates, { split: 3, sort: "bracket", mix: "interleaved" });
    expect(shards.flat().sort()).toEqual(debates.map((debate) => debate.id).sort());
    expect(shardLabel(2)).toBe("C");
  });
});
