import { describe, expect, it, vi } from "vitest";
import type { Adjudicator, Institution, Team } from "@/types";
import type { RegistrationSubmission } from "@/lib/registration/types";
import { createTournamentEntityCommands } from "./entities";
import {
  ApprovalIncompleteError,
  approveRegistration,
  likelyCreatedEntities,
  type ApprovalDependencies,
  type RegistrationReviewApi,
} from "./registrationApproval";

const base = { submittedAt: "", updatedAt: "", revision: 1, answers: {}, contactName: "Coach", contactEmail: "c@x.org" };

const teamSubmission: RegistrationSubmission = {
  ...base,
  id: "s-team",
  status: "pending",
  kind: "team",
  institution: { name: "BRAC University", key: "brac university" },
  team: { name: "BRAC A", speakers: [{ name: "Ana", email: "ana@x.org", categories: ["ESL"] }, { name: "Bo", categories: [] }] },
};

const adjudicatorSubmission: RegistrationSubmission = {
  ...base,
  id: "s-adj",
  status: "pending",
  kind: "adjudicator",
  institution: { name: "University of Dhaka", key: "university of dhaka" },
  adjudicator: { name: "Cara", email: "cara@x.org", institutionConflicts: ["BRAC University"], teamConflicts: ["Ghost"] },
};

function fakeApi(overrides: Partial<RegistrationReviewApi> = {}) {
  const calls: string[] = [];
  const api: RegistrationReviewApi = {
    claim: vi.fn(async (submission) => {
      calls.push("claim");
      return { ...submission, status: "approving", revision: submission.revision + 1 };
    }),
    release: vi.fn(async (submission) => {
      calls.push("release");
      return { ...submission, status: "pending", revision: submission.revision + 1 };
    }),
    approve: vi.fn(async (submission, entity) => {
      calls.push(`approve:${entity.id}`);
      return { ...submission, status: "approved", approvedEntityId: entity.id, approvedEntityName: entity.name };
    }),
    ...overrides,
  };
  return { api, calls };
}

/** Wires the real entity commands to in-memory collections, as TournamentContext does. */
function dependencies(api: RegistrationReviewApi, institutions: Institution[] = [{ id: "i-du", tournamentId: "t1", name: "University of Dhaka", code: "DU" }]) {
  const state = { institutions: [...institutions], teams: [] as Team[], adjudicators: [] as Adjudicator[] };
  let id = 0;
  const commands = () =>
    createTournamentEntityCommands({
      tournamentId: "t1",
      institutions: state.institutions,
      teams: state.teams,
      adjudicators: state.adjudicators,
      venues: [],
      motions: [],
      debates: [],
      ballots: [],
      feedback: [],
      repositories: {
        institutions: { save: (items) => void (state.institutions = items) },
        teams: { save: (items) => void (state.teams = items) },
        adjudicators: { save: (items) => void (state.adjudicators = items) },
        venues: { save: () => undefined },
        motions: { save: () => undefined },
      },
      recordAuditEvent: async () => undefined,
      createId: (prefix) => `${prefix}-${(id += 1)}`,
      generatePrivateKey: (prefix) => `${prefix ?? "pass"}_key${(id += 1)}`,
    });
  const deps: ApprovalDependencies = {
    api,
    institutions: state.institutions,
    teams: [],
    addInstitutions: (items) => commands().addInstitutions(items),
    addTeams: (items) => commands().addTeams(items),
    addAdjudicators: (items) => commands().addAdjudicators(items),
    createId: (prefix) => `${prefix}-${(id += 1)}`,
    adjudicatorBaseScore: 5,
  };
  return { deps, state };
}

