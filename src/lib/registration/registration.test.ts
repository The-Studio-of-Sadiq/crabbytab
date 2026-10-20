import { describe, expect, it } from "vitest";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { createFakeAdminFirestore } from "@/test/fakeAdminFirestore";
import { adjustCounters, emptyCounters, quotaLimits, quotaRefusal, remainingPlaces } from "@/lib/registration/quota";
import {
  buildAdjudicatorFromSubmission,
  buildTeamFromSubmission,
  findRegistrationDuplicates,
  matchInstitution,
  suggestInstitutionCode,
} from "@/lib/registration/review";
import {
  describeRepresentative,
  issueRepresentative,
  loadRepresentativeByToken,
  parseRepresentativeInput,
  RegistrationError,
  reviewSubmission,
  submitRegistration,
  type ReviewAction,
} from "@/lib/registration/service";
import type { RegistrationSettings, RegistrationSubmission } from "@/lib/registration/types";
import {
  defaultRegistrationSettings,
  institutionKey,
  parseRegistrationEntry,
  parseRegistrationSettings,
  RegistrationValidationError,
  registrationWindowState,
  spamSignal,
  toPublicForm,
} from "@/lib/registration/validation";

const NOW = Date.parse("2026-10-20T10:00:00Z");
const T = "tournaments/t1";
const SETTINGS = `${T}/serverOnly/registration`;
const COUNTERS = `${T}/serverOnly/registrationCounters`;
const SUBMISSIONS = `${SETTINGS}/submissions`;

function settings(overrides: Partial<RegistrationSettings> = {}): RegistrationSettings {
  return {
    ...defaultRegistrationSettings("Spring Open", 2),
    enabled: true,
    speakerCategories: ["ESL", "Novice"],
    ...overrides,
  };
}

function teamInput(overrides: Record<string, unknown> = {}) {
  return {
    kind: "team",
    institution: "  University of   Dhaka ",
    contactName: "Coach Rahman",
    contactEmail: "Coach@Example.com",
    team: {
      name: "Dhaka A",
      speakers: [
        { name: "Ana", email: "ana@example.com", categories: ["ESL"] },
        { name: "Bo", email: "", categories: [] },
      ],
    },
    answers: {},
    ...overrides,
  };
}

function adjudicatorInput(overrides: Record<string, unknown> = {}) {
  return {
    kind: "adjudicator",
    institution: "University of Dhaka",
    contactName: "Cara",
    contactEmail: "cara@example.com",
    adjudicator: {
      name: "Cara Judge",
      email: "cara@example.com",
      institutionConflicts: ["BRAC University", "Unknown College"],
      teamConflicts: "North A\nNobody Team",
    },
    ...overrides,
  };
}

function expectValidation(action: () => unknown, message: RegExp) {
  expect(action).toThrow(RegistrationValidationError);
  expect(action).toThrow(message);
}

