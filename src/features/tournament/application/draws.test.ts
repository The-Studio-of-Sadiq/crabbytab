import { describe, expect, it } from "vitest";

import type { BallotSubmission, Debate, Tournament } from "@/types";
import { createRoundRecord } from "./rounds";
import type { GenerateDrawDependencies } from "./draws";
import { DrawHasResultsError, generateDrawCommand, roundResults, withGenerationIds } from "./draws";

const tournament: Tournament = {
  id: "tournament-1",
  name: "Test Tournament",
  shortName: "Test",
  slug: "test",
  format: "bp",
  active: true,
  ownerId: "local",
  admins: {},
  preferences: {
    teamsInDebate: 4,
    substantiveSpeakers: 2,
    replyScoresEnabled: false,
    minSpeakerScore: 50,
    maxSpeakerScore: 90,
    stepSpeakerScore: 1,
    minReplyScore: 30,
    maxReplyScore: 45,
    drawRule: "power_paired",
    sideAllocationRule: "balanced",
    ballotDoubleEntry: false,
    publicDraw: true,
    publicResults: true,
    publicStandings: true,
    publicMotions: true,
    feedbackEnabled: true,
    feedbackMinScore: 1,
    feedbackMaxScore: 10,
  },
  createdAt: "",
  updatedAt: "",
};

describe("generateDrawCommand", () => {
  it("saves locally before optional cloud persistence and audit", async () => {
    const calls: string[] = [];
    let seedUsed: number | undefined;
    const round = createRoundRecord({
      tournamentId: tournament.id,
      roundSeq: 1,
      name: "Round 1",
      abbr: "R1",
      stage: "preliminary",
    });
    const dependencies: GenerateDrawDependencies = {
      tournament,
      rounds: [round],
      teams: [],
      venues: [],
      debates: [],
      ballots: [],
      motions: [],
      standings: [],
      generateRoundDraw(params) {
        calls.push("algorithm");
        seedUsed = params.seed;
        return [];
      },
      localRepository: {
        saveDebates(debates) {
          calls.push("local-debates");
          expect(debates).toEqual([]);
        },
        saveBallots() {
          calls.push("local-ballots");
        },
        saveRounds(rounds, activeRound) {
          calls.push("local-rounds");
          expect(rounds[0]).toMatchObject({ drawStatus: "draft", adjudicatorsRevealed: false, drawSeed: seedUsed });
          expect(typeof seedUsed).toBe("number");
          expect(activeRound.id).toBe(round.id);
        },
      },
      cloudRepository: {
        async replaceRoundDraw(roundId, removedDebates, debates, updatedRound, discardedBallots) {
          calls.push("cloud");
          expect(discardedBallots).toEqual([]);
          expect(roundId).toBe(round.id);
          expect(removedDebates).toEqual([]);
          expect(debates).toEqual([]);
          expect(updatedRound.drawStatus).toBe("draft");
        },
      },
      async recordAuditEvent(event) {
        calls.push("audit");
        expect(event).toMatchObject({ action: "draw.generated", roundId: round.id, details: { seed: seedUsed } });
      },
    };

    await generateDrawCommand(round.id, dependencies);

    expect(calls).toEqual([
      "algorithm",
      "local-debates",
      "local-rounds",
      "cloud",
      "audit",
    ]);
  });
});
describe("regenerating a draw that already has results", () => {
  const round = createRoundRecord({ tournamentId: tournament.id, roundSeq: 1, name: "Round 1", abbr: "R1", stage: "preliminary" });
  const oldDebate = { id: `debate-${round.id}-1`, roundId: round.id, teams: {} } as unknown as Debate;
  const ballot = (overrides: Partial<BallotSubmission>) =>
    ({ id: "b1", debateId: oldDebate.id, roundId: round.id, confirmed: true, discarded: false, ...overrides }) as BallotSubmission;

  function setup(ballots: BallotSubmission[]) {
    const saved: { ballots?: BallotSubmission[]; debates?: Debate[] } = {};
    const dependencies: GenerateDrawDependencies = {
      tournament,
      rounds: [round],
      teams: [],
      venues: [],
      debates: [oldDebate],
      ballots,
      motions: [],
      standings: [],
      // The generator numbers rooms from 1, exactly like the replaced draw.
      generateRoundDraw: () => [{ ...oldDebate }],
      localRepository: {
        saveDebates(debates) { saved.debates = debates; },
        saveBallots(items) { saved.ballots = items; },
        saveRounds() {},
      },
      async recordAuditEvent() {},
    };
    return { dependencies, saved };
  }

  it("refuses to regenerate unless the results are explicitly discarded", async () => {
    const { dependencies, saved } = setup([ballot({})]);
    await expect(generateDrawCommand(round.id, dependencies)).rejects.toBeInstanceOf(DrawHasResultsError);
    expect(saved.debates).toBeUndefined();
  });

  it("discards old results and never reuses their debate ids", async () => {
    const { dependencies, saved } = setup([ballot({}), ballot({ id: "b0", discarded: true })]);
    await generateDrawCommand(round.id, dependencies, { discardExistingResults: true });
    expect(saved.ballots?.find((item) => item.id === "b1")).toMatchObject({ discarded: true, confirmed: false, discardedBy: "draw regenerated" });
    const newIds = saved.debates!.map((debate) => debate.id);
    expect(newIds).toHaveLength(1);
    expect(newIds).not.toContain(oldDebate.id);
    expect(saved.ballots!.some((item) => newIds.includes(item.debateId))).toBe(false);
  });

  it("only counts undiscarded ballots on this round's current draw", () => {
    expect(roundResults(round.id, [oldDebate], [ballot({}), ballot({ id: "x", discarded: true }), ballot({ id: "y", debateId: "other" })]).map((item) => item.id)).toEqual(["b1"]);
    expect(withGenerationIds([{ id: "debate-r-1" }], 35)[0].id).toBe("debate-r-1-gz");
  });

  it("sends the discarded ballots to the cloud in the same replacement as the new draw", async () => {
    const { dependencies, saved } = setup([ballot({}), ballot({ id: "b2", confirmed: false })]);
    let cloud: { removed: Debate[]; debates: Debate[]; ballots: BallotSubmission[] } | undefined;
    dependencies.cloudRepository = {
      async replaceRoundDraw(_roundId, removed, debates, _round, discardedBallots) {
        cloud = { removed, debates, ballots: discardedBallots };
      },
    };
    await generateDrawCommand(round.id, dependencies, { discardExistingResults: true });
    expect(cloud!.removed.map((debate) => debate.id)).toEqual([oldDebate.id]);
    expect(cloud!.debates).toEqual(saved.debates!.filter((debate) => debate.roundId === round.id));
    const locallyDiscarded = saved.ballots!.filter((item) => item.discarded);
    expect(cloud!.ballots).toEqual(locallyDiscarded);
    expect(cloud!.ballots.map((item) => item.id).sort()).toEqual(["b1", "b2"]);
  });
});
