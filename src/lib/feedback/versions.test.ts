import { describe, expect, it } from "vitest";
import type { FeedbackSubmission } from "@/types";
import { calculateFeedbackSummaries } from "./scores";
import { feedbackVersionOptions, supersededFeedbackIds } from "./versions";
import { addFeedbackCommand } from "@/features/tournament/application/feedback";

function feedback(id: string, overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission {
  return {
    id,
    tournamentId: "t",
    roundId: "r1",
    debateId: "d1",
    targetType: "adjudicator",
    targetAdjudicatorId: "chair",
    targetAdjudicatorName: "Chair",
    sourceType: "team",
    sourceId: "team-a",
    sourceName: "A",
    score: 3,
    confirmed: true,
    timestamp: "2026-10-21T10:00:00.000Z",
    ...overrides,
  };
}

describe("feedback versions (Tabbycat AdjudicatorFeedback is a versioned Submission)", () => {
  it("replaces the source's earlier confirmed feedback on the same target in the same debate", () => {
    const existing = [
      feedback("old"),
      feedback("other-target", { targetAdjudicatorId: "panellist" }),
      feedback("other-debate", { debateId: "d2" }),
      feedback("other-source", { sourceId: "team-b" }),
      feedback("unconfirmed", { confirmed: false }),
    ];
    expect(supersededFeedbackIds([feedback("new")], existing)).toEqual(["old"]);
  });

  it("keeps only the last of several submissions in one upload", () => {
    expect(supersededFeedbackIds([feedback("first"), feedback("second")], [])).toEqual(["first"]);
  });

  it("does not treat a re-uploaded record as replacing itself", () => {
    expect(supersededFeedbackIds([feedback("same")], [feedback("same")])).toEqual([]);
  });

  it("with teams on the orallist, a team's new feedback replaces its feedback on any adjudicator", () => {
    const options = feedbackVersionOptions({ feedbackPaths: {
      teams: "orallist", chairOnPanellists: true, chairOnTrainees: true, panellistsOnChair: true,
      traineesOnChair: true, adjudicatorsOnEachOther: false, onTeams: false,
    } }, { stage: "preliminary" });
    expect(options.teamsOnOrallistOnly).toBe(true);
    expect(supersededFeedbackIds([feedback("new", { targetAdjudicatorId: "panellist" })], [feedback("old")], options)).toEqual(["old"]);
    expect(supersededFeedbackIds([feedback("new", { targetAdjudicatorId: "panellist" })], [feedback("old")])).toEqual([]);
  });

  it("tab-room feedback unconfirms the earlier version, so the score counts once", async () => {
    let saved: FeedbackSubmission[] = [];
    const { id: _id, tournamentId: _tournamentId, timestamp: _timestamp, ...data } = feedback("ignored", { score: 5 });
    await addFeedbackCommand(data, {
      tournamentId: "t",
      feedback: [feedback("old", { score: 1 })],
      teams: [],
      adjudicators: [],
      repository: { saveFeedback: (items) => { saved = items; } },
      queuePrivateRecord: async () => undefined,
      recordAuditEvent: async () => undefined,
      createId: () => "new",
    });
    expect(saved.map((item) => [item.id, item.confirmed])).toEqual([["old", false], ["new", true]]);
    const summary = calculateFeedbackSummaries(saved, [], {}).get("chair");
    expect(summary).toMatchObject({ count: 1, average: 5 });
  });
});
