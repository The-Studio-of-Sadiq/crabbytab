import { describe, expect, it } from "vitest";

import type { Institution, Team } from "@/types";
import { parseTeamSeed, seedTitle } from "@/lib/teamSeeds";
import { buildImportCommit, planImport, type CommitContext, type PlannedTeam } from "./importPlan";

const institutions: Institution[] = [{ id: "inst-oxf", tournamentId: "t1", name: "Oxford Union", code: "OXF" }];

let counter = 0;
const context = (overrides: Partial<CommitContext> = {}): CommitContext => ({
  tournamentId: "t1",
  institutions,
  teams: [],
  adjudicators: [],
  substantiveSpeakers: 2,
  createId: (prefix) => `${prefix}-${++counter}`,
  ...overrides,
});

describe("parseTeamSeed", () => {
  it("reads numbers in numeric mode and treats blank as no seed (not 0)", () => {
    expect(parseTeamSeed("4", "numeric")).toEqual({ ok: true, seed: 4 });
    expect(parseTeamSeed(" 0 ", "numeric")).toEqual({ ok: true, seed: 0 });
    expect(parseTeamSeed("", "numeric")).toEqual({ ok: true, seed: undefined });
    expect(parseTeamSeed(undefined, "title")).toEqual({ ok: true, seed: undefined });
    for (const bad of ["-1", "1.5", "abc", "1e3", "100000"]) expect(parseTeamSeed(bad, "numeric").ok).toBe(false);
  });

  it("reads Tabbycat's seed titles (and 0–3) in title mode", () => {
    expect(parseTeamSeed("Full seed", "title")).toEqual({ ok: true, seed: 3 });
    expect(parseTeamSeed("half-seed", "title")).toEqual({ ok: true, seed: 2 });
    expect(parseTeamSeed("FREE", "title")).toEqual({ ok: true, seed: 1 });
    expect(parseTeamSeed("Unseeded", "title")).toEqual({ ok: true, seed: 0 });
    expect(parseTeamSeed("2", "title")).toEqual({ ok: true, seed: 2 });
    expect(parseTeamSeed("4", "title").ok).toBe(false);
    expect(parseTeamSeed("Quarter seed", "title").ok).toBe(false);
    expect(seedTitle(3)).toBe("Full seed");
    expect(seedTitle(7)).toBeUndefined();
  });

  it("refuses a seed when seeds are off", () => {
    expect(parseTeamSeed("3", "off").ok).toBe(false);
    expect(parseTeamSeed("", "off")).toEqual({ ok: true, seed: undefined });
  });
});

describe("team CSV import: seed column", () => {
  const csv = "name,institution,speaker1,speaker2,seed\nA1,Oxford Union,Ann,Ben,3\nA2,Oxford Union,Cat,Dan,\nA3,Oxford Union,Eve,Fay,x";

  it("ignores the seed column when seeds are off (the default)", () => {
    const plan = planImport("teams", csv, context());
    expect(plan.ignoredColumns).toEqual(["seed"]);
    expect(plan.rows.every((row) => row.issues.every((issue) => issue.severity !== "error"))).toBe(true);
    const { commit } = buildImportCommit(plan, {}, context());
    expect(commit?.teamsCreated.map((team) => team.seed)).toEqual([undefined, undefined, undefined]);
  });

  it("validates numeric seeds per row and imports them", () => {
    const plan = planImport("teams", csv, context({ teamSeedMode: "numeric" }));
    expect(plan.ignoredColumns).toEqual([]);
    expect(plan.rows[2].issues).toEqual([
      expect.objectContaining({ severity: "error", message: expect.stringMatching(/"x" is not a valid seed.*row 4/) }),
    ]);
    expect(plan.rows[2].actions).toEqual(["skip"]);
    expect(plan.rows[0].details).toContain("seed 3");
    const { commit } = buildImportCommit(plan, { validRowsOnly: true }, context({ teamSeedMode: "numeric" }));
    expect(commit?.teamsCreated.map((team) => [team.name, team.seed])).toEqual([["A1", 3], ["A2", undefined]]);
  });

  it("reads seed titles in title mode and keeps an existing seed on a blank update", () => {
    const existing: Team = {
      id: "team-x",
      tournamentId: "t1",
      name: "A2",
      institutionId: "inst-oxf",
      institutionName: "Oxford Union",
      speakers: [{ id: "s1", name: "Cat" }, { id: "s2", name: "Dan" }],
      breakCategories: [],
      speakerCategories: [],
      seed: 2,
    };
    const titled = "name,institution,speaker1,speaker2,Seed\nA1,Oxford Union,Ann,Ben,Half seed\nA2,Oxford Union,Cat,Dan,";
    const ctx = context({ teamSeedMode: "title", teams: [existing] });
    const plan = planImport("teams", titled, ctx);
    expect(plan.rows[0].details).toContain("Half seed");
    const { commit } = buildImportCommit(plan, { actions: { 3: "update" } }, ctx);
    expect((commit?.teamsCreated ?? []).map((team) => team.seed)).toEqual([2]);
    expect(commit?.teamsUpdated.map((team) => team.seed)).toEqual([2]);
    expect((plan.rows[0].draft as PlannedTeam).team.seed).toBe(2);
  });
});
