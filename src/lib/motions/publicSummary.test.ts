import { describe, expect, it } from "vitest";
import { buildPublicMotionSummary, readPublicMotionSummary } from "./publicSummary";
import { poolMotionSummaries } from "./crossTournament";
import { buildPublicViewRoot, buildPublicViewSections } from "@/lib/publicView/snapshot";
import type { PublicSourceData, SourceRecord } from "@/lib/publicView/projection";

const rounds = [
  {
    debates: [{ id: "d1", motionId: "m1" }, { id: "d2", motionId: "m1" }],
    ballots: [
      { debateId: "d1", confirmed: true, teamScores: { AFF: { side: "AFF", points: 1, win: true }, NEG: { side: "NEG", points: 0, win: false } } },
      { debateId: "d2", confirmed: true, teamScores: { AFF: { side: "AFF", points: 0, win: false }, NEG: { side: "NEG", points: 1, win: true } } },
    ],
  },
];

const tournament = (preferences: Record<string, unknown>) => ({ name: "Open", format: "wsdc", preferences });

describe("public motion summary", () => {
  it("is built only when the tournament released its motion statistics", () => {
    const motions = [{ id: "m1", text: "THW test", released: true }, { id: "m2", text: "Hidden", released: false }];
    expect(buildPublicMotionSummary({ tournamentId: "t1", slug: "open", tournament: tournament({ publicMotions: false }), motions, rounds })).toBeUndefined();
    const summary = buildPublicMotionSummary({ tournamentId: "t1", slug: "open", tournament: tournament({}), motions, rounds });
    expect(summary).toEqual({
      tournament: { id: "t1", name: "Open", slug: "open" },
      isBP: false,
      motions: [
        {
          text: "THW test",
          debatesCounted: 2,
          positionWins: [{ side: "AFF", wins: 1 }, { side: "NEG", wins: 1 }],
          vetoes: 0,
        },
      ],
    });
    expect(readPublicMotionSummary(summary)).toEqual(summary);
    expect(readPublicMotionSummary({ tournament: { id: "x" } })).toBeUndefined();
  });

  it("pools the same motion across tournaments and never mixes formats", () => {
    const summary = (id: string, isBP: boolean, wins: number[]) => ({
      tournament: { id, name: id },
      isBP,
      motions: [
        {
          text: "THW  test!",
          debatesCounted: wins.reduce((sum, value) => sum + value, 0),
          positionWins: (isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"]).map((side, index) => ({ side: side as "AFF", wins: wins[index] })),
          vetoes: 1,
        },
      ],
    });
    const pooled = poolMotionSummaries([summary("a", false, [3, 1]), summary("b", false, [1, 1]), summary("c", true, [1, 0, 0, 0])]);
    expect(pooled).toHaveLength(2);
    expect(pooled[0]).toMatchObject({ isBP: false, debatesCounted: 6, vetoes: 2, positionWins: [{ side: "AFF", wins: 4 }, { side: "NEG", wins: 2 }] });
    expect(pooled[0].tournaments.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("is stored on the public view root from public data only", () => {
    const record: SourceRecord = { id: "t1", name: "Open", slug: "open", format: "wsdc", preferences: { publicResults: true, publicMotions: true } };
    const data: PublicSourceData = {
      rounds: [{ id: "r1", seq: 1, name: "R1", drawStatus: "released", resultsReleased: true }],
      teams: [],
      adjudicators: [],
      debates: [{ id: "d1", roundId: "r1", motionId: "m1", teams: {}, adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] } }],
      ballots: [],
      motions: [{ id: "m1", text: "THW test", released: true, rounds: ["r1"] }, { id: "m2", text: "Secret", released: false }],
      breakCategories: [],
      institutions: [],
      venues: [],
    };
    const { root } = buildPublicViewRoot({ tournamentId: "t1", slug: "open", sections: buildPublicViewSections(record, data), publishedAt: "now" });
    expect(root.motionSummary?.motions.map((motion) => motion.text)).toEqual(["THW test"]);
    const hidden = buildPublicViewRoot({
      tournamentId: "t1",
      slug: "open",
      sections: buildPublicViewSections({ ...record, preferences: { publicMotions: false } }, data),
      publishedAt: "now",
    });
    expect(hidden.root.motionSummary).toBeUndefined();
  });
});
