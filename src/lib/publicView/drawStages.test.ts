import { describe, expect, it } from "vitest";
import { buildPublicProjection, type PublicSourceData, type SourceRecord } from "@/lib/publicView/projection";

/**
 * Release gating of the draw stages in the public projection: a confirmed (locked) or teams-only
 * draw never reaches the public view, existing "confirmed" / "released" draws stay public, and the
 * explicit current round only narrows the "current round" draw mode.
 */

const tournament = (preferences: Record<string, unknown> = {}): SourceRecord => ({
  id: "t1",
  name: "Stage Open",
  shortName: "SO",
  slug: "stage-open",
  format: "australs",
  ownerId: "owner",
  admins: {},
  preferences: { teamsInDebate: 2, substantiveSpeakers: 3, publicResults: true, publicMotions: true, ...preferences },
});

const roundRecord = (id: string, seq: number, drawStatus: string, extra: Record<string, unknown> = {}) => ({
  id,
  seq,
  name: `Round ${seq}`,
  abbreviation: `R${seq}`,
  stage: "preliminary",
  drawStatus,
  adjudicatorsRevealed: true,
  resultsReleased: false,
  completed: false,
  feedbackWeight: 1,
  ...extra,
});

const debateRecord = (id: string, roundId: string, seq: number, aff: string, neg: string) => ({
  id,
  roundId,
  roundSeq: seq,
  roomRank: 1,
  teams: {
    AFF: { teamId: aff, teamName: `Team ${aff}`, side: "AFF" },
    NEG: { teamId: neg, teamName: `Team ${neg}`, side: "NEG" },
  },
  adjudicators: { chairId: "adj-1", chairName: "Secret Chair", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
});

function source(rounds: Record<string, unknown>[]): PublicSourceData {
  return {
    rounds: rounds as SourceRecord[],
    teams: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => ({ id, name: `Team ${id}`, speakers: [] })),
    adjudicators: [{ id: "adj-1", name: "Secret Chair", conflicts: [] }],
    debates: rounds.map((round, index) => {
      const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
      return debateRecord(`d-${String(round.id)}`, String(round.id), Number(round.seq), ids[index * 2], ids[index * 2 + 1]);
    }) as SourceRecord[],
    ballots: [],
    motions: [],
    breakCategories: [],
    institutions: [],
    venues: [],
  };
}

const publicDebateRounds = (projection: ReturnType<typeof buildPublicProjection>) =>
  projection.collections.debates.map((debate) => (debate as { roundId: string }).roundId).sort();
const publicRoundIds = (projection: ReturnType<typeof buildPublicProjection>) =>
  projection.collections.rounds.map((round) => (round as { id: string }).id).sort();

describe("public projection: draw stages", () => {
  const rounds = [
    roundRecord("r1", 1, "confirmed"),
    roundRecord("r2", 2, "released"),
    roundRecord("r3", 3, "locked"),
    roundRecord("r4", 4, "teams_released"),
    roundRecord("r5", 5, "draft"),
  ];

  it("publishes existing confirmed/released draws and never locked, teams-only or draft ones", () => {
    const projection = buildPublicProjection(tournament({ publicDrawMode: "all" }), source(rounds));
    expect(publicDebateRounds(projection)).toEqual(["r1", "r2"]);
    expect(publicRoundIds(projection)).toEqual(["r1", "r2"]);
    const text = JSON.stringify(projection);
    expect(text).not.toContain("Team g"); // r4's teams (teams-only release)
    expect(text).not.toContain("Team e"); // r3's teams (locked)
  });

  it("current-round mode derives the latest public draw when no current round is set", () => {
    const projection = buildPublicProjection(tournament({ publicDrawMode: "current" }), source(rounds));
    expect(publicDebateRounds(projection)).toEqual(["r2"]);
  });

  it("an explicit current round selects the current draw, but cannot publish an unreleased one", () => {
    const pinned = buildPublicProjection(tournament({ publicDrawMode: "current", currentRoundId: "r1" }), source(rounds));
    expect(publicDebateRounds(pinned)).toEqual(["r1"]);
    expect((pinned.tournament.preferences as { currentRoundId?: string }).currentRoundId).toBe("r1");

    const unreleased = buildPublicProjection(tournament({ publicDrawMode: "current", currentRoundId: "r4" }), source(rounds));
    expect(publicDebateRounds(unreleased)).toEqual([]);
    // The id of a round that is not public is not published either.
    expect(unreleased.tournament.preferences).not.toHaveProperty("currentRoundId");
  });

  it("an explicit current round includes the released rounds of its schedule slot", () => {
    const slot = [
      roundRecord("r1", 1, "confirmed", { scheduleGroup: 1 }),
      roundRecord("p1", 2, "confirmed", { scheduleGroup: 2 }),
      roundRecord("p2", 3, "confirmed", { scheduleGroup: 2 }),
      roundRecord("p3", 4, "teams_released", { scheduleGroup: 2 }),
    ];
    const projection = buildPublicProjection(tournament({ publicDrawMode: "current", currentRoundId: "p1" }), source(slot));
    expect(publicDebateRounds(projection)).toEqual(["p1", "p2"]);
  });
});
