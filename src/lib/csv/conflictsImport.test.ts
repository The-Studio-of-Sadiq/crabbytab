import { describe, expect, it } from "vitest";

import type { Adjudicator, Institution, Team } from "@/types";
import { applyConflictsPlan, planConflictsImport } from "./conflictsImport";

const institutions: Institution[] = [
  { id: "inst-oxf", tournamentId: "t1", name: "Oxford Union", code: "OXF" },
  { id: "inst-cam", tournamentId: "t1", name: "Cambridge Union", code: "CAM" },
];

const teams: Team[] = [
  { id: "team-a", tournamentId: "t1", name: "Oxford A", codeName: "OXA", institutionId: "inst-oxf", speakers: [], breakCategories: [], speakerCategories: [] },
  { id: "team-b", tournamentId: "t1", name: "Cambridge B", institutionId: "inst-cam", speakers: [], breakCategories: [], speakerCategories: [] },
];

function adjudicator(id: string, name: string, overrides: Partial<Adjudicator> = {}): Adjudicator {
  return {
    id, tournamentId: "t1", name, baseScore: 5, trainee: false, independent: false,
    institutionId: "inst-oxf", conflicts: [{ institutionId: "inst-oxf", type: "institution" }], ...overrides,
  };
}

const adjudicators = [
  adjudicator("adj-1", "Eleanor Vance", { email: "ev@example.org" }),
  adjudicator("adj-2", "David Kim", { conflicts: [{ institutionId: "inst-oxf", type: "institution" }, { teamId: "team-b", type: "personal" }] }),
  adjudicator("adj-3", "Sam Lee"),
  adjudicator("adj-4", "Sam Lee", { email: "sam2@example.org" }),
];

const data = { adjudicators, teams, institutions };

describe("planConflictsImport", () => {
  it("imports all four conflict types by name, email or code", () => {
    const plan = planConflictsImport(
      [
        "adjudicator,team,institution,other_adjudicator",
        "Eleanor Vance,OXA,,",
        "ev@example.org,,,David Kim",
        "eleanor vance,,CAM,",
        ",Cambridge B,Oxford Union,",
      ].join("\n"),
      data
    );
    expect(plan.rows.map((row) => [row.kind, row.status])).toEqual([
      ["adjudicator-team", "add"],
      ["adjudicator-adjudicator", "add"],
      ["adjudicator-institution", "add"],
      ["team-institution", "add"],
    ]);

    const applied = applyConflictsPlan(plan, data);
    expect(applied.added).toBe(4);
    expect(applied.adjudicators).toEqual([
      expect.objectContaining({
        id: "adj-1",
        conflicts: [
          { institutionId: "inst-oxf", type: "institution" },
          { teamId: "team-a", type: "personal" },
          { adjudicatorId: "adj-2", type: "personal" },
          { institutionId: "inst-cam", type: "institution" },
        ],
      }),
    ]);
    expect(applied.teams).toEqual([expect.objectContaining({ id: "team-b", institutionConflictIds: ["inst-oxf"] })]);
  });

  it("reports unknown and ambiguous references and malformed rows", () => {
    const plan = planConflictsImport(
      "adjudicator,team,other_adjudicator\nNobody,Oxford A,\nSam Lee,Oxford A,\nEleanor Vance,,Eleanor Vance\nEleanor Vance,Oxford A,David Kim\nsam2@example.org,Cambridge B,",
      data
    );
    expect(plan.rows.map((row) => row.issues[0]?.message)).toEqual([
      'No adjudicator "Nobody".',
      '2 adjudicators are called "Sam Lee"; use a unique value.',
      "An adjudicator cannot conflict with themselves.",
      expect.stringMatching(/Fill exactly two/),
      undefined,
    ]);
    expect(plan.rows.map((row) => row.status)).toEqual(["error", "error", "error", "error", "add"]);
  });

  it("skips conflicts that already exist or repeat in the file", () => {
    const plan = planConflictsImport(
      "adjudicator,team,institution,other_adjudicator\nDavid Kim,Cambridge B,,\nEleanor Vance,,Oxford Union,\n,Oxford A,Oxford Union,\nDavid Kim,,,Sam2@example.org\nsam2@example.org,,,David Kim",
      data
    );
    expect(plan.rows.map((row) => row.status)).toEqual(["exists", "exists", "exists", "add", "exists"]);
    expect(plan.rows[4].issues[0].message).toBe("Same conflict as row 5.");
    expect(applyConflictsPlan(plan, data).added).toBe(1);
  });

  it("refuses files without conflict columns", () => {
    expect(planConflictsImport("name,code\nA,B", data).fileErrors[0]).toMatch(/No conflict columns/);
    expect(planConflictsImport("", data).fileErrors).toEqual(["The file is empty."]);
  });
});
