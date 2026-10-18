import { describe, expect, it } from "vitest";
import type { Adjudicator } from "@/types";
import {
  adjudicatorConflictIds,
  applyConflictSelection,
  changeAdjudicatorInstitution,
  extraInstitutionConflictIds,
  teamConflictIds,
} from "./conflicts";
import { formatDiversityCounts, panelDiversitySummary, participantRegion } from "./diversity";

const adj = (id: string, extra: Partial<Adjudicator> = {}): Adjudicator => ({
  id,
  tournamentId: "t",
  name: id,
  baseScore: 5,
  trainee: false,
  independent: false,
  conflicts: [],
  ...extra,
});

describe("adjudicator conflicts", () => {
  const withConflicts = adj("a", {
    institutionId: "old",
    institutionName: "Old",
    conflicts: [
      { institutionId: "old", type: "institution" },
      { institutionId: "rival", type: "institution" },
      { teamId: "team-1", type: "personal" },
      { adjudicatorId: "b", type: "personal" },
    ],
  });

  it("keeps team, adjudicator and other institution conflicts when the institution changes", () => {
    const moved = changeAdjudicatorInstitution(withConflicts, { id: "new", name: "New" });
    expect(moved).toMatchObject({ institutionId: "new", institutionName: "New", independent: false });
    expect(moved.conflicts).toEqual([
      { institutionId: "rival", type: "institution" },
      { teamId: "team-1", type: "personal" },
      { adjudicatorId: "b", type: "personal" },
      { institutionId: "new", type: "institution" },
    ]);
    const independent = changeAdjudicatorInstitution(withConflicts, undefined);
    expect(independent.independent).toBe(true);
    expect(independent.conflicts).toHaveLength(3);
  });

  it("reads conflicts declared on either side", () => {
    const others = [withConflicts, adj("c", { conflicts: [{ adjudicatorId: "a", type: "personal" }] }), adj("b")];
    expect(adjudicatorConflictIds(withConflicts, others).sort()).toEqual(["b", "c"]);
    expect(teamConflictIds(withConflicts)).toEqual(["team-1"]);
    expect(extraInstitutionConflictIds(withConflicts)).toEqual(["rival"]);
  });

  it("applies an edited selection and drops conflicts declared by the other adjudicator", () => {
    const c = adj("c", { conflicts: [{ adjudicatorId: "a", type: "personal" }, { teamId: "x", type: "personal" }] });
    const changed = applyConflictSelection(
      withConflicts,
      { teamIds: ["team-2"], adjudicatorIds: ["d"], institutionIds: ["other", "old"] },
      [withConflicts, c, adj("b"), adj("d")]
    );
    expect(changed).toHaveLength(2);
    expect(changed[0].conflicts).toEqual([
      { institutionId: "old", type: "institution" },
      { institutionId: "other", type: "institution" },
      { teamId: "team-2", type: "personal" },
      { adjudicatorId: "d", type: "personal" },
    ]);
    expect(changed[1]).toMatchObject({ id: "c", conflicts: [{ teamId: "x", type: "personal" }] });
  });

  it("does not duplicate a conflict the other adjudicator already declared", () => {
    const c = adj("c", { conflicts: [{ adjudicatorId: "a", type: "personal" }] });
    const changed = applyConflictSelection(adj("a"), { teamIds: [], adjudicatorIds: ["c"], institutionIds: [] }, [c]);
    expect(changed).toHaveLength(1);
    expect(changed[0].conflicts).toEqual([]);
  });
});

describe("diversity", () => {
  const institutions = new Map([["i1", { region: "Asia" }], ["i2", { region: "" }]]);

  it("uses a participant's own region before the institution region", () => {
    expect(participantRegion({ institutionId: "i1" }, institutions)).toBe("Asia");
    expect(participantRegion({ institutionId: "i1", region: " Europe " }, institutions)).toBe("Europe");
    expect(participantRegion({ institutionId: "i2" }, institutions)).toBeUndefined();
  });

  it("summarises a panel's gender and region make-up", () => {
    const summary = panelDiversitySummary(
      [
        { gender: "Female", institutionId: "i1" },
        { gender: "female", region: "Europe" },
        { institutionId: "i2" },
      ],
      institutions
    );
    expect(summary.size).toBe(3);
    expect(summary.genders).toEqual([{ label: "Female", count: 2 }, { label: "Unspecified", count: 1 }]);
    expect(formatDiversityCounts(summary.regions)).toBe("1 Asia, 1 Europe, 1 Unspecified");
  });
});