describe("registration settings", () => {
  it("validates speakers, dates, quotas and questions", () => {
    const parsed = parseRegistrationSettings(
      {
        enabled: true,
        minSpeakers: 2,
        maxSpeakers: "3",
        opensAt: "2026-10-01T00:00:00Z",
        closesAt: "2026-11-01T00:00:00Z",
        speakerCategories: ["ESL", " ESL ", "Novice"],
        teamQuotaPerInstitution: "3",
        teamQuestions: [{ id: "diet", label: "Dietary needs", type: "text", required: false }],
      },
      "Spring Open"
    );
    expect(parsed).toMatchObject({ minSpeakers: 2, maxSpeakers: 3, teamQuotaPerInstitution: 3, speakerCategories: ["ESL", "Novice"] });
    expect(parsed.teamQuestions).toHaveLength(1);
    expect(parsed.tournamentName).toBe("Spring Open");

    expectValidation(() => parseRegistrationSettings({ minSpeakers: 3, maxSpeakers: 2 }, "x"), /minimum/);
    expectValidation(
      () => parseRegistrationSettings({ minSpeakers: 2, maxSpeakers: 2, opensAt: "2026-11-02", closesAt: "2026-11-01" }, "x"),
      /open before it closes/
    );
    expectValidation(() => parseRegistrationSettings({ minSpeakers: 2, maxSpeakers: 2, maxTeams: -1 }, "x"), /Maximum teams/);
    expectValidation(
      () => parseRegistrationSettings({ minSpeakers: 2, maxSpeakers: 2, teamQuestions: [{ id: "q", label: "Pick", type: "select_one", options: [] }] }, "x"),
      /option/
    );
    expectValidation(
      () => parseRegistrationSettings({ minSpeakers: 2, maxSpeakers: 2, teamQuestions: [{ id: "q", label: "Run code", type: "script" }] }, "x"),
      /unknown type/
    );
  });

  it("opens and closes on the configured times", () => {
    const window = settings({ opensAt: "2026-10-20T12:00:00Z", closesAt: "2026-10-21T12:00:00Z" });
    expect(registrationWindowState(window, NOW)).toBe("not_open");
    expect(registrationWindowState(window, Date.parse("2026-10-20T12:00:00Z"))).toBe("open");
    expect(registrationWindowState(window, Date.parse("2026-10-21T12:00:00Z"))).toBe("closed");
    expect(registrationWindowState({ ...window, enabled: false }, Date.parse("2026-10-20T13:00:00Z"))).toBe("disabled");
  });

  it("gives the public form no quota or review settings", () => {
    const form = toPublicForm(settings({ teamQuotaPerInstitution: 4, maxTeams: 90 }), NOW);
    expect(form).not.toHaveProperty("teamQuotaPerInstitution");
    expect(form).not.toHaveProperty("maxTeams");
    expect(form.state).toBe("open");
  });
});

describe("spam signals", () => {
  it("flag a filled honeypot, instant submissions and stale forms", () => {
    expect(spamSignal({ honeypot: "", startedAt: NOW - 10_000 }, NOW)).toBeNull();
    expect(spamSignal({ honeypot: "http://spam", startedAt: NOW - 10_000 }, NOW)).toBe("honeypot");
    expect(spamSignal({ honeypot: "", startedAt: NOW - 500 }, NOW)).toBe("too_fast");
    expect(spamSignal({ honeypot: "", startedAt: undefined }, NOW)).toBe("missing_start");
    expect(spamSignal({ honeypot: "", startedAt: NOW - 25 * 60 * 60 * 1000 }, NOW)).toBe("stale_form");
  });
});

describe("registration entries", () => {
  it("normalizes a team registration", () => {
    const entry = parseRegistrationEntry(teamInput(), settings());
    expect(entry).toEqual({
      kind: "team",
      institution: { name: "University of Dhaka", key: "university of dhaka" },
      contactName: "Coach Rahman",
      contactEmail: "coach@example.com",
      answers: {},
      team: {
        name: "Dhaka A",
        speakers: [
          { name: "Ana", email: "ana@example.com", categories: ["ESL"] },
          { name: "Bo", categories: [] },
        ],
      },
    });
  });

  it("refuses wrong speaker counts, duplicate speakers, unknown categories and bad emails", () => {
    const team = (speakers: unknown[]) => teamInput({ team: { name: "X", speakers } });
    expectValidation(() => parseRegistrationEntry(team([{ name: "Solo" }]), settings()), /2 to 3 speakers/);
    expectValidation(() => parseRegistrationEntry(team([{ name: "Ana" }, { name: "ana" }]), settings()), /different name/);
    expectValidation(() => parseRegistrationEntry(team([{ name: "Ana", categories: ["Pro"] }, { name: "Bo" }]), settings()), /categories/);
    expectValidation(() => parseRegistrationEntry(team([{ name: "Ana", email: "nope" }, { name: "Bo" }]), settings()), /email/);
    expectValidation(() => parseRegistrationEntry(teamInput({ contactEmail: "" }), settings()), /email/);
    expectValidation(() => parseRegistrationEntry(teamInput({ team: { name: "x".repeat(121), speakers: [] } }), settings()), /at most 120/);
  });

  it("refuses kinds the tournament does not take", () => {
    expect(() => parseRegistrationEntry(teamInput(), settings({ teamRegistration: false }))).toThrow(/not taking team/);
    expect(() => parseRegistrationEntry(adjudicatorInput(), settings({ adjudicatorRegistration: false }))).toThrow(/not taking adjudicator/);
  });

  it("validates custom question answers and rejects unknown ones", () => {
    const withQuestion = settings({
      teamQuestions: [{ id: "size", label: "T-shirt", type: "select_one", required: true, options: ["S", "M"] }],
    });
    expect(parseRegistrationEntry(teamInput({ answers: { size: "M" } }), withQuestion).answers).toEqual({ size: "M" });
    expectValidation(() => parseRegistrationEntry(teamInput({ answers: {} }), withQuestion), /T-shirt/);
    expectValidation(() => parseRegistrationEntry(teamInput({ answers: { size: "XL" } }), withQuestion), /valid option/);
    expectValidation(() => parseRegistrationEntry(teamInput({ answers: { size: "M", extra: "x" } }), withQuestion), /Reload/);
  });

  it("parses adjudicator conflicts from lists or lines", () => {
    const entry = parseRegistrationEntry(adjudicatorInput(), settings());
    expect(entry.adjudicator).toEqual({
      name: "Cara Judge",
      email: "cara@example.com",
      institutionConflicts: ["BRAC University", "Unknown College"],
      teamConflicts: ["North A", "Nobody Team"],
    });
  });

  it("uses a representative's institution over the submitted one", () => {
    const institution = { name: "BRAC University", key: "brac university" };
    expect(parseRegistrationEntry(teamInput(), settings(), { institution }).institution).toEqual(institution);
  });

  it("treats an empty institution as independent and keys institutions loosely", () => {
    expect(parseRegistrationEntry(teamInput({ institution: " " }), settings()).institution).toBeNull();
    expect(institutionKey("Univ. of Dhaka")).toBe(institutionKey("univ of  DHAKA"));
  });
});

