import { describe, expect, it } from "vitest";

import type { BreakCategory } from "@/types";
import { parseTeamsCsv } from "@/lib/csv/importer";
import {
  formatCategoryList,
  parseCategoryList,
  resolveBreakCategoryRefs,
  selectableBreakCategories,
} from "./teamCategories";

const category = (overrides: Partial<BreakCategory>): BreakCategory => ({
  id: "bc-esl",
  tournamentId: "t1",
  name: "ESL",
  slug: "esl",
  seq: 2,
  breakSize: 4,
  reserveSize: 0,
  isGeneral: false,
  priority: 5,
  ...overrides,
});
const categories = [
  category({ id: "bc-open", name: "Open", slug: "open", seq: 1, isGeneral: true, priority: 10 }),
  category({}),
  category({ id: "bc-novice", name: "Novice Break", slug: "novice-break", seq: 3, priority: 1 }),
];

describe("team category helpers", () => {
  it("normalises, de-duplicates and formats category lists", () => {
    expect(parseCategoryList(" ESL, novice ;esl|  Under   21 ,")).toEqual(["esl", "novice", "under 21"]);
    expect(parseCategoryList("")).toEqual([]);
    expect(formatCategoryList(["esl", "novice"])).toBe("esl, novice");
    expect(formatCategoryList(undefined)).toBe("");
  });

  it("resolves break categories by id, slug or name and reports unknown ones", () => {
    expect(resolveBreakCategoryRefs(["esl", "Novice Break", "bc-esl", "pro-am"], categories)).toEqual({
      ids: ["bc-esl", "bc-novice"],
      unknown: ["pro-am"],
    });
  });

  it("offers only non-general categories, highest priority first", () => {
    expect(selectableBreakCategories(categories).map((item) => item.id)).toEqual(["bc-esl", "bc-novice"]);
  });
});

describe("parseTeamsCsv categories", () => {
  it("imports per-speaker categories and break eligibility", () => {
    const [team] = parseTeamsCsv(
      'name,speaker1,speaker1_categories,speaker2,speaker2_categories,break_categories\nAlpha,Ann,"ESL, Novice",Ben,,"esl; novice-break"',
      "t1",
      categories
    );
    expect(team.speakers.map((speaker) => speaker.categories)).toEqual([["esl", "novice"], undefined]);
    expect(team.breakCategories).toEqual(["bc-esl", "bc-novice"]);
  });

  it("rejects an unknown break category with the row number", () => {
    expect(() =>
      parseTeamsCsv("name,speaker1,speaker2,break_categories\nAlpha,Ann,Ben,esl\nBeta,Cat,Dan,pro-am", "t1", categories)
    ).toThrow("Unknown break category on CSV row 3: pro-am");
  });

  it("keeps eligibility empty when the column is absent", () => {
    expect(parseTeamsCsv("name,speaker1,speaker2\nAlpha,Ann,Ben", "t1")[0].breakCategories).toEqual([]);
  });
});
