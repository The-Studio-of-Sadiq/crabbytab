import { describe, expect, it } from "vitest";
import type { Adjudicator, Team } from "@/types";
import { convertTeamNames, teamLongName, teamShortName, teamsNeedingNames, withTeamNames } from "./teamNames";
import { normalizeCompositeTeam, teamInstitutionIds } from "./compositeTeams";
import { sameInstitution } from "./draw/history";
import { calculateAdjDebateConflict } from "./draw/allocator";
import { buildTeamFromSubmission } from "./registration/review";
import type { RegistrationSubmission } from "./registration/types";

const victoria = { id: "vic", name: "Victoria", code: "VUW" };
const auckland = { id: "auck", name: "Auckland", code: "AUCK" };

const team = (extra: Partial<Team>): Team => ({
  id: "t1",
  tournamentId: "x",
  name: "Victoria 1",
  institutionId: "vic",
  institutionName: "Victoria",
  speakers: [],
  breakCategories: [],
  speakerCategories: [],
  ...extra,
});

describe("Tabbycat team names", () => {
  it("builds long and short names from the reference and prefix", () => {
    const named = team({ reference: "1", useInstitutionPrefix: true });
    expect(teamLongName(named, victoria)).toBe("Victoria 1");
    expect(teamShortName(named, victoria)).toBe("VUW 1");
    expect(teamShortName({ ...named, shortReference: "One" }, victoria)).toBe("VUW One");
    expect(teamLongName({ ...named, useInstitutionPrefix: false, reference: "Kiwis" }, victoria)).toBe("Kiwis");
    expect(teamLongName({ ...named, reference: "" }, victoria)).toBe("Victoria");
  });

  it("shows the chosen name and leaves teams without a reference alone", () => {
    const named = team({ reference: "1", useInstitutionPrefix: true });
    expect(withTeamNames(named, victoria, "short").name).toBe("VUW 1");
    expect(withTeamNames(named, victoria, undefined)).toMatchObject({ name: "Victoria 1", longName: "Victoria 1", shortName: "VUW 1" });
    const plain = team({ name: "Typed name" });
    expect(withTeamNames(plain, victoria, "short")).toBe(plain);
  });

  it("finds names out of date after an institution is renamed", () => {
    const named = withTeamNames(team({ reference: "1", useInstitutionPrefix: true }), victoria, "long");
    expect(teamsNeedingNames([named], [victoria], "long")).toEqual([]);
    expect(teamsNeedingNames([named], [{ ...victoria, name: "Te Herenga Waka" }], "long")[0].name).toBe("Te Herenga Waka 1");
  });

  it("converts names like Tabbycat's convertteamnames, keeping what they show", () => {
    const conversions = convertTeamNames(
      [
        team({ id: "a", name: "Victoria 1" }),
        team({ id: "b", name: "VUW 2" }),
        team({ id: "c", name: "Wellington Wizards" }),
        team({ id: "d", name: "Done", reference: "Done" }),
        team({ id: "e", name: "Auckland Swing", isSwing: true }),
      ],
      [victoria, auckland],
      "long"
    );
    expect(conversions.map((item) => item.team.id)).toEqual(["a", "b", "c"]);
    expect(conversions[0].converted).toMatchObject({ reference: "1", useInstitutionPrefix: true, name: "Victoria 1" });
    expect(conversions[1].converted).toMatchObject({ reference: "2", useInstitutionPrefix: true, name: "Victoria 2" });
    expect(conversions[2]).toMatchObject({ prefixed: false, converted: { reference: "Wellington Wizards", name: "Wellington Wizards" } });
  });

  it("keeps the registration form's prefix as a reference", () => {
    const submission = {
      kind: "team",
      institution: { name: "Victoria", key: "victoria" },
      team: { name: "Victoria 3", speakers: [], useInstitutionPrefix: true },
    } as unknown as RegistrationSubmission;
    const built = buildTeamFromSubmission(submission, victoria, (prefix) => `${prefix}-1`);
    expect(built).toMatchObject({ name: "Victoria 3", reference: "3", useInstitutionPrefix: true });
  });
});

describe("composite teams", () => {
  it("counts the other institutions as the team's own", () => {
    const composite = team({ isComposite: true, compositeInstitutionIds: ["auck", "vic", "auck"] });
    expect(teamInstitutionIds(composite)).toEqual(["vic", "auck"]);
    expect(normalizeCompositeTeam(composite).compositeInstitutionIds).toEqual(["auck"]);
    const plain = normalizeCompositeTeam(team({ isComposite: false, compositeInstitutionIds: ["auck"] }));
    expect(plain).not.toHaveProperty("compositeInstitutionIds");
    expect(plain).not.toHaveProperty("isComposite");
    expect(normalizeCompositeTeam(team({ isSwing: true, isComposite: true }))).not.toHaveProperty("isComposite");
  });

  it("avoids same-institution pairings and adjudicators for every institution of the team", () => {
    const composite = team({ id: "c", isComposite: true, compositeInstitutionIds: ["auck"] });
    const aucklandTeam = team({ id: "a", name: "Auckland 1", institutionId: "auck", institutionName: "Auckland" });
    expect(sameInstitution(composite, aucklandTeam)).toBe(true);
    expect(sameInstitution(team({ id: "v" }), aucklandTeam)).toBe(false);
    const judge: Adjudicator = {
      id: "j", tournamentId: "x", name: "J", institutionId: "auck", institutionName: "Auckland",
      baseScore: 5, trainee: false, independent: false, conflicts: [],
    };
    expect(calculateAdjDebateConflict(judge, [composite]).penalty).toBeGreaterThan(0);
    expect(calculateAdjDebateConflict(judge, [team({ id: "v" })]).penalty).toBe(0);
  });
});