describe("quotas", () => {
  it("limit per institution and overall, and free places on removal", () => {
    const limits = quotaLimits("team", settings({ teamQuotaPerInstitution: 2, maxTeams: 3 }));
    let counters = emptyCounters();
    counters = adjustCounters(counters, "team", "dhaka", 1);
    counters = adjustCounters(counters, "team", "dhaka", 1);
    expect(quotaRefusal(counters, "team", "dhaka", limits)).toMatch(/limit of 2/);
    expect(quotaRefusal(counters, "team", "brac", limits)).toBeNull();
    expect(remainingPlaces(counters, "team", "brac", limits)).toBe(1);
    counters = adjustCounters(counters, "team", null, 1);
    expect(quotaRefusal(counters, "team", "brac", limits)).toMatch(/full/);
    counters = adjustCounters(counters, "team", "dhaka", -1);
    expect(counters.institutions.dhaka).toEqual({ teams: 1, adjudicators: 0 });
    expect(adjustCounters(emptyCounters(), "adjudicator", "x", -1)).toEqual(emptyCounters());
  });

  it("let a representative override the institution quota", () => {
    expect(quotaLimits("team", settings({ teamQuotaPerInstitution: 2 }), { teamQuota: 5 }).perInstitution).toBe(5);
    expect(quotaLimits("adjudicator", settings({ adjudicatorQuotaPerInstitution: 2 }), { teamQuota: 5 }).perInstitution).toBe(2);
    expect(remainingPlaces(emptyCounters(), "team", "x", { perInstitution: 0, total: 0 })).toBeNull();
  });
});

function createStore(registration: RegistrationSettings = settings()) {
  const fake = createFakeAdminFirestore({
    [T]: { name: "Spring Open", slug: "spring", ownerId: "owner" },
    [SETTINGS]: registration as unknown as Record<string, unknown>,
  });
  const tournamentRef = fake.firestore.collection("tournaments").doc("t1") as unknown as DocumentReference;
  return { ...fake, tournamentRef };
}

function submissions(store: Map<string, Record<string, unknown>>): RegistrationSubmission[] {
  return [...store.entries()]
    .filter(([key]) => key.startsWith(`${SUBMISSIONS}/`))
    .map(([, value]) => value as unknown as RegistrationSubmission);
}

