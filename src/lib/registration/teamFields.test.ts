import { describe, expect, it } from "vitest";
import type { DocumentReference } from "firebase-admin/firestore";
import { createFakeAdminFirestore } from "@/test/fakeAdminFirestore";
import { createRegisteredEntity } from "@/lib/registration/autoApprove";
import { buildTeamFromSubmission, prefixedTeamName } from "@/lib/registration/review";
import { submitRegistration } from "@/lib/registration/service";
import type { RegistrationSettings, RegistrationSubmission } from "@/lib/registration/types";
import {
  activeTeamFields,
  defaultRegistrationSettings,
  parseRegistrationEntry,
  parseRegistrationSettings,
  RegistrationValidationError,
  toPublicForm,
} from "@/lib/registration/validation";

const NOW = Date.parse("2026-10-20T10:00:00Z");
const T = "tournaments/t1";
const SETTINGS = `${T}/serverOnly/registration`;
const CATEGORIES = [{ id: "esl", name: "ESL" }, { id: "novice", name: "Novice" }];
const FOX = "\u{1F98A}";
const BEAR = "\u{1F43B}";
const OCTOPUS = "\u{1F419}";

function settings(overrides: Partial<RegistrationSettings> = {}): RegistrationSettings {
  return {
    ...defaultRegistrationSettings("Spring Open", 2),
    enabled: true,
    teamFields: ["use_institution_prefix", "break_categories", "seed", "emoji"],
    teamBreakCategories: CATEGORIES,
    ...overrides,
  };
}

const team = (fields: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) => ({
  kind: "team",
  institution: "Dhaka",
  contactName: "Coach",
  contactEmail: "coach@example.com",
  team: { name: "A", speakers: [{ name: "Ana", categories: [] }, { name: "Bo", categories: [] }], ...fields },
  answers: {},
  ...overrides,
});

