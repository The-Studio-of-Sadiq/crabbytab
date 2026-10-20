import { describe, expect, it } from "vitest";
import type { Adjudicator, Institution, Team } from "@/types";
import {
  applyVenueConstraintsPlan,
  listVenueConstraints,
  planVenueConstraintsImport,
  withoutVenueConstraint,
  withVenueConstraint,
} from "./constraintEdits";

const team = (id: string, name: string, extra: Partial<Team> = {}): Team => ({
  id, tournamentId: "t", name, speakers: [], breakCategories: [], speakerCategories: [], ...extra,
});
const adjudicator = (id: string, name: string, extra: Partial<Adjudicator> = {}): Adjudicator => ({
  id, tournamentId: "t", name, baseScore: 5, trainee: false, independent: true, conflicts: [], ...extra,
});
const institution = (id: string, name: string, code: string): Institution => ({ id, tournamentId: "t", name, code });

const subjects = {
  teams: [team("t1", "Alpha A", { venueConstraints: [{ category: "Lift", priority: 3 }] }), team("t2", "Beta A")],
  adjudicators: [adjudicator("a1", "Ada", { email: "ada@example.org" }), adjudicator("a2", "Bo"), adjudicator("a3", "Bo")],
  institutions: [institution("i1", "Gamma University", "GU")],
};

describe("editing room preferences", () => {
  it("sets one preference per category and removes it", () => {
    const updated = withVenueConstraint(subjects.teams[0], { category: " lift ", priority: 8 });
    expect(updated.venueConstraints).toEqual([{ category: "lift", priority: 8 }]);
    expect(withoutVenueConstraint(updated, "LIFT").venueConstraints).toBeUndefined();
    expect(() => withVenueConstraint(subjects.teams[1], { category: " ", priority: 1 })).toThrow();
    expect(() => withVenueConstraint(subjects.teams[1], { category: "A", priority: 1.5 })).toThrow();
  });

  it("lists every preference, highest priority first", () => {
    const rows = listVenueConstraints({
      ...subjects,
      institutions: [{ ...subjects.institutions[0], venueConstraints: [{ category: "Purple", priority: 9 }] }],
    });
    expect(rows.map((row) => [row.kind, row.subjectName, row.priority])).toEqual([
      ["institution", "Gamma University", 9],
      ["team", "Alpha A", 3],
    ]);
  });
});

describe("room preferences CSV", () => {
  const csv = [
    "team,adjudicator,institution,category,priority",
    "Alpha A,,,Lift,3",
    "Alpha A,,,Purple,5",
    ",ada@example.org,,Ground floor,7",
    ",,GU,Purple,2",
    ",Bo,,Lift,1",
    "Beta A,Ada,,Lift,1",
    "Nobody,,,Lift,1",
    "Beta A,,,Lift,high",
    "Alpha A,,,purple,6",
  ].join("\n");

  it("plans additions, updates and row errors", () => {
    const plan = planVenueConstraintsImport(csv, subjects);
    expect(plan.fileErrors).toEqual([]);
    expect(plan.rows.map((row) => row.status)).toEqual([
      "exists", "add", "add", "add", "error", "error", "error", "error", "error",
    ]);
    expect(plan.rows[4].issues[0]).toMatch(/matches 2 records/);
    expect(plan.rows[5].issues[0]).toMatch(/exactly one/);
    expect(plan.rows[8].issues[0]).toMatch(/Row 3 already/);
  });

  it("applies only the valid rows", () => {
    const applied = applyVenueConstraintsPlan(planVenueConstraintsImport(csv, subjects), subjects);
    expect(applied.applied).toBe(3);
    expect(applied.teams[0].venueConstraints).toEqual([
      { category: "Lift", priority: 3 },
      { category: "Purple", priority: 5 },
    ]);
    expect(applied.adjudicators.map((item) => item.id)).toEqual(["a1"]);
    expect(applied.institutions[0].venueConstraints).toEqual([{ category: "Purple", priority: 2 }]);
  });

  it("needs category and priority columns", () => {
    expect(planVenueConstraintsImport("team,category\nAlpha A,Lift", subjects).fileErrors).toEqual([
      "The file needs a priority column.",
    ]);
  });
});