describe("submitting", () => {
  it("stores a pending submission and counts it against the institution", async () => {
    const { firestore, store, tournamentRef } = createStore();
    const result = await submitRegistration({ firestore, tournamentRef, registration: teamInput(), sourceHash: "abc", now: NOW });
    expect(result.kind).toBe("team");
    const [stored] = submissions(store);
    expect(stored).toMatchObject({ id: result.id, status: "pending", revision: 1, sourceHash: "abc", submittedAt: new Date(NOW).toISOString() });
    expect(store.get(COUNTERS)).toEqual({ teams: 1, adjudicators: 0, institutions: { "university of dhaka": { teams: 1, adjudicators: 0 } } });
  });

  it("refuses submissions outside the window, without settings, or over quota", async () => {
    const closed = createStore(settings({ closesAt: "2026-10-19T00:00:00Z" }));
    await expect(submitRegistration({ ...closed, registration: teamInput(), now: NOW })).rejects.toThrow(/closed/);
    const disabled = createStore(settings({ enabled: false }));
    await expect(submitRegistration({ ...disabled, registration: teamInput(), now: NOW })).rejects.toThrow(/not taking/);

    const limited = createStore(settings({ teamQuotaPerInstitution: 1 }));
    await submitRegistration({ ...limited, registration: teamInput(), now: NOW });
    await expect(
      submitRegistration({ ...limited, registration: teamInput({ team: { name: "Dhaka B", speakers: [{ name: "C" }, { name: "D" }] } }), now: NOW })
    ).rejects.toThrow(/limit of 1/);
    expect(submissions(limited.store)).toHaveLength(1);
  });

  it("requires a representative link when registration is representatives-only", async () => {
    const { firestore, store, tournamentRef } = createStore(settings({ representativesOnly: true, teamQuotaPerInstitution: 1 }));
    await expect(submitRegistration({ firestore, tournamentRef, registration: teamInput(), now: NOW })).rejects.toThrow(/representatives only/);

    const input = parseRepresentativeInput({ institutionName: "BRAC University", email: "Rep@Brac.edu", name: "Rep", teamQuota: "2" });
    const { record, token } = issueRepresentative(input, { tournamentId: "t1", actorUid: "owner", now: NOW });
    store.set(`${SETTINGS}/representatives/${record.id}`, record as unknown as Record<string, unknown>);

    for (const name of ["BRAC A", "BRAC B"]) {
      await submitRegistration({
        firestore,
        tournamentRef,
        registration: teamInput({ team: { name, speakers: [{ name: `${name} 1` }, { name: `${name} 2` }] } }),
        representativeToken: token,
        now: NOW,
      });
    }
    const stored = submissions(store);
    expect(stored.map((item) => item.institution?.name)).toEqual(["BRAC University", "BRAC University"]);
    expect(stored.every((item) => item.representativeId === record.id)).toBe(true);
    // The representative's quota (2) applies, not the default (1); a third is refused.
    await expect(
      submitRegistration({ firestore, tournamentRef, registration: teamInput(), representativeToken: token, now: NOW })
    ).rejects.toThrow(/limit of 2/);
    const view = await describeRepresentative(tournamentRef, record, settings({ teamQuotaPerInstitution: 1 }));
    expect(view).toEqual({ institutionName: "BRAC University", name: "Rep", remaining: { team: 0, adjudicator: null } });
  });

  it("rejects wrong, foreign and revoked representative links", async () => {
    const { store, tournamentRef } = createStore();
    const input = parseRepresentativeInput({ institutionName: "BRAC", email: "rep@brac.edu" });
    const { record, token } = issueRepresentative(input, { tournamentId: "t1", actorUid: "owner", now: NOW });
    store.set(`${SETTINGS}/representatives/${record.id}`, record as unknown as Record<string, unknown>);
    const foreign = issueRepresentative(input, { tournamentId: "t2", actorUid: "owner", now: NOW }).token;
    for (const bad of ["junk", foreign, `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`]) {
      const error = await loadRepresentativeByToken(tournamentRef, bad).then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(RegistrationError);
      expect((error as RegistrationError).badToken).toBe(true);
    }
    store.set(`${SETTINGS}/representatives/${record.id}`, { ...record, status: "revoked" });
    await expect(loadRepresentativeByToken(tournamentRef, token)).rejects.toThrow(/withdrawn/);
  });
});

