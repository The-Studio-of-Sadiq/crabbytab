import { describe, expect, it } from "vitest";
import type { DocumentReference } from "firebase-admin/firestore";
import { createFakeAdminFirestore } from "@/test/fakeAdminFirestore";
import { channelRefusal, registrationChannels } from "@/lib/registration/access";
import { institutionResponseView } from "@/lib/registration/institutionResponse";
import { applyNameGenerators } from "@/lib/registration/names";
import { findRegistrationDuplicates } from "@/lib/registration/review";
import {
  describeRepresentative,
  issueInstitutionLanding,
  issueRepresentative,
  loadRepresentativeByToken,
  requestSlotTransfer,
  submitRegistration,
} from "@/lib/registration/service";
import type { RegistrationRepresentative, RegistrationSettings, RegistrationSubmission } from "@/lib/registration/types";
import {
  defaultRegistrationSettings,
  entryName,
  parseRegistrationEntry,
  parseRegistrationSettings,
  toPublicForm,
} from "@/lib/registration/validation";

/**
 * Tabbycat registration preferences: open_team_registration / open_adj_registration /
 * institution_participant_registration, team_name_generator (no name asked), reg_speaker_fields /
 * reg_adjudicator_fields (email, categories) and the institution registration email's landing link.
 */

const NOW = Date.parse("2026-10-20T10:00:00Z");
const T = "tournaments/t1";
const SETTINGS = `${T}/serverOnly/registration`;
const REPS = `${SETTINGS}/representatives`;

function settings(overrides: Partial<RegistrationSettings> = {}): RegistrationSettings {
  return { ...defaultRegistrationSettings("Spring Open", 2), enabled: true, speakerCategories: ["ESL"], ...overrides };
}

function createStore(registration: RegistrationSettings, extra: Record<string, Record<string, unknown>> = {}) {
  const fake = createFakeAdminFirestore({
    [T]: { name: "Spring Open", slug: "spring", ownerId: "owner" },
    [SETTINGS]: registration as unknown as Record<string, unknown>,
    ...extra,
  });
  const tournamentRef = fake.firestore.collection("tournaments").doc("t1") as unknown as DocumentReference;
  return { ...fake, tournamentRef };
}

const teamInput = (overrides: Record<string, unknown> = {}) => ({
  kind: "team",
  institution: "Dhaka",
  contactName: "Coach",
  contactEmail: "coach@example.com",
  team: { name: "Dhaka A", speakers: [{ name: "Ana Rahman", email: "ana@example.com", categories: ["ESL"] }, { name: "Bo Islam", categories: [] }] },
  answers: {},
  ...overrides,
});

const adjudicatorInput = (adjudicator: Record<string, unknown> = {}) => ({
  kind: "adjudicator",
  institution: "Dhaka",
  contactName: "Judge",
  contactEmail: "judge@example.com",
  adjudicator: { name: "Judge Dee", institutionConflicts: [], teamConflicts: [], ...adjudicator },
  answers: {},
});

function representative(overrides: Partial<RegistrationRepresentative> = {}) {
  const issued = issueRepresentative(
    { institution: { name: "Dhaka", key: "dhaka" }, email: "rep@dhaka.edu", name: "Rep" },
    { tournamentId: "t1", actorUid: "owner", now: NOW }
  );
  return { record: { ...issued.record, ...overrides }, token: issued.token };
}

