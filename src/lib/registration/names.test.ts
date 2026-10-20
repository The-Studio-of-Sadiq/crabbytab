import { describe, expect, it } from "vitest";
import { applyNameGenerators, CODE_NAME_EMOJI, generateCodeName, generateTeamName } from "./names";
import { applyTransfer, parseTransferRequest } from "./transfers";
import type { RegistrationRepresentative } from "./types";

describe("team-name generators", () => {
  const base = { submittedName: "Our Team", institutionName: "Oxford", speakerNames: ["Ann Smith", "Bo Jones"], existingNames: [] };

  it("keeps the registrant's name for 'user' and assigns free labels otherwise", () => {
    expect(generateTeamName({ ...base, generator: "user" })).toBe("Our Team");
    expect(generateTeamName({ ...base, generator: "alphabetical", existingNames: ["Oxford A"] })).toBe("Oxford B");
    expect(generateTeamName({ ...base, generator: "numerical", existingNames: ["oxford 1", "Oxford 2"] })).toBe("Oxford 3");
    expect(generateTeamName({ ...base, generator: "initials" })).toBe("Oxford SJ");
    expect(generateTeamName({ ...base, generator: "initials", existingNames: ["Oxford SJ"] })).toBe("Oxford SJ2");
    expect(generateTeamName({ ...base, generator: "alphabetical", institutionName: undefined })).toBe("Team A");
  });

  it("continues past Z", () => {
    const existingNames = Array.from({ length: 26 }, (_, index) => `Oxford ${String.fromCharCode(65 + index)}`);
    expect(generateTeamName({ ...base, generator: "alphabetical", existingNames })).toBe("Oxford AA");
  });
});

describe("code-name generators", () => {
  it("picks the first unused emoji, then pairs", () => {
    expect(generateCodeName({ generator: "emoji", speakerNames: [], existingCodeNames: [CODE_NAME_EMOJI[0]] })).toBe(CODE_NAME_EMOJI[1]);
    expect(generateCodeName({ generator: "emoji", speakerNames: [], existingCodeNames: [...CODE_NAME_EMOJI] }))
      .toBe(`${CODE_NAME_EMOJI[0]}${CODE_NAME_EMOJI[0]}`);
  });

  it("joins last names and keeps them unique", () => {
    expect(generateCodeName({ generator: "last_names", speakerNames: ["Ann Smith", "Bo Jones"], existingCodeNames: [] })).toBe("Smith & Jones");
    expect(generateCodeName({ generator: "last_names", speakerNames: ["Ann Smith", "Bo Jones"], existingCodeNames: ["Smith & Jones"] }))
      .toBe("Smith & Jones 2");
    expect(generateCodeName({ generator: "user", speakerNames: ["Ann"], existingCodeNames: [] })).toBeUndefined();
  });

  it("applies both generators to a built team", () => {
    const team = applyNameGenerators(
      { name: "Typed", speakers: [{ name: "Ann Smith" }], institutionId: "i1" },
      {
        settings: { teamNameGenerator: "numerical", codeNameGenerator: "last_names" },
        institutionName: "Oxford",
        teams: [{ name: "Oxford 1", institutionId: "i1" }],
      }
    );
    expect(team).toMatchObject({ name: "Oxford 2", codeName: "Smith" });
  });
});

describe("slot transfers", () => {
  const settings = { teamQuotaPerInstitution: 2, adjudicatorQuotaPerInstitution: 0 };
  const representative = (id: string, overrides: Partial<RegistrationRepresentative> = {}) =>
    ({ id, institution: { name: id, key: id }, email: `${id}@x.org`, name: id, tokenHash: "", status: "active", createdAt: "", createdBy: "", sendCount: 0, ...overrides }) as RegistrationRepresentative;

  it("moves places between the two representatives", () => {
    const result = applyTransfer({ teams: 1, adjudicators: 0 }, representative("a", { teamQuota: 3 }), representative("b"), settings, { teams: 1, adjudicators: 0 });
    expect(result.from.teamQuota).toBe(2);
    expect(result.to.teamQuota).toBe(3);
  });

  it("refuses to give away used or unlimited places", () => {
    expect(() => applyTransfer({ teams: 2, adjudicators: 0 }, representative("a"), representative("b"), settings, { teams: 1, adjudicators: 0 }))
      .toThrow(/already used/);
    expect(() => applyTransfer({ teams: 0, adjudicators: 1 }, representative("a"), representative("b"), settings, { teams: 0, adjudicators: 0 }))
      .toThrow(/no fixed/);
  });

  it("validates requests", () => {
    expect(parseTransferRequest({ toRepresentativeId: "b", teams: "1" })).toEqual({ toRepresentativeId: "b", teams: 1, adjudicators: 0 });
    expect(() => parseTransferRequest({ toRepresentativeId: "b" })).toThrow(/at least one/);
    expect(() => parseTransferRequest({ toRepresentativeId: "b/x", teams: 1 })).toThrow();
  });
});
