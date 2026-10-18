import { describe, expect, it } from "vitest";

import type { BreakCategory, Round, Team } from "@/types";
import {
  getBreakCategoryDeletionBlocker,
  upsertBreakCategory,
  validateBreakCategoryDraft,
  withTeamOverride,
  type BreakCategoryDraft,
} from "./breaks";

const open: BreakCategory = {
  id: "open",
  tournamentId: "t1",
  name: "Open",
  slug: "open",
  seq: 1,
  breakSize: 8,
  reserveSize: 2,
  isGeneral: true,
  priority: 10,
  teamOverrides: { a: "withdrawn" },
};

const draft: BreakCategoryDraft = {
  name: "ESL",
  breakSize: 4,
  reserveSize: 1,
  priority: 5,
  isGeneral: false,
  maxPerInstitution: 0,
  qualificationRule: "standard",
};

describe("break category editing", () => {
  it("validates names, sizes and limits", () => {
    expect(validateBreakCategoryDraft(draft, [open], 2)).toBe("");
    expect(validateBreakCategoryDraft({ ...draft, name: " open " }, [open], 2)).toMatch(/already/);
    expect(validateBreakCategoryDraft({ ...draft, name: "Open" }, [open], 2, "open")).toBe("");
    expect(validateBreakCategoryDraft({ ...draft, name: "" }, [open], 2)).toMatch(/name/);
    expect(validateBreakCategoryDraft({ ...draft, breakSize: 5 }, [open], 4)).toMatch(/even/);
    expect(validateBreakCategoryDraft({ ...draft, breakSize: 12 }, [open], 2)).toBe("");
    expect(validateBreakCategoryDraft({ ...draft, reserveSize: -1 }, [open], 2)).toMatch(/Reserve/);
  });

  it("adds a category with a unique slug and next sequence", () => {
    const added = upsertBreakCategory([open], { ...draft, name: "Open!" }, "t1", undefined, () => "new");
    expect(added[1]).toMatchObject({ id: "new", slug: "open-2", seq: 2, isGeneral: false, maxPerInstitution: undefined });
  });

  it("edits a category in place, keeping id, overrides and generated break", () => {
    const generated = { ...open, generatedBreak: { breakingTeamIds: ["b"], reserveTeamIds: [], generatedAt: "x" } };
    const [edited] = upsertBreakCategory([generated], { ...draft, name: "Open", isGeneral: true, maxPerInstitution: 2 }, "t1", "open");
    expect(edited).toMatchObject({
      id: "open",
      slug: "open",
      breakSize: 4,
      isGeneral: true,
      maxPerInstitution: 2,
      teamOverrides: { a: "withdrawn" },
      generatedBreak: generated.generatedBreak,
    });
  });

  it("sets and clears team overrides", () => {
    const [withInclude] = withTeamOverride([open], "open", "b", "include");
    expect(withInclude.teamOverrides).toEqual({ a: "withdrawn", b: "include" });
    const [cleared] = withTeamOverride([withInclude], "open", "a", null);
    expect(cleared.teamOverrides).toEqual({ b: "include" });
    expect(open.teamOverrides).toEqual({ a: "withdrawn" });
  });

  it("blocks deleting a category that teams are breaking in or a drawn round uses", () => {
    const team = { id: "a", breakCategoryIds: ["open"] } as Team;
    expect(getBreakCategoryDeletionBlocker(open, [team], [])).toMatch(/generated break/);
    const round = { id: "qf", breakCategoryIds: ["open"], drawStatus: "draft" } as Round;
    expect(getBreakCategoryDeletionBlocker(open, [], [round])).toMatch(/already has a draw/);
    expect(getBreakCategoryDeletionBlocker(open, [], [{ ...round, drawStatus: "none" }])).toBe("");
  });
});
