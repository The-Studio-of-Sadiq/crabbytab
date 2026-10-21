import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, Round } from "@/types";
import { AssistantConfirmationError, planAssistantConfirmation } from "./assistantBallotConfirmation";

const debate = {
  id: "d1",
  tournamentId: "t1",
  roundId: "r1",
  roundSeq: 1,
  bracket: 0,
  roomRank: 1,
  importance: 0,
  resultStatus: "draft",
  sidesConfirmed: true,
  flags: [],
  teams: {
    AFF: { teamId: "aff", teamName: "Aff", side: "AFF" },
    NEG: { teamId: "neg", teamName: "Neg", side: "NEG" },
  },
  adjudicators: { chairId: "c", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
} as unknown as Debate;

const round = {
  id: "r1",
  tournamentId: "t1",
  seq: 1,
  name: "Round 1",
  abbreviation: "R1",
  stage: "preliminary",
  drawType: "power_paired",
  drawStatus: "released",
  feedbackWeight: 1,
  silent: false,
  motionsReleased: true,
  resultsReleased: false,
  completed: false,
  createdAt: "",
} as Round;

function ballot(overrides: Partial<BallotSubmission> = {}): BallotSubmission {
  return {
    id: "b1",
    tournamentId: "t1",
    roundId: "r1",
    debateId: "d1",
    version: 1,
    confirmed: false,
    discarded: false,
    submitterType: "tabroom",
    submitterId: "alice",
    submitterName: "Alice",
    speakerScores: {
      AFF: [{ speakerId: "a1", speakerName: "A1", position: 1, score: 75 }],
      NEG: [{ speakerId: "n1", speakerName: "N1", position: 1, score: 72 }],
    } as BallotSubmission["speakerScores"],
    teamScores: {
      AFF: { side: "AFF", teamId: "aff", points: 1, totalSpeakerScore: 75, win: true, rank: 1 },
      NEG: { side: "NEG", teamId: "neg", points: 0, totalSpeakerScore: 72, win: false, rank: 2 },
    } as BallotSubmission["teamScores"],
    timestamp: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

const input = (overrides: Partial<Parameters<typeof planAssistantConfirmation>[0]> = {}) => ({
  ballotId: "b1",
  version: 1,
  debateBallots: [ballot()],
  debate,
  round,
  actor: { uid: "bob", name: "Bob" },
  format: "wsdc" as const,
  timestamp: "2026-10-20T11:00:00.000Z",
  ...overrides,
});

async function refusal(promise: Promise<unknown>): Promise<AssistantConfirmationError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AssistantConfirmationError) return error;
    throw error;
  }
  throw new Error("Expected a refusal.");
}

describe("assistants confirming others' ballots", () => {
  it("confirms someone else's entry, records who confirmed it and sets the debate's result", async () => {
    const earlier = ballot({ id: "b0", version: 0, submitterId: "carol" });
    const result = await planAssistantConfirmation(input({ debateBallots: [earlier, ballot()] }));
    const confirmed = result.ballots.find((item) => item.id === "b1")!;
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.confirmedBy).toBe("Bob");
    expect(confirmed.confirmedById).toBe("bob");
    // As Tabbycat, confirming a version leaves the debate's other drafts as they are.
    expect(result.ballots.some((item) => item.id === "b0")).toBe(false);
    expect(result.debate.resultStatus).toBe("confirmed");
    expect(result.debate.teams.AFF?.points).toBe(1);
  });

  it("always applies the same-person check to staff, double entry or not", async () => {
    const error = await refusal(planAssistantConfirmation(input({ actor: { uid: "alice", name: "Alice" } })));
    expect(error.message).toContain("different person");
  });

  it("refuses stale or superseded versions", async () => {
    expect((await refusal(planAssistantConfirmation(input({ version: 2 })))).message).toContain("changed since");
    const newer = ballot({ id: "b2", version: 2, submitterId: "carol" });
    expect((await refusal(planAssistantConfirmation(input({ debateBallots: [ballot(), newer] })))).message).toContain("newer version");
  });

  it("leaves completed rounds and released results to the tab room", async () => {
    expect((await refusal(planAssistantConfirmation(input({ round: { ...round, completed: true } })))).message).toContain("complete");
    expect((await refusal(planAssistantConfirmation(input({ round: { ...round, resultsReleased: true } })))).message).toContain("released");
    expect((await refusal(planAssistantConfirmation(input({ round: { ...round, drawStatus: "draft" } })))).message).toContain("not been published");
  });

  it("confirms a blind check only when the re-entry matches", async () => {
    const mismatch = await refusal(planAssistantConfirmation(input({
      reentry: { ...ballot(), speakerScores: { ...ballot().speakerScores, AFF: [{ speakerId: "a1", speakerName: "A1", position: 1, score: 74 }] } },
    })));
    expect(mismatch.differences?.length).toBeGreaterThan(0);
    const match = await planAssistantConfirmation(input({ reentry: ballot() }));
    expect(match.ballots[0].confirmed).toBe(true);
  });
});