describe("registration channels (open_team_registration, open_adj_registration, institution_participant_registration)", () => {
  it("reads settings without the per-kind switches exactly as before", () => {
    expect(registrationChannels(settings(), "team")).toEqual({ open: true, representative: true });
    expect(registrationChannels(settings({ representativesOnly: true }), "adjudicator")).toEqual({ open: false, representative: true });
    expect(registrationChannels(settings({ teamRegistration: false }), "team")).toEqual({ open: false, representative: false });
    const form = toPublicForm(settings({ representativesOnly: true }), NOW);
    expect(form).toMatchObject({ representativesOnly: true, openTeamRegistration: false, openAdjudicatorRegistration: false, institutionParticipantRegistration: true });
  });

  it("opens teams and adjudicators separately", () => {
    const split = settings({ representativesOnly: true, openAdjudicatorRegistration: true });
    expect(channelRefusal(split, "adjudicator", false)).toBeNull();
    expect(channelRefusal(split, "team", false)).toMatch(/representatives only/);
    expect(channelRefusal(split, "team", true)).toBeNull();
    const noReps = settings({ institutionParticipantRegistration: false });
    expect(channelRefusal(noReps, "team", true)).toMatch(/cannot register/);
    expect(channelRefusal(noReps, "team", false)).toBeNull();
    // The public form no longer reports "representatives only" while adjudicators register openly.
    expect(toPublicForm(split, NOW).representativesOnly).toBe(false);
  });

  it("stores the switches only when the settings form sends them", () => {
    const old = parseRegistrationSettings({ ...settings(), representativesOnly: true }, "Spring Open");
    expect(old).not.toHaveProperty("openTeamRegistration");
    expect(old).not.toHaveProperty("askAdjudicatorEmail");
    const parsed = parseRegistrationSettings(
      { ...settings(), openTeamRegistration: false, openAdjudicatorRegistration: true, institutionParticipantRegistration: false, askAdjudicatorEmail: false },
      "Spring Open"
    );
    expect(parsed).toMatchObject({ openTeamRegistration: false, openAdjudicatorRegistration: true, institutionParticipantRegistration: false, askAdjudicatorEmail: false, representativesOnly: false });
  });

  it("enforces the channels when a registration is submitted", async () => {
    const { record, token } = representative();
    const context = createStore(settings({ openTeamRegistration: false, openAdjudicatorRegistration: true }), { [`${REPS}/${record.id}`]: record as unknown as Record<string, unknown> });
    await expect(submitRegistration({ ...context, registration: teamInput(), now: NOW })).rejects.toThrow(/representatives only/);
    await expect(submitRegistration({ ...context, registration: adjudicatorInput({ email: "dee@example.com" }), now: NOW })).resolves.toMatchObject({ kind: "adjudicator" });
    await expect(submitRegistration({ ...context, registration: teamInput(), representativeToken: token, now: NOW })).resolves.toMatchObject({ kind: "team" });

    const noReps = createStore(settings({ institutionParticipantRegistration: false }), { [`${REPS}/${record.id}`]: record as unknown as Record<string, unknown> });
    await expect(submitRegistration({ ...noReps, registration: teamInput(), representativeToken: token, now: NOW })).rejects.toThrow(/cannot register/);
    await expect(submitRegistration({ ...noReps, registration: teamInput(), now: NOW })).resolves.toMatchObject({ kind: "team" });
  });
});

describe("team_name_generator", () => {
  const generated = settings({ teamNameGenerator: "alphabetical" });

  it("asks for no team name when a generator names teams", () => {
    expect(toPublicForm(generated, NOW).teamNameGenerated).toBe(true);
    expect(toPublicForm(settings(), NOW).teamNameGenerated).toBe(false);
    const entry = parseRegistrationEntry(teamInput({ team: { speakers: [{ name: "Ana Rahman" }, { name: "Bo Islam" }] } }), generated);
    expect(entry.team?.name).toBe("");
    expect(entryName(entry)).toBe("Ana Rahman & Bo Islam");
    // Still required when registrants name their own teams.
    expect(() => parseRegistrationEntry(teamInput({ team: { speakers: [{ name: "A" }, { name: "B" }] } }), settings())).toThrow(/team name/i);
  });

  it("names the team on approval, and never leaves it nameless", () => {
    const team = { name: "", institutionId: "i1", speakers: [{ name: "Ana Rahman" }, { name: "Bo Islam" }] };
    expect(applyNameGenerators(team, { settings: { teamNameGenerator: "alphabetical" }, institutionName: "Dhaka", teams: [] }).name).toBe("Dhaka A");
    expect(applyNameGenerators(team, { settings: { teamNameGenerator: "user" }, institutionName: "Dhaka", teams: [] }).name).toBe("Rahman & Islam");
  });

  it("does not flag nameless registrations as duplicates of each other", () => {
    const base = { status: "pending", institution: null, contactName: "C", contactEmail: "c@x.org", answers: {}, submittedAt: "", updatedAt: "", revision: 1 } as const;
    const submissions = [
      { ...base, id: "s1", kind: "team", team: { name: "", speakers: [{ name: "A", categories: [] }] } },
      { ...base, id: "s2", kind: "team", team: { name: "", speakers: [{ name: "B", categories: [] }] } },
      { ...base, id: "s3", kind: "adjudicator", adjudicator: { name: "J1", institutionConflicts: [], teamConflicts: [] } },
      { ...base, id: "s4", kind: "adjudicator", adjudicator: { name: "J2", institutionConflicts: [], teamConflicts: [] } },
    ] as RegistrationSubmission[];
    expect(findRegistrationDuplicates(submissions, [], [{ id: "a1", name: "Old", email: "" }]).size).toBe(0);
  });
});

describe("reg_speaker_fields / reg_adjudicator_fields", () => {
  it("keeps asking for email and categories when the settings do not say otherwise", () => {
    const entry = parseRegistrationEntry(teamInput(), settings({ speakerCategories: ["ESL"] }));
    expect(entry.team?.speakers[0]).toMatchObject({ email: "ana@example.com", categories: ["ESL"] });
    expect(() => parseRegistrationEntry(adjudicatorInput(), settings())).toThrow(/email/);
  });

  it("drops speaker email and categories, and adjudicator email, when they are switched off", () => {
    const off = settings({ speakerCategories: ["ESL"], askSpeakerEmail: false, askSpeakerCategories: false, askAdjudicatorEmail: false });
    const entry = parseRegistrationEntry(teamInput(), off);
    expect(entry.team?.speakers[0]).toEqual({ name: "Ana Rahman", categories: [] });
    const adjudicator = parseRegistrationEntry(adjudicatorInput({ email: "not an email" }), off);
    expect(adjudicator.adjudicator).not.toHaveProperty("email");
    expect(toPublicForm(off, NOW)).toMatchObject({ askSpeakerEmail: false, askSpeakerCategories: false, askAdjudicatorEmail: false });
  });
});

