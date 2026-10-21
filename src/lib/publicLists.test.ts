import { describe, expect, it } from "vitest";

import type { Adjudicator, Institution, Team } from "@/types";
import { getPublicRelease } from "./publicRelease";
import { buildPublicAdjudicatorLists, buildPublicInstitutions, buildPublicParticipants } from "./publicLists";

const team = (id: string, name: string, overrides: Partial<Team> = {}): Team => ({
  id,
  tournamentId: "t1",
  name,
  speakers: [],
  breakCategories: [],
  speakerCategories: [],
  ...overrides,
});

const adjudicator = (id: string, name: string, overrides: Partial<Adjudicator> = {}): Adjudicator => ({
  id,
  tournamentId: "t1",
  name,
  baseScore: 5,
  trainee: false,
  independent: false,
  conflicts: [],
  ...overrides,
});

const institution = (id: string, name: string, region?: string): Institution => ({
  id,
  tournamentId: "t1",
  name,
  code: id.toUpperCase(),
  ...(region ? { region } : {}),
});

describe("buildPublicParticipants", () => {
  it("is empty until the participants list is released", () => {
    const result = buildPublicParticipants([team("a", "Alpha")], [adjudicator("j", "Judge")], getPublicRelease({}));
    expect(result).toEqual({ teams: [], adjudicators: [] });
  });

  it("lists teams with speaker names and adjudicators, sorted by name", () => {
    const result = buildPublicParticipants(
      [
        team("b", "beta", { speakers: [{ id: "s1", name: "Bo", email: "bo@example.com" }] }),
        team("a", "Alpha", { institutionName: "Uni" }),
      ],
      [adjudicator("j2", "Zed"), adjudicator("j1", "Amy", { institutionName: "Uni" })],
      getPublicRelease({ publicParticipants: true })
    );
    expect(result.teams).toEqual([
      { id: "a", name: "Alpha", institutionName: "Uni", speakers: [] },
      { id: "b", name: "beta", institutionName: undefined, speakers: ["Bo"] },
    ]);
    expect(result.adjudicators.map((row) => row.name)).toEqual(["Amy", "Zed"]);
    expect(JSON.stringify(result)).not.toContain("bo@example.com");
  });
});

describe("buildPublicInstitutions", () => {
  const institutions = [institution("u2", "Second", "Asia"), institution("u1", "First")];
  const teams = [team("a", "A", { institutionId: "u1" }), team("b", "B", { institutionId: "u1" })];
  const adjudicators = [adjudicator("j", "J", { institutionId: "u2" })];

  it("is empty until released", () => {
    expect(buildPublicInstitutions(institutions, teams, adjudicators, getPublicRelease({}))).toEqual([]);
  });

  it("omits counts unless the participants list is released too", () => {
    const rows = buildPublicInstitutions(institutions, teams, adjudicators, getPublicRelease({ publicInstitutionsList: true }));
    expect(rows).toEqual([
      { id: "u1", name: "First", code: "U1" },
      { id: "u2", name: "Second", code: "U2", region: "Asia" },
    ]);
    const withCounts = buildPublicInstitutions(
      institutions,
      teams,
      adjudicators,
      getPublicRelease({ publicInstitutionsList: true, publicParticipants: true })
    );
    expect(withCounts.map((row) => [row.id, row.teams, row.adjudicators])).toEqual([
      ["u1", 2, 0],
      ["u2", 0, 1],
    ]);
  });
});

describe("buildPublicAdjudicatorLists", () => {
  const adjudicators = [
    adjudicator("c", "Core", { adjCore: true }),
    adjudicator("b", "Breaker", { breaking: true }),
    adjudicator("n", "Neither"),
  ];

  it("shows each list only when released", () => {
    expect(buildPublicAdjudicatorLists(adjudicators, getPublicRelease({}))).toEqual({ core: [], breaking: [] });
    const lists = buildPublicAdjudicatorLists(
      adjudicators,
      getPublicRelease({ publicAdjudicatorCore: true, publicBreakingAdjudicators: true })
    );
    expect(lists.core.map((row) => row.id)).toEqual(["c"]);
    expect(lists.breaking.map((row) => row.id)).toEqual(["b"]);
  });
});
