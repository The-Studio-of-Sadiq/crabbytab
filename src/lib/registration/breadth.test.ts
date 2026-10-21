import { describe, expect, it } from "vitest";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { createFakeAdminFirestore } from "@/test/fakeAdminFirestore";
import { createRegisteredEntity, needsConfirmation } from "@/lib/registration/autoApprove";
import { buildAdjudicatorFromSubmission, buildTeamFromSubmission } from "@/lib/registration/review";
import {
  issueRepresentative,
  markAutoApproved,
  requestSlotTransfer,
  reviewSlotTransfer,
  reviewSubmission,
  submitRegistration,
} from "@/lib/registration/service";
import type { RegistrationSettings } from "@/lib/registration/types";
import {
  defaultRegistrationSettings,
  parseRegistrationEntry,
  parseRegistrationSettings,
  toPublicForm,
} from "@/lib/registration/validation";

const NOW = Date.parse("2026-10-20T10:00:00Z");
const T = "tournaments/t1";
const SETTINGS = `${T}/serverOnly/registration`;
const REPS = `${SETTINGS}/representatives`;

function settings(overrides: Partial<RegistrationSettings> = {}): RegistrationSettings {
  return { ...defaultRegistrationSettings("Spring Open", 2), enabled: true, ...overrides };
}

function createStore(registration: RegistrationSettings = settings(), extra: Record<string, Record<string, unknown>> = {}) {
  const fake = createFakeAdminFirestore({
    [T]: { name: "Spring Open", slug: "spring", ownerId: "owner" },
    [SETTINGS]: registration as unknown as Record<string, unknown>,
    ...extra,
  });
  const tournamentRef = fake.firestore.collection("tournaments").doc("t1") as unknown as DocumentReference;
  return { ...fake, tournamentRef };
}

const team = (overrides: Record<string, unknown> = {}) => ({
  kind: "team",
  institution: "Dhaka",
  contactName: "Coach",
  contactEmail: "coach@example.com",
  team: { name: "Typed", speakers: [{ name: "Ana Rahman", categories: [] }, { name: "Bo Islam", categories: [] }] },
  answers: {},
  ...overrides,
});

describe("registration settings breadth", () => {
  it("parses the new options with safe defaults", () => {
    const parsed = parseRegistrationSettings(
      {
        ...settings(),
        institutionRegistration: true,
        confirmation: "never",
        blockOverAllocation: false,
        slotTransfers: true,
        teamNameGenerator: "numerical",
        codeNameGenerator: "bogus",
        speakerFields: ["phone", "gender", "shoe"],
        teamMessage: "Bring ID",
        speakerQuestions: [{ id: "diet", label: "Diet", type: "text", required: false }],
      },
      "Spring Open"
    );
    expect(parsed).toMatchObject({
      institutionRegistration: true,
      confirmation: "never",
      blockOverAllocation: false,
      slotTransfers: true,
      teamNameGenerator: "numerical",
      codeNameGenerator: "user",
      speakerFields: ["phone", "gender"],
      teamMessage: "Bring ID",
    });
    expect(parseRegistrationSettings({ ...settings(), confirmation: "maybe" }, "x").confirmation).toBe("always");
    const form = toPublicForm(parsed, NOW);
    expect(form.speakerQuestions).toHaveLength(1);
    expect(form).not.toHaveProperty("confirmation");
  });
});

