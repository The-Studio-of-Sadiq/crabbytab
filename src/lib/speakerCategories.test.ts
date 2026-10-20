import { describe, expect, it } from "vitest";

import type { BreakCategory, SpeakerCategory, SpeakerStandingRow, Team } from "@/types";
import {
  effectiveSpeakerCategories,
  planEligibilityFromSpeakerCategories,
  resolveSpeakerCategoryIds,
  slugifyCategory,
  speakerCategoryNames,
  speakerRowsInCategory,
  teamMeetsEligibilityRule,
  toStoredSpeakerCategories,
  validateSpeakerCategories,
} from "./speakerCategories";

const esl: SpeakerCategory = { id: "cat-esl", name: "ESL", slug: "esl", seq: 1, public: true };
const novice: SpeakerCategory = { id: "cat-novice", name: "Novice", slug: "novice", seq: 2, public: false };

function team(id: string, speakerCategories: (string[] | undefined)[], teamLabels: string[] = []): Team {
  return {
    id,
    tournamentId: "t1",
    name: id,
    speakers: speakerCategories.map((categories, index) => ({
      id: `${id}-${index}`,
      name: `${id} ${index}`,
      ...(categories ? { categories } : {}),
    })),
    breakCategories: [],
    speakerCategories: teamLabels,
  };
}

function row(speakerId: string, rank: number, categories: string[], ineligible = false): SpeakerStandingRow {
  return {
    rank,
    speakerId,
    speakerName: speakerId,
    teamId: "t",
    teamName: "t",
    categories,
    totalScore: 0,
    averageScore: 0,
    speechesCount: 0,
    scoresByRound: [],
    metrics: {} as SpeakerStandingRow["metrics"],
    ...(ineligible ? { ineligible } : {}),
  };
}

describe("speaker category references", () => {
  it("slugifies names", () => {
    expect(slugifyCategory("  English as a Second Language ")).toBe("english-as-a-second-language");
    expect(slugifyCategory("Débutant")).toBe("debutant");
  });

  it("resolves ids, slugs and legacy names to ids", () => {
    expect(resolveSpeakerCategoryIds(["cat-esl", "NOVICE", "esl", "unknown"], [esl, novice])).toEqual(["cat-esl", "cat-novice"]);
    expect(speakerCategoryNames(["novice", "cat-esl"], [esl, novice])).toEqual(["ESL", "Novice"]);
  });

  it("migrates free-text labels to unsaved categories without touching saved ones", () => {
    const effective = effectiveSpeakerCategories([esl], [
      team("a", [["esl", "Novice"], ["novice"]]),
      team("b", [undefined], ["Pro-Am"]),
    ]);
    expect(effective).toEqual([
      esl,
      { id: "spkcat-novice", name: "Novice", slug: "novice", seq: 2, public: false, unsaved: true },
      { id: "spkcat-pro-am", name: "Pro-Am", slug: "pro-am", seq: 3, public: false, unsaved: true },
    ]);
    expect(toStoredSpeakerCategories(effective)[1]).toEqual({ id: "spkcat-novice", name: "Novice", slug: "novice", seq: 2, public: false });
  });

  it("validates names, slugs and limits", () => {
    expect(validateSpeakerCategories([esl, { ...novice, name: "esl", slug: "esl" }, { ...novice, id: "x", name: "X", slug: "x", limit: -1 }]))
      .toEqual([
        'Two categories are called "esl".',
        '"esl" and "ESL" have the same slug "esl".',
        'The public limit for "X" must be a whole number of at least 0.',
      ]);
    expect(validateSpeakerCategories([esl, novice])).toEqual([]);
  });
});

describe("speakerRowsInCategory", () => {
  const rows = [
    row("a", 1, ["cat-esl"]),
    row("b", 2, []),
    row("c", 3, ["esl"]),
    row("d", 3, ["cat-esl"]),
    row("e", 0, ["cat-esl"], true),
    row("f", 6, ["cat-esl"]),
  ];

  it("ranks within the category, keeping ties and unranked speakers", () => {
    expect(speakerRowsInCategory(rows, "cat-esl", [esl]).map((item) => [item.speakerId, item.rank])).toEqual([
      ["a", 1], ["c", 2], ["d", 2], ["e", 0], ["f", 4],
    ]);
  });

  it("applies the public limit to ranks", () => {
    expect(speakerRowsInCategory(rows, "cat-esl", [esl], 2).map((item) => item.speakerId)).toEqual(["a", "c", "d"]);
  });
});

describe("break eligibility from speaker categories", () => {
  const categories = [esl, novice];
  const eslBreak: BreakCategory = {
    id: "bc-esl", tournamentId: "t1", name: "ESL", slug: "esl", seq: 2, breakSize: 4, reserveSize: 0,
    isGeneral: false, priority: 1, speakerCategoryRule: { speakerCategoryId: "cat-esl" },
  };

  it("requires every speaker by default, or a minimum number", () => {
    const mixed = team("mixed", [["cat-esl"], []]);
    expect(teamMeetsEligibilityRule(mixed, { speakerCategoryId: "cat-esl" }, categories)).toBe(false);
    expect(teamMeetsEligibilityRule(mixed, { speakerCategoryId: "cat-esl", minimumSpeakers: 1 }, categories)).toBe(true);
    expect(teamMeetsEligibilityRule(team("empty", []), { speakerCategoryId: "cat-esl", minimumSpeakers: 0 }, categories)).toBe(false);
  });

  it("uses team-wide legacy labels for speakers without their own", () => {
    expect(teamMeetsEligibilityRule(team("legacy", [undefined, undefined], ["ESL"]), { speakerCategoryId: "cat-esl" }, categories)).toBe(true);
  });

  it("plans additions and removals without touching other categories", () => {
    const teams = [
      { ...team("all-esl", [["cat-esl"], ["esl"]]), breakCategories: ["bc-novice"] },
      { ...team("not-esl", [["cat-esl"], []]), breakCategories: ["bc-esl"] },
      { ...team("kept", [["cat-esl"], ["cat-esl"]]), breakCategories: ["bc-esl"] },
    ];
    const change = planEligibilityFromSpeakerCategories(teams, eslBreak, categories);
    expect(change.teamsToAdd.map((item) => item.id)).toEqual(["all-esl"]);
    expect(change.teamsToRemove.map((item) => item.id)).toEqual(["not-esl"]);
    expect(change.updated.map((item) => [item.id, item.breakCategories])).toEqual([
      ["all-esl", ["bc-novice", "bc-esl"]],
      ["not-esl", []],
    ]);
    expect(planEligibilityFromSpeakerCategories(teams, { ...eslBreak, isGeneral: true }, categories).updated).toEqual([]);
  });
});
