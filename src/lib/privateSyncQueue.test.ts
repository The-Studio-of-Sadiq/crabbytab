import { describe, expect, it } from "vitest";
import type { BallotSubmission, FeedbackSubmission } from "@/types";
import {
  enqueuePrivateSyncItem,
  parsePrivateSyncQueue,
  parsePrivateSyncRejections,
  privateSyncItemsToSend,
  privateSyncQueueName,
  remainingAfterPrivateSync,
  withoutPrivateSyncItems,
  type PrivateSyncItem,
} from "./privateSyncQueue";

const ballot = (id: string, debateId: string): PrivateSyncItem => ({
  collection: "ballots",
  record: { id, debateId } as BallotSubmission,
});
const feedback = (id: string, debateId: string): PrivateSyncItem => ({
  collection: "feedback",
  record: { id, debateId } as FeedbackSubmission,
});
const ids = (items: PrivateSyncItem[]) => items.map((item) => `${item.collection}/${item.record.id}`);

describe("private sync queue", () => {
  it("keeps a separate queue per private link, and the old shared name without a key", () => {
    expect(privateSyncQueueName("abc123")).toBe("privateSyncQueue_abc123");
    expect(privateSyncQueueName("other")).not.toBe(privateSyncQueueName("abc123"));
    expect(privateSyncQueueName()).toBe("privateSyncQueue");
    expect(privateSyncQueueName("a/b")).toBe("privateSyncQueue_a%2Fb");
  });

  it("drops damaged entries instead of failing every sync", () => {
    expect(ids(parsePrivateSyncQueue([ballot("b1", "d1"), null, { collection: "ballots" }, { collection: "x", record: { id: "z" } }, feedback("f1", "d1")])))
      .toEqual(["ballots/b1", "feedback/f1"]);
    expect(parsePrivateSyncQueue("not a list")).toEqual([]);
  });

  it("replaces the same record and an earlier ballot for the same debate, but not feedback", () => {
    let queue = enqueuePrivateSyncItem([], ballot("b1", "d1"));
    queue = enqueuePrivateSyncItem(queue, feedback("f1", "d1"));
    queue = enqueuePrivateSyncItem(queue, ballot("b2", "d1"));
    queue = enqueuePrivateSyncItem(queue, feedback("f1", "d1"));
    expect(ids(queue)).toEqual(["ballots/b2", "feedback/f1"]);
  });

  it("sends this link's items and the old shared queue's items once each", () => {
    const own = [ballot("b1", "d1")];
    const legacy = [ballot("b1", "d1"), feedback("f9", "d9")];
    expect(ids(privateSyncItemsToSend(own, legacy))).toEqual(["ballots/b1", "feedback/f9"]);
  });

  it("keeps only the refused items after a sync, matched by collection and id", () => {
    const queue = [ballot("x", "d1"), feedback("x", "d2"), feedback("f2", "d3")];
    const remaining = remainingAfterPrivateSync(queue, [{ id: "x", collection: "feedback", reason: "no" }]);
    expect(ids(remaining)).toEqual(["feedback/x"]);
    expect(remainingAfterPrivateSync(queue, [])).toEqual([]);
  });

  it("discards only the chosen items", () => {
    const queue = [ballot("b1", "d1"), feedback("f1", "d1")];
    expect(ids(withoutPrivateSyncItems(queue, [{ id: "b1", collection: "ballots" }]))).toEqual(["feedback/f1"]);
  });

  it("reads the server's refusals defensively", () => {
    expect(parsePrivateSyncRejections([
      { id: "b1", collection: "ballots", reason: "Not yours" },
      { id: "f1", collection: "feedback" },
      { id: 3, collection: "ballots" },
      "junk",
    ])).toEqual([
      { id: "b1", collection: "ballots", reason: "Not yours" },
      { id: "f1", collection: "feedback", reason: "Refused by the server." },
    ]);
    expect(parsePrivateSyncRejections(undefined)).toEqual([]);
  });
});
