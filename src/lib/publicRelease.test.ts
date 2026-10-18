import { describe, expect, it } from "vitest";

import type { BreakCategory, Team, TournamentPreferences } from "@/types";
import {
  buildPublicBreak,
  getPublicRelease,
  isAnyTabReleased,
  isTabRound,
  redactUnreleasedBreak,
  setRelease,
} from "./publicRelease";

function team(id: string, overrides: Partial<Team> = {}): Team {
  return { id, tournamentId: "t1", name: id, speakers: [], breakCategories: [], speakerCategories: [], ...overrides };
}

const open: BreakCategory = {
  id: "open",
  tournamentId: "t1",
  name: "Open",
  slug: "open",
  seq: 1,
  breakSize: 2,
  reserveSize: 0,
  isGeneral: true,
  priority: 10,
};
const esl: BreakCategory = { ...open, id: "esl", slug: "esl", name: "ESL", seq: 2, priority: 1 };

describe("getPublicRelease", () => {
  it("defaults everything to unreleased, including existing tournaments", () => {
    const release = getPublicRelease({});
    expect(release).toEqual({ teamTab: false, speakerTab: false, repliesTab: false, breakCategoryIds: new Set() });
    expect(isAnyTabReleased(release)).toBe(false);
    expect(getPublicRelease(null).teamTab).toBe(false);
  });

  it("reads releases and ignores the replies tab when replies are not scored", () => {
    const release = getPublicRelease({
      releaseTeamTab: true,
      releaseRepliesTab: true,
      replyScoresEnabled: false,
      releasedBreakCategoryIds: ["open"],
    });
    expect(release.teamTab).toBe(true);
    expect(release.repliesTab).toBe(false);
    expect([...release.breakCategoryIds]).toEqual(["open"]);
    expect(isAnyTabReleased(release)).toBe(true);
  });
});

describe("setRelease", () => {
  const preferences = { replyScoresEnabled: true } as TournamentPreferences;

  it("toggles tab releases without mutating the input", () => {
    const next = setRelease(preferences, { kind: "speakerTab", released: true });
    expect(next.releaseSpeakerTab).toBe(true);
    expect(preferences.releaseSpeakerTab).toBeUndefined();
  });

  it("adds and removes break categories", () => {
    const released = setRelease(setRelease(preferences, { kind: "break", categoryId: "open", released: true }), {
      kind: "break",
      categoryId: "esl",
      released: true,
    });
    expect(released.releasedBreakCategoryIds).toEqual(["esl", "open"]);
    expect(setRelease(released, { kind: "break", categoryId: "open", released: false }).releasedBreakCategoryIds)
      .toEqual(["esl"]);
  });
});

describe("isTabRound", () => {
  it("counts only completed, non-cancelled preliminary rounds", () => {
    expect(isTabRound({ stage: "preliminary", completed: true })).toBe(true);
    expect(isTabRound({ stage: "preliminary", completed: false })).toBe(false);
    expect(isTabRound({ stage: "preliminary", completed: true, cancelled: true })).toBe(false);
    expect(isTabRound({ stage: "elimination", completed: true })).toBe(false);
  });
});

describe("redactUnreleasedBreak", () => {
  const release = getPublicRelease({ releasedBreakCategoryIds: ["esl"] });

  it("strips break results from teams outside released categories", () => {
    const redacted = redactUnreleasedBreak(
      { name: "A", breakStatus: "breaking" as const, breakCategoryIds: ["open"], eliminatedInRoundId: "qf" },
      release
    );
    expect(redacted).toEqual({ name: "A" });
  });

  it("keeps released categories only for teams that broke in one", () => {
    const kept = redactUnreleasedBreak({ breakStatus: "breaking" as const, breakCategoryIds: ["esl", "open"] }, release);
    expect(kept).toEqual({ breakStatus: "breaking", breakCategoryIds: ["esl"] });
  });

  it("hides that a team did not break", () => {
    expect(redactUnreleasedBreak({ breakStatus: "eliminated" as const, breakCategoryIds: [] }, release)).toEqual({});
  });
});

describe("buildPublicBreak", () => {
  const teams = [team("a", { breakCategoryIds: ["open"] }), team("b", { breakCategoryIds: ["open"] }), team("c", { breakCategoryIds: ["esl"] })];

  it("shows only released categories, using the generated snapshot order", () => {
    const withSnapshot = { ...open, generatedBreak: { breakingTeamIds: ["b", "a"], reserveTeamIds: [], generatedAt: "x" } };
    const result = buildPublicBreak([esl, withSnapshot], teams, getPublicRelease({ releasedBreakCategoryIds: ["open"] }));
    expect(result.map((entry) => entry.category.id)).toEqual(["open"]);
    expect(result[0].teams.map((entry) => [entry.seed, entry.team.id])).toEqual([[1, "b"], [2, "a"]]);
  });

  it("falls back to breaking teams ordered by rank for breaks generated without a snapshot", () => {
    const ranks = new Map([["a", 2], ["b", 1]]);
    const result = buildPublicBreak([open, esl], teams, getPublicRelease({ releasedBreakCategoryIds: ["open", "esl"] }), (id) => ranks.get(id));
    expect(result.map((entry) => [entry.category.id, entry.teams.map((item) => item.team.id)])).toEqual([
      ["open", ["b", "a"]],
      ["esl", ["c"]],
    ]);
  });

  it("returns nothing when no category is released", () => {
    expect(buildPublicBreak([open], teams, getPublicRelease({}))).toEqual([]);
  });
});