describe("person fields and institution entries", () => {
  const withFields = settings({ speakerFields: ["phone", "gender"], adjudicatorFields: ["phone"], institutionRegistration: true, institutionRegion: true });

  it("maps phone and gender onto real speaker and adjudicator fields", () => {
    const entry = parseRegistrationEntry(
      team({ team: { name: "T", speakers: [{ name: "Ana", categories: [], phone: "+880 1712-345678", gender: "Woman" }, { name: "Bo", categories: [] }] } }),
      withFields
    );
    expect(entry.team?.speakers[0]).toMatchObject({ phone: "+8801712345678", gender: "Woman" });
    const built = buildTeamFromSubmission({ ...entry, id: "s", status: "pending", submittedAt: "", updatedAt: "", revision: 1 }, undefined, (prefix) => `${prefix}-1`);
    expect(built.speakers[0]).toMatchObject({ phone: "+8801712345678", gender: "Woman" });
    expect(() =>
      parseRegistrationEntry(team({ team: { name: "T", speakers: [{ name: "Ana", categories: [], phone: "0171" }, { name: "Bo", categories: [] }] } }), withFields)
    ).toThrow(/country code/);
    const adjudicator = parseRegistrationEntry(
      { kind: "adjudicator", institution: "", contactName: "A", contactEmail: "a@x.org", adjudicator: { name: "Judge", email: "j@x.org", phone: "+447700900123", gender: "ignored" }, answers: {} },
      withFields
    );
    expect(adjudicator.adjudicator).toMatchObject({ phone: "+447700900123" });
    expect(adjudicator.adjudicator).not.toHaveProperty("gender");
    const builtAdjudicator = buildAdjudicatorFromSubmission(
      { ...adjudicator, id: "s", status: "pending", submittedAt: "", updatedAt: "", revision: 1 },
      { institution: undefined, institutions: [], teams: [], baseScore: 5 }
    );
    expect(builtAdjudicator.adjudicator.phone).toBe("+447700900123");
  });

  it("parses institution registrations and refuses them when switched off or via a representative link", () => {
    const entry = parseRegistrationEntry(
      { kind: "institution", institution: "Dhaka", contactName: "Coach", contactEmail: "c@x.org", institutionRequest: { code: "DU", region: "Asia", teamsRequested: "3", adjudicatorsRequested: 2 }, answers: {} },
      withFields
    );
    expect(entry.institutionRequest).toEqual({ code: "DU", region: "Asia", teamsRequested: 3, adjudicatorsRequested: 2 });
    expect(() => parseRegistrationEntry({ ...entry, kind: "institution" }, settings())).toThrow(/not taking institution/);
    expect(() => parseRegistrationEntry({ ...entry }, withFields, { institution: { name: "Dhaka", key: "dhaka" } })).toThrow(/already registered/);
  });
});

describe("over-allocation", () => {
  it("accepts and flags registrations above the institution's places when allowed", async () => {
    const context = createStore(settings({ teamQuotaPerInstitution: 1, blockOverAllocation: false }));
    await submitRegistration({ ...context, registration: team(), now: NOW });
    const second = await submitRegistration({ ...context, registration: team({ team: { name: "Two", speakers: [{ name: "C", categories: [] }, { name: "D", categories: [] }] } }), now: NOW });
    expect(second.submission.overAllocated).toBe(true);
  });

  it("still refuses them by default", async () => {
    const context = createStore(settings({ teamQuotaPerInstitution: 1 }));
    await submitRegistration({ ...context, registration: team(), now: NOW });
    await expect(submitRegistration({ ...context, registration: team(), now: NOW })).rejects.toThrow(/limit of 1 team/);
  });

  it("does not count institution registrations against any places", async () => {
    const context = createStore(settings({ institutionRegistration: true, teamQuotaPerInstitution: 1 }));
    await submitRegistration({
      ...context,
      registration: { kind: "institution", institution: "Dhaka", contactName: "C", contactEmail: "c@x.org", institutionRequest: { teamsRequested: 2 }, answers: {} },
      now: NOW,
    });
    expect(context.store.get(`${T}/serverOnly/registrationCounters`)).toEqual({ teams: 0, adjudicators: 0, institutions: {} });
  });
});

describe("automatic acceptance", () => {
  it("follows registration_confirmation", () => {
    expect(needsConfirmation({ confirmation: "always" }, { kind: "team" })).toBe(true);
    expect(needsConfirmation({ confirmation: "never" }, { kind: "team" })).toBe(false);
    expect(needsConfirmation({ confirmation: "open" }, { kind: "team" })).toBe(true);
    expect(needsConfirmation({ confirmation: "open" }, { kind: "team", representativeId: "r" })).toBe(false);
    expect(needsConfirmation({ confirmation: "never" }, { kind: "institution" })).toBe(true);
  });

  it("creates the team live with private keys and generated names, then marks it approved", async () => {
    const registration = settings({ confirmation: "never", teamNameGenerator: "alphabetical", codeNameGenerator: "last_names" });
    const context = createStore(registration, {
      [`${T}/institutions/inst-1`]: { name: "Dhaka", code: "DU" },
      [`${T}/teams/old`]: { name: "Dhaka A", institutionId: "inst-1", speakers: [] },
    });
    const result = await submitRegistration({ ...context, registration: team(), now: NOW });
    const entity = await createRegisteredEntity({ ...context, submission: result.submission, settings: registration, adjudicatorBaseScore: 5 });
    const stored = context.store.get(`${T}/teams/${entity.entityId}`)!;
    expect(stored).toMatchObject({ name: "Dhaka B", codeName: "Rahman & Islam", institutionId: "inst-1", syncVersion: 1 });
    expect(stored.privateUrlKey).toMatch(/^team_/);
    expect(typeof stored.privatePasscode).toBe("string");
    const approved = await markAutoApproved({ ...context, submission: result.submission, entity, now: NOW });
    expect(approved).toMatchObject({ status: "approved", autoApproved: true, approvedEntityName: "Dhaka B", revision: 2 });
    // A second attempt on the same revision changes nothing.
    expect(await markAutoApproved({ ...context, submission: result.submission, entity, now: NOW })).toBeNull();
  });
});