describe("reviewing", () => {
  async function seeded() {
    const context = createStore(settings({ teamQuotaPerInstitution: 1 }));
    const { id } = await submitRegistration({ ...context, registration: teamInput(), now: NOW });
    const review = (action: ReviewAction, revision: number, extra: Record<string, unknown> = {}) =>
      reviewSubmission({
        firestore: context.firestore,
        tournamentRef: context.tournamentRef,
        assertAdministrator: async (_transaction: Transaction) => undefined,
        reviewerUid: "admin-1",
        action,
        submissionId: id,
        revision,
        now: NOW + 1000,
        ...extra,
      });
    return { ...context, id, review };
  }

  it("claims and approves, recording the created entity", async () => {
    const { review } = await seeded();
    const claimed = await review("claim", 1);
    expect(claimed).toMatchObject({ status: "approving", claimedBy: "admin-1", revision: 2 });
    const approved = await review("approve", 2, { entityId: "team-123", entityName: "Dhaka A" });
    expect(approved).toMatchObject({ status: "approved", approvedEntityId: "team-123", reviewedBy: "admin-1", revision: 3 });
    await expect(review("reject", 3)).rejects.toThrow(/is approved and cannot be rejected/);
  });

  it("refuses stale revisions so newer changes are not overwritten", async () => {
    const { review } = await seeded();
    await review("claim", 1);
    await expect(review("release", 1)).rejects.toThrow(/changed since you loaded it/);
    await expect(review("approve", 2, { entityId: "" })).rejects.toThrow(/Name the team/);
  });

  it("frees the quota place on rejection and takes it back on reopening", async () => {
    const { review, store } = await seeded();
    const rejected = await review("reject", 1, { reason: "Duplicate entry" });
    expect(rejected).toMatchObject({ status: "rejected", rejectionReason: "Duplicate entry" });
    expect(store.get(COUNTERS)).toEqual({ teams: 0, adjudicators: 0, institutions: {} });
    const reopened = await review("reopen", 2);
    expect(reopened.status).toBe("pending");
    expect(reopened).not.toHaveProperty("rejectionReason");
    expect(store.get(COUNTERS)).toMatchObject({ teams: 1 });
  });

  it("validates edits and moves the quota count when the institution changes", async () => {
    const { review, store } = await seeded();
    const edited = await review("edit", 1, {
      data: { ...teamInput({ institution: "BRAC University" }), kind: "adjudicator", team: { name: "Renamed", speakers: [{ name: "A" }, { name: "B" }] } },
    });
    expect(edited).toMatchObject({ kind: "team", team: { name: "Renamed" }, institution: { key: "brac university" }, revision: 2 });
    expect(store.get(COUNTERS)).toEqual({ teams: 1, adjudicators: 0, institutions: { "brac university": { teams: 1, adjudicators: 0 } } });
    await expect(review("edit", 2, { data: teamInput({ team: { name: "", speakers: [] } }) })).rejects.toThrow(/team name/i);
  });

  it("re-checks the reviewer's role inside the transaction", async () => {
    const { firestore, tournamentRef, id } = await seeded();
    await expect(
      reviewSubmission({
        firestore,
        tournamentRef,
        assertAdministrator: async () => {
          throw new Error("Tournament staff permissions changed. Reload and try again.");
        },
        reviewerUid: "former-admin",
        action: "reject",
        submissionId: id,
        revision: 1,
        now: NOW,
      })
    ).rejects.toThrow(/permissions changed/);
  });
});