describe("team registration fields (Tabbycat reg_team_fields)", () => {
  it("are off for existing settings and parsed from saved settings with the tournament's categories and seed mode", () => {
    expect(defaultRegistrationSettings("x").teamFields).toEqual([]);
    const parsed = parseRegistrationSettings(
      { ...defaultRegistrationSettings("x"), teamFields: ["emoji", "seed", "shoe", "emoji"], teamBreakCategories: [{ id: "forged", name: "F" }] },
      "x",
      { breakCategories: CATEGORIES, teamSeedMode: "title" }
    );
    expect(parsed.teamFields).toEqual(["seed", "emoji"]);
    // Categories always come from the tournament, never from the submitted settings.
    expect(parsed.teamBreakCategories).toEqual(CATEGORIES);
    expect(parsed.teamSeedMode).toBe("title");
    expect(parseRegistrationSettings({ ...defaultRegistrationSettings("x") }, "x").teamSeedMode).toBe("off");
  });

  it("show the institution prefix only while registrants name their own teams", () => {
    expect(activeTeamFields(settings())).toContain("use_institution_prefix");
    expect(activeTeamFields(settings({ teamNameGenerator: "numerical" }))).toEqual(["break_categories", "seed", "emoji"]);
    const form = toPublicForm(settings({ teamNameGenerator: "initials", teamSeedMode: "numeric" }), NOW);
    expect(form.teamFields).not.toContain("use_institution_prefix");
    expect(form.teamBreakCategories).toEqual(CATEGORIES);
    expect(form.teamSeedMode).toBe("numeric");
    // Settings saved before the option existed.
    const legacy = { ...settings() } as Partial<RegistrationSettings>;
    delete legacy.teamFields;
    delete legacy.teamBreakCategories;
    delete legacy.teamSeedMode;
    expect(toPublicForm(legacy as RegistrationSettings, NOW)).toMatchObject({ teamFields: [], teamBreakCategories: [], teamSeedMode: "off" });
  });

  it("validate submitted values on the server", () => {
    const entry = parseRegistrationEntry(
      team({ useInstitutionPrefix: true, breakCategories: ["esl", "esl"], seed: "7", emoji: FOX }),
      settings()
    );
    expect(entry.team).toMatchObject({ useInstitutionPrefix: true, breakCategories: ["esl"], seed: 7, emoji: FOX });

    const refuse = (fields: Record<string, unknown>, message: RegExp, extra: Partial<RegistrationSettings> = {}) =>
      expect(() => parseRegistrationEntry(team(fields), settings(extra))).toThrow(message);
    refuse({ breakCategories: ["open"] }, /valid break categories/);
    refuse({ breakCategories: "esl" }, /valid break categories/);
    refuse({ seed: "-2" }, /Team seed/);
    refuse({ seed: "Full seed" }, /Team seed/);
    refuse({ seed: "9" }, /Team seed/, { teamSeedMode: "title" });
    refuse({ emoji: "<b>" }, /emoji from the list/);
    refuse({ useInstitutionPrefix: "yes" }, /institution prefix/);
    expect(() => parseRegistrationEntry(team({ emoji: "x" }), settings())).toThrow(RegistrationValidationError);

    expect(parseRegistrationEntry(team({ seed: "Half seed" }), settings({ teamSeedMode: "title" })).team?.seed).toBe(2);
    // Empty values mean "not given".
    expect(parseRegistrationEntry(team({ seed: "", emoji: "", breakCategories: [], useInstitutionPrefix: false }), settings()).team).toEqual({
      name: "A",
      speakers: expect.any(Array),
    });
  });

  it("ignore fields the form does not show (and the prefix without an institution)", () => {
    const entry = parseRegistrationEntry(
      team({ useInstitutionPrefix: true, breakCategories: ["bogus"], seed: "x", emoji: "x" }),
      settings({ teamFields: [] })
    );
    expect(entry.team).toEqual({ name: "A", speakers: expect.any(Array) });
    const independent = parseRegistrationEntry(team({ useInstitutionPrefix: true }, { institution: "" }), settings());
    expect(independent.team?.useInstitutionPrefix).toBeUndefined();
  });

  it("are applied when the team is created", () => {
    const submission = {
      id: "s1",
      status: "pending",
      submittedAt: "",
      updatedAt: "",
      revision: 1,
      ...parseRegistrationEntry(team({ useInstitutionPrefix: true, breakCategories: ["esl", "novice"], seed: "3", emoji: FOX }), settings()),
    } as RegistrationSubmission;
    let next = 0;
    const createId = (prefix: string) => `${prefix}-${(next += 1)}`;
    const built = buildTeamFromSubmission(submission, { id: "inst-1", name: "Dhaka University" }, createId, {
      teams: [{ emoji: BEAR }],
      breakCategoryIds: ["esl"],
    });
    expect(built).toMatchObject({ name: "Dhaka University A", breakCategories: ["esl"], seed: 3, emoji: FOX });
    // An emoji another team has is not reused.
    expect(buildTeamFromSubmission(submission, undefined, createId, { teams: [{ emoji: FOX }] })).not.toHaveProperty("emoji");
    // Without a known category list the registered ids are kept; the registered institution name is the prefix.
    expect(buildTeamFromSubmission(submission, undefined, createId)).toMatchObject({ name: "Dhaka A", breakCategories: ["esl", "novice"] });
    expect(prefixedTeamName("Dhaka A", "Dhaka")).toBe("Dhaka A");
    expect(prefixedTeamName("A", undefined)).toBe("A");
  });

  it("are applied by automatic acceptance, dropping categories deleted since", async () => {
    const registration = settings({ confirmation: "never" });
    const fake = createFakeAdminFirestore({
      [T]: { name: "Spring Open", slug: "spring", ownerId: "owner" },
      [SETTINGS]: registration as unknown as Record<string, unknown>,
      [`${T}/institutions/inst-1`]: { name: "Dhaka", code: "DU" },
      [`${T}/breakCategories/esl`]: { name: "ESL", isGeneral: false, seq: 2 },
    });
    const tournamentRef = fake.firestore.collection("tournaments").doc("t1") as unknown as DocumentReference;
    const context = { ...fake, tournamentRef };
    const result = await submitRegistration({
      ...context,
      registration: team({ useInstitutionPrefix: true, breakCategories: ["esl", "novice"], seed: 4, emoji: OCTOPUS }),
      now: NOW,
    });
    const entity = await createRegisteredEntity({ ...context, submission: result.submission, settings: registration, adjudicatorBaseScore: 5 });
    expect(fake.store.get(`${T}/teams/${entity.entityId}`)).toMatchObject({
      name: "Dhaka A",
      breakCategories: ["esl"],
      seed: 4,
      emoji: OCTOPUS,
    });
  });
});