describe("institution approval", () => {
  it("allocates places to an institution registration only", async () => {
    const context = createStore(settings({ institutionRegistration: true }));
    const { id } = await submitRegistration({
      ...context,
      registration: { kind: "institution", institution: "Dhaka", contactName: "C", contactEmail: "c@x.org", institutionRequest: { teamsRequested: 2 }, answers: {} },
      now: NOW,
    });
    const review = (action: "allocate" | "claim", extra: Record<string, unknown> = {}) =>
      reviewSubmission({
        firestore: context.firestore,
        tournamentRef: context.tournamentRef,
        assertAdministrator: async (_transaction: Transaction) => undefined,
        reviewerUid: "admin",
        action,
        submissionId: id,
        revision: 1,
        now: NOW,
        ...extra,
      });
    await expect(review("claim")).rejects.toThrow(/places instead/);
    const allocated = await review("allocate", { teamsAllocated: 2, adjudicatorsAllocated: "1" });
    expect(allocated).toMatchObject({ status: "approved", teamsAllocated: 2, adjudicatorsAllocated: 1, approvedEntityName: "Dhaka" });
  });
});

describe("slot transfers", () => {
  function representatives() {
    const from = issueRepresentative(
      { institution: { name: "Dhaka", key: "dhaka" }, email: "d@x.org", name: "D", teamQuota: 3 },
      { tournamentId: "t1", actorUid: "admin", now: NOW }
    ).record;
    const to = issueRepresentative(
      { institution: { name: "Chittagong", key: "chittagong" }, email: "c@x.org", name: "C", teamQuota: 1 },
      { tournamentId: "t1", actorUid: "admin", now: NOW }
    ).record;
    return { from, to };
  }

  it("lets a representative ask and an administrator move the places", async () => {
    const { from, to } = representatives();
    const context = createStore(settings({ slotTransfers: true }), {
      [`${REPS}/${from.id}`]: from as unknown as Record<string, unknown>,
      [`${REPS}/${to.id}`]: to as unknown as Record<string, unknown>,
    });
    const transfer = await requestSlotTransfer({ tournamentRef: context.tournamentRef, representative: from, toRepresentativeId: to.id, teams: 2, adjudicators: 0, now: NOW });
    expect(transfer.status).toBe("pending");
    const reviewed = await reviewSlotTransfer({
      firestore: context.firestore,
      tournamentRef: context.tournamentRef,
      assertAdministrator: async () => undefined,
      reviewerUid: "admin",
      transferId: transfer.id,
      approve: true,
      now: NOW,
    });
    expect(reviewed.status).toBe("approved");
    expect(context.store.get(`${REPS}/${from.id}`)?.teamQuota).toBe(1);
    expect(context.store.get(`${REPS}/${to.id}`)?.teamQuota).toBe(3);
  });

  it("refuses transfers when switched off or to the same institution", async () => {
    const { from, to } = representatives();
    const off = createStore(settings(), { [`${REPS}/${to.id}`]: to as unknown as Record<string, unknown> });
    await expect(requestSlotTransfer({ tournamentRef: off.tournamentRef, representative: from, toRepresentativeId: to.id, teams: 1, adjudicators: 0, now: NOW }))
      .rejects.toThrow(/does not take/);
    const on = createStore(settings({ slotTransfers: true }), { [`${REPS}/${from.id}`]: from as unknown as Record<string, unknown> });
    await expect(requestSlotTransfer({ tournamentRef: on.tournamentRef, representative: from, toRepresentativeId: from.id, teams: 1, adjudicators: 0, now: NOW }))
      .rejects.toThrow(/another registered institution/);
  });
});
