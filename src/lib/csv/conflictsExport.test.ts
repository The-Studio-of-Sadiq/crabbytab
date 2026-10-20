import { describe, expect, it } from "vitest";
import type { Adjudicator, Institution, Team } from "@/types";
import {
  addTeamInstitutionConflict,
  conflictsCsv,
  describeConflict,
  listDeclaredConflicts,
  removeDeclaredConflict,
} from "./conflictsExport";
import { planConflictsImport } from "./conflictsImport";

const team = (id: string, name: string, extra: Partial<Team> = {}): Team => ({
  id, tournamentId: "t", name, speakers: [], breakCategories: [], speakerCategories: [], ...extra,
});
const adj = (id: string, name: string, extra: Partial<Adjudicator> = {}): Adjudicator => ({
  id, tournamentId: "t", name, baseScore: 5, trainee: false, independent: false, conflicts: [], ...extra,
});
const institutions: Institution[] = [
  { id: "i1", tournamentId: "t", name: "Gamma, University", code: "GU" },
  { id: "i2", tournamentId: "t", name: "Delta", code: "D" },
];

const data = {
  institutions,
  teams: [team("t1", "Alpha A", { institutionId: "i2", institutionConflictIds: ["i1"] }), team("t2", "=Beta")],
  adjudicators: [
    adj("a1", "Sam", { email: "sam1@example.org", conflicts: [{ type: "personal", teamId: "t2" }, { type: "personal", adjudicatorId: "a2" }] }),
    adj("a2", "Sam", { email: "sam2@example.org", conflicts: [{ type: "personal", adjudicatorId: "a1" }] }),
    adj("a3", "Kim", { conflicts: [{ type: "institution", institutionId: "i1" }] }),
  ],
};

describe("declared conflicts", () => {
  it("lists every conflict once, including team-declared institution conflicts", () => {
    const conflicts = listDeclaredConflicts(data);
    expect(conflicts.map((conflict) => conflict.kind)).toEqual([
      "adjudicator-team",
      "adjudicator-adjudicator",
      "adjudicator-institution",
      "team-institution",
    ]);
    expect(describeConflict(conflicts[3], data)).toBe("Alpha A – Gamma, University");
  });

  it("exports a CSV the importer reads back as already recorded", () => {
    const csv = conflictsCsv(data);
    expect(csv.split("\r\n")[0]).toBe("adjudicator,team,institution,other_adjudicator");
    // Shared names are written as emails; commas are quoted; formula-like cells are escaped.
    expect(csv).toContain("sam1@example.org,,,sam2@example.org");
    expect(csv).toContain('"Gamma, University"');
    expect(csv).toContain("'=Beta");
    const plan = planConflictsImport(csv.replace("'=Beta", "=Beta"), data);
    expect(plan.rows.map((row) => row.status)).toEqual(["exists", "exists", "exists", "exists"]);
  });

  it("removes a conflict from both declaring sides", () => {
    const [, pair] = listDeclaredConflicts(data);
    const removed = removeDeclaredConflict(pair, data);
    expect(removed.adjudicators.map((item) => [item.id, item.conflicts.length])).toEqual([["a1", 1], ["a2", 0]]);
    const teamConflict = listDeclaredConflicts(data)[3];
    expect(removeDeclaredConflict(teamConflict, data).teams[0].institutionConflictIds).toEqual([]);
  });

  it("adds team-declared institution conflicts, refusing the team's own institution and duplicates", () => {
    expect(addTeamInstitutionConflict(data.teams[1], "i1").institutionConflictIds).toEqual(["i1"]);
    expect(() => addTeamInstitutionConflict(data.teams[0], "i2")).toThrow(/own institution/);
    expect(() => addTeamInstitutionConflict(data.teams[0], "i1")).toThrow(/already/);
  });
});