describe("approveRegistration", () => {
  it("claims, creates the team with private URL keys and a new institution, then approves", async () => {
    const { api, calls } = fakeApi();
    const { deps, state } = dependencies(api);
    const result = await approveRegistration(teamSubmission, deps);

    expect(state.institutions.map((institution) => institution.name)).toEqual(["University of Dhaka", "BRAC University"]);
    expect(result.createdInstitution).toMatchObject({ name: "BRAC University", code: "BU" });
    const [team] = state.teams;
    expect(team).toMatchObject({ name: "BRAC A", institutionId: result.createdInstitution!.id, institutionName: "BRAC University" });
    expect(team.privateUrlKey).toMatch(/^team_/);
    expect(team.privatePasscode).toBeTruthy();
    expect(team.speakers.map((speaker) => speaker.categories)).toEqual([["ESL"], undefined]);
    expect(calls).toEqual(["claim", `approve:${team.id}`]);
    expect(result.submission.status).toBe("approved");
    expect(result.entity).toEqual({ id: team.id, name: "BRAC A", kind: "team" });
  });

  it("reuses a matching institution and maps adjudicator conflicts", async () => {
    const { api } = fakeApi();
    const { deps, state } = dependencies(api, [
      { id: "i-du", tournamentId: "t1", name: "University of Dhaka", code: "DU" },
      { id: "i-brac", tournamentId: "t1", name: "BRAC University", code: "BRAC" },
    ]);
    const result = await approveRegistration(adjudicatorSubmission, deps);
    expect(result.createdInstitution).toBeUndefined();
    expect(state.adjudicators[0]).toMatchObject({
      name: "Cara",
      institutionId: "i-du",
      conflicts: [{ type: "institution", institutionId: "i-brac" }],
      baseScore: 5,
    });
    expect(state.adjudicators[0].privateUrlKey).toMatch(/^adj_/);
    expect(result.unmatchedConflicts).toEqual(["Ghost"]);
  });

  it("releases the claim when creating the record fails, creating nothing", async () => {
    const { api, calls } = fakeApi();
    const { deps, state } = dependencies(api);
    deps.addTeams = async () => {
      throw new Error("Round 3 is locked");
    };
    await expect(approveRegistration(teamSubmission, deps)).rejects.toThrow("Round 3 is locked");
    expect(calls).toEqual(["claim", "release"]);
    expect(state.teams).toEqual([]);
  });

  it("creates nothing when the claim is refused (another administrator got there first)", async () => {
    const { api } = fakeApi({ claim: async () => Promise.reject(new Error("This submission changed since you loaded it.")) });
    const { deps, state } = dependencies(api);
    await expect(approveRegistration(teamSubmission, deps)).rejects.toThrow(/changed since/);
    expect(state.teams).toEqual([]);
    expect(state.institutions).toHaveLength(1);
  });

  it("reports a created record whose approval could not be recorded", async () => {
    const { api } = fakeApi({ approve: async () => Promise.reject(new Error("offline")) });
    const { deps, state } = dependencies(api);
    const error = await approveRegistration(teamSubmission, deps).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApprovalIncompleteError);
    expect((error as ApprovalIncompleteError).entity).toEqual({ id: state.teams[0].id, name: "BRAC A" });
    expect((error as ApprovalIncompleteError).message).toMatch(/Mark approved/);
  });

  it("refuses submissions that are not pending", async () => {
    const { api } = fakeApi();
    const { deps } = dependencies(api);
    await expect(approveRegistration({ ...teamSubmission, status: "approved" }, deps)).rejects.toThrow(/pending/);
    expect(api.claim).not.toHaveBeenCalled();
  });
});

describe("likelyCreatedEntities", () => {
  it("finds the team or adjudicator a stuck approval probably created", () => {
    expect(likelyCreatedEntities(teamSubmission, [{ id: "t1", name: "brac  a" }, { id: "t2", name: "Other" }], [])).toEqual([
      { id: "t1", name: "brac  a" },
    ]);
    expect(
      likelyCreatedEntities(adjudicatorSubmission, [], [{ id: "a1", name: "C. Judge", email: "CARA@x.org" }, { id: "a2", name: "Dan" }])
    ).toEqual([{ id: "a1", name: "C. Judge" }]);
  });
});
