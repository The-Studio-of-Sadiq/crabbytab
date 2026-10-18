import { describe, expect, it } from "vitest";
import type { FeedbackSubmission } from "@/types";
import { filterFeedbackSubmissions } from "./filters";

const make = (id: string, extra: Partial<FeedbackSubmission>): FeedbackSubmission => ({
  id,
  tournamentId: "t",
  roundId: "r1",
  debateId: "d1",
  targetAdjudicatorId: "chair",
  sourceType: "team",
  sourceId: "aff",
  sourceName: "Aff",
  score: 5,
  confirmed: true,
  timestamp: "",
  ...extra,
});

describe("filterFeedbackSubmissions", () => {
  const all = [
    make("a", {}),
    make("b", { roundId: "r2" }),
    make("c", { targetAdjudicatorId: "wing", sourceType: "adjudicator", sourceId: "chair" }),
    make("d", { ignored: true }),
    make("e", { confirmed: false }),
  ];
  const ids = (filters: Parameters<typeof filterFeedbackSubmissions>[1]) =>
    filterFeedbackSubmissions(all, filters).map((item) => item.id);

  it("filters by round, adjudicator, source and status", () => {
    expect(ids({})).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids({ roundId: "r2" })).toEqual(["b"]);
    expect(ids({ targetAdjudicatorId: "wing" })).toEqual(["c"]);
    expect(ids({ sourceType: "adjudicator" })).toEqual(["c"]);
    expect(ids({ sourceType: "team", sourceId: "aff", roundId: "r1" })).toEqual(["a", "d", "e"]);
    expect(ids({ status: "ignored" })).toEqual(["d"]);
    expect(ids({ status: "unconfirmed" })).toEqual(["e"]);
    expect(ids({ status: "counted" })).toEqual(["a", "b", "c"]);
  });
});
