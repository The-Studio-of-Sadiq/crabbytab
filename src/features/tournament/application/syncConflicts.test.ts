import { describe, expect, it } from "vitest";

import type { CloudRecord } from "@/features/tournament/collections";
import { summarizeDivergedRecord } from "./syncConflicts";

describe("summarizeDivergedRecord", () => {
  it("names the record and lists the fields that differ, ignoring the ones the cloud stamps", () => {
    const local = { id: "t1", name: "Renamed here", seed: 2, syncVersion: 3, updatedAt: "a" } as CloudRecord;
    const cloud = {
      id: "t1",
      name: "Team",
      seed: 2,
      roundAvailability: { r1: true },
      syncVersion: 4,
      updatedAt: "b",
    } as CloudRecord;

    const summary = summarizeDivergedRecord({ collectionName: "teams", recordId: "t1", cloudRecord: cloud }, local, "teams/t1");

    expect(summary).toEqual({
      key: "teams/t1",
      kind: "Team",
      name: "Renamed here",
      missingLocally: false,
      differences: [
        { field: "name", local: "Renamed here", cloud: "Team" },
        { field: "roundAvailability", local: "—", cloud: "{\"r1\":true}" },
      ],
    });
  });

  it("shortens long values and handles records missing from this device", () => {
    const cloud = { id: "m1", text: "x".repeat(200) } as CloudRecord;
    const local = { id: "m1", text: "y".repeat(200) } as CloudRecord;

    const summary = summarizeDivergedRecord({ collectionName: "motions", recordId: "m1", cloudRecord: cloud }, local, "motions/m1");
    expect(summary.differences[0].local).toHaveLength(80);
    expect(summary.differences[0].local.endsWith("…")).toBe(true);

    expect(summarizeDivergedRecord({ collectionName: "tournament", recordId: "m1", cloudRecord: cloud }, undefined, "k"))
      .toMatchObject({ kind: "Tournament settings", missingLocally: true, differences: [] });
  });
});