describe("institution registration landing link", () => {
  const institutionSubmission = {
    kind: "institution" as const,
    institution: { name: "Dhaka", key: "dhaka" },
    contactEmail: "rep@dhaka.edu",
    contactName: "Rep",
  };

  it("issues a link awaiting places, without touching an existing representative", async () => {
    const context = createStore(settings({ institutionRegistration: true, slotTransfers: true }));
    const token = await issueInstitutionLanding({ ...context, submission: institutionSubmission, now: NOW });
    expect(token).toBeTruthy();
    const record = await loadRepresentativeByToken(context.tournamentRef, token);
    expect(record).toMatchObject({ awaitingPlaces: true, email: "rep@dhaka.edu", status: "active" });
    expect(await issueInstitutionLanding({ ...context, submission: institutionSubmission, now: NOW })).toBeNull();

    // The link cannot register anyone or give places away yet.
    await expect(submitRegistration({ ...context, registration: teamInput(), representativeToken: token!, now: NOW })).rejects.toThrow(/not been allocated/);
    await expect(
      requestSlotTransfer({ tournamentRef: context.tournamentRef, representative: record, toRepresentativeId: "x", teams: 1, adjudicators: 0, now: NOW })
    ).rejects.toThrow(/not been allocated/);
    const view = await describeRepresentative(context.tournamentRef, record, settings({ slotTransfers: true }));
    expect(view).toEqual({ institutionName: "Dhaka", name: "Rep", awaitingPlaces: true, remaining: { team: 0, adjudicator: 0 } });
  });

  it("keeps the landing link working once places are allocated, but not after a new link", async () => {
    const context = createStore(settings({ institutionRegistration: true }));
    const landing = (await issueInstitutionLanding({ ...context, submission: institutionSubmission, now: NOW }))!;
    const previous = await loadRepresentativeByToken(context.tournamentRef, landing);
    const allocated = issueRepresentative(
      { institution: previous.institution, email: previous.email, name: previous.name, teamQuota: 2 },
      { tournamentId: "t1", actorUid: "owner", now: NOW, previous, keepLandingLink: true }
    );
    expect(allocated.record).not.toHaveProperty("awaitingPlaces");
    context.store.set(`${REPS}/${previous.id}`, allocated.record as unknown as Record<string, unknown>);
    await expect(loadRepresentativeByToken(context.tournamentRef, landing)).resolves.toMatchObject({ teamQuota: 2 });
    await expect(loadRepresentativeByToken(context.tournamentRef, allocated.token)).resolves.toMatchObject({ teamQuota: 2 });
    await expect(submitRegistration({ ...context, registration: teamInput(), representativeToken: landing, now: NOW })).resolves.toMatchObject({ kind: "team" });

    const rotated = issueRepresentative(
      { institution: previous.institution, email: previous.email, name: previous.name },
      { tournamentId: "t1", actorUid: "owner", now: NOW, previous: allocated.record }
    );
    context.store.set(`${REPS}/${previous.id}`, rotated.record as unknown as Record<string, unknown>);
    await expect(loadRepresentativeByToken(context.tournamentRef, landing)).rejects.toThrow(/not valid/);
  });

  it("shows a link awaiting places only its own request, not what others registered for the institution", () => {
    const base = { status: "pending", answers: {}, updatedAt: "", revision: 1, contactName: "C" } as const;
    const submissions = [
      { ...base, id: "own", kind: "institution", institution: { name: "Dhaka", key: "dhaka" }, contactEmail: "rep@dhaka.edu", submittedAt: "2", institutionRequest: { teamsRequested: 2, adjudicatorsRequested: 1 } },
      { ...base, id: "team", kind: "team", institution: { name: "Dhaka", key: "dhaka" }, contactEmail: "other@x.org", submittedAt: "1", team: { name: "Dhaka A", speakers: [] } },
    ] as RegistrationSubmission[];
    const rep = { id: "r1", institution: { name: "Dhaka", key: "dhaka" }, email: "rep@dhaka.edu" };
    expect(institutionResponseView(submissions, { ...rep, awaitingPlaces: true }).map((item) => item.id)).toEqual(["own"]);
    expect(institutionResponseView(submissions, rep).map((item) => item.id)).toEqual(["own", "team"]);
  });
});