describe("review helpers", () => {
  const base = { submittedAt: "", updatedAt: "", revision: 1, answers: {}, contactName: "c", contactEmail: "c@x.org" };
  const teamSubmission = (id: string, name: string, email?: string, status: RegistrationSubmission["status"] = "pending"): RegistrationSubmission => ({
    ...base,
    id,
    status,
    kind: "team",
    institution: { name: "Dhaka", key: "dhaka" },
    team: { name, speakers: [{ name: "Ana", email, categories: [] }, { name: "Bo", categories: [] }] },
  });
  const adjudicatorSubmission = (id: string, name: string, email: string): RegistrationSubmission => ({
    ...base,
    id,
    status: "pending",
    kind: "adjudicator",
    institution: null,
    adjudicator: { name, email, institutionConflicts: [], teamConflicts: [] },
  });

  it("flag duplicates against existing records and other open submissions", () => {
    const flags = findRegistrationDuplicates(
      [
        teamSubmission("s1", "Dhaka  A", "ana@x.org"),
        teamSubmission("s2", "dhaka a"),
        teamSubmission("s3", "Other", "ANA@x.org"),
        teamSubmission("s4", "Dhaka A", undefined, "rejected"),
        adjudicatorSubmission("s5", "Cara", "cara@x.org"),
      ],
      [{ id: "t1", name: "Dhaka A", speakers: [] }],
      [{ id: "a1", name: "Someone", email: "Cara@x.org" }]
    );
    expect(flags.get("s1")).toEqual([
      { against: "team", id: "t1", name: "Dhaka A", reason: "same_name" },
      { against: "submission", id: "s2", name: "dhaka a", reason: "same_name" },
      { against: "submission", id: "s3", name: "Other", reason: "same_speaker" },
    ]);
    expect(flags.get("s3")).toEqual([{ against: "submission", id: "s1", name: "Dhaka  A", reason: "same_speaker" }]);
    expect(flags.has("s4")).toBe(false);
    expect(flags.get("s5")).toEqual([{ against: "adjudicator", id: "a1", name: "Someone", reason: "same_email" }]);
  });

  it("build a team for the entity commands, without private keys (the command adds them)", () => {
    let next = 0;
    const team = buildTeamFromSubmission(teamSubmission("s1", "Dhaka A", "ana@x.org"), { id: "inst-1", name: "Dhaka" }, (prefix) => `${prefix}-${(next += 1)}`);
    expect(team).toEqual({
      name: "Dhaka A",
      institutionId: "inst-1",
      institutionName: "Dhaka",
      speakers: [
        { id: "spk-1", name: "Ana", email: "ana@x.org" },
        { id: "spk-2", name: "Bo" },
      ],
      breakCategories: [],
      speakerCategories: [],
    });
    expect(team).not.toHaveProperty("privateUrlKey");
  });

  it("map declared conflicts to institutions and teams and report the rest", () => {
    const submission: RegistrationSubmission = {
      ...adjudicatorSubmission("s1", "Cara", "cara@x.org"),
      institution: { name: "Dhaka", key: "dhaka" },
      adjudicator: { name: "Cara", email: "cara@x.org", institutionConflicts: ["brac", "Dhaka", "Nowhere"], teamConflicts: ["north a", "Ghost"] },
    };
    const { adjudicator, unmatchedConflicts } = buildAdjudicatorFromSubmission(submission, {
      institution: { id: "i-dhaka", name: "Dhaka" },
      institutions: [
        { id: "i-dhaka", name: "Dhaka", code: "DU" },
        { id: "i-brac", name: "BRAC University", code: "BRAC" },
      ],
      teams: [{ id: "t-north", name: "North A" }],
      baseScore: 5,
    });
    expect(adjudicator.conflicts).toEqual([
      { type: "institution", institutionId: "i-brac" },
      { type: "personal", teamId: "t-north" },
    ]);
    expect(adjudicator).toMatchObject({ institutionId: "i-dhaka", independent: false, baseScore: 5, trainee: false });
    expect(unmatchedConflicts).toEqual(["Nowhere", "Ghost"]);
  });

  it("match institutions by name or code and suggest unused codes", () => {
    const institutions = [{ id: "1", name: "University of Dhaka", code: "DU" }];
    expect(matchInstitution("university of dhaka", institutions)?.id).toBe("1");
    expect(matchInstitution("du", institutions)?.id).toBe("1");
    expect(matchInstitution("BRAC", institutions)).toBeUndefined();
    expect(suggestInstitutionCode("North South University", ["NSU"])).toBe("NSU2");
    expect(suggestInstitutionCode("Harvard", [])).toBe("HARV");
  });
});
