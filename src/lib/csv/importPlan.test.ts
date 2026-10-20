import { describe, expect, it } from "vitest";

import type { Adjudicator, BreakCategory, Institution, Team } from "@/types";
import { readCsvTable } from "./csvTable";
import {
  buildImportCommit,
  chosenAction,
  planImport,
  type CommitContext,
  type PlannedTeam,
} from "./importPlan";

const institutions: Institution[] = [
  { id: "inst-oxf", tournamentId: "t1", name: "Oxford Union", code: "OXF" },
  { id: "inst-cam", tournamentId: "t1", name: "Cambridge Union", code: "CAM" },
];

function team(id: string, name: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    tournamentId: "t1",
    name,
    institutionId: "inst-oxf",
    institutionName: "Oxford Union",
    speakers: [
      { id: `${id}-s1`, name: "Ann", email: "ann@example.org" },
      { id: `${id}-s2`, name: "Ben" },
    ],
    breakCategories: [],
    speakerCategories: [],
    ...overrides,
  };
}

function adjudicator(id: string, name: string, overrides: Partial<Adjudicator> = {}): Adjudicator {
  return {
    id,
    tournamentId: "t1",
    name,
    baseScore: 5,
    trainee: false,
    independent: false,
    institutionId: "inst-oxf",
    institutionName: "Oxford Union",
    conflicts: [{ institutionId: "inst-oxf", type: "institution" }],
    ...overrides,
  };
}

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

describe("readCsvTable", () => {
  it("reports an empty file and a header-only file", () => {
    expect(readCsvTable("").fileErrors).toEqual(["The file is empty."]);
    expect(readCsvTable("  \n \n").fileErrors).toEqual(["The file is empty."]);
    expect(readCsvTable("name,code\n").fileErrors).toEqual(["The file has a header row but no data rows."]);
  });

  it("strips the BOM, trims headers and skips blank and all-empty rows", () => {
    const table = readCsvTable("﻿ name , code \r\nOxford,OXF\r\n\r\n,\r\nCambridge,CAM\r\n");
    expect(table.headers).toEqual(["name", "code"]);
    expect(table.records.map((record) => record.values.name)).toEqual(["Oxford", "Cambridge"]);
  });

  it("keeps quoted commas, quotes, newlines and non-ASCII text", () => {
    const table = readCsvTable('name,region\n"Université de Montréal, QC","Line 1\nLine 2"\n"Say ""hi""",東京');
    expect(table.records[0].values).toEqual({ name: "Université de Montréal, QC", region: "Line 1\nLine 2" });
    expect(table.records[1].values).toEqual({ name: 'Say "hi"', region: "東京" });
    // Spreadsheet row numbers: a newline inside a cell does not add a row.
    expect(table.records.map((record) => record.rowNumber)).toEqual([2, 3]);
  });

  it("reports repeated columns and malformed rows", () => {
    expect(readCsvTable("name,Name\nA,B").fileErrors[0]).toMatch(/Repeated column names/);
    const table = readCsvTable("name,code\nA,B,C\nD");
    expect(table.records.map((record) => record.parseErrorCode)).toEqual(["TooManyFields", "TooFewFields"]);
    expect(readCsvTable('name,code\n"unclosed,X\nB,C').fileErrors[0]).toMatch(/never closed/);
  });

  it("does not interpret formulas or markup", () => {
    const table = readCsvTable('name\n=HYPERLINK("x")\n<script>alert(1)</script>');
    expect(table.records.map((record) => record.values.name)).toEqual(['=HYPERLINK("x")', "<script>alert(1)</script>"]);
  });
});

describe("planImport: file problems", () => {
  it("refuses a file without the name column", () => {
    const plan = planImport("teams", "team_title,speaker1\nA,Ann", context());
    expect(plan.fileErrors[0]).toMatch(/"name" column is missing/);
    expect(plan.rows).toEqual([]);
  });

  it("lists columns it will ignore", () => {
    const plan = planImport("institutions", "name,code,website\nLSE,LSE,lse.ac.uk", context());
    expect(plan.ignoredColumns).toEqual(["website"]);
  });
});

describe("planImport: institutions", () => {
  it("matches existing institutions by name or code and skips them by default", () => {
    const plan = planImport("institutions", "name,code\n  oxford   union ,OX\nKing's College,CAM\nLSE,LSE", context());
    expect(plan.rows.map((row) => [row.match?.reason, row.defaultAction])).toEqual([
      ["same name", "skip"],
      ["same code CAM", "skip"],
      [undefined, "create"],
    ]);
  });

  it("flags duplicates within the file", () => {
    const plan = planImport("institutions", "name,code\nLSE,LSE\nlse,LSE2\nKCL,LSE", context());
    expect(plan.rows[1].duplicateOfRow).toBe(2);
    expect(plan.rows[2].duplicateOfRow).toBe(2);
    expect(plan.rows.map((row) => row.defaultAction)).toEqual(["create", "skip", "skip"]);
  });

  it("keeps the legacy recovery of unquoted commas with a warning", () => {
    const plan = planImport("institutions", "name,code,region\nBegum Rokeya University, Rangpur,BRUR,Rangpur", context());
    expect(plan.rows[0].label).toBe("Begum Rokeya University, Rangpur");
    expect(plan.rows[0].issues).toEqual([expect.objectContaining({ severity: "warning" })]);
  });

  it("updates an existing institution, keeping its code when the cell is blank", () => {
    const plan = planImport("institutions", "name,code,region\nOxford Union,,UK", context());
    const { commit } = buildImportCommit(plan, { actions: { 2: "update" } }, context());
    expect(commit?.institutionsUpdated).toEqual([expect.objectContaining({ id: "inst-oxf", code: "OXF", region: "UK" })]);
  });
});

describe("planImport: teams", () => {
  const breakCategories: BreakCategory[] = [
    { id: "bc-esl", tournamentId: "t1", name: "ESL", slug: "esl", seq: 2, breakSize: 4, reserveSize: 0, isGeneral: false, priority: 1 },
  ];

  it("reports row errors instead of inventing names", () => {
    const plan = planImport(
      "teams",
      "name,institution,speaker1,speaker1_email,speaker2,break_categories\n,Oxford Union,Ann,,Ben,\nAlpha,,,ann@,,\nBeta,,Cat,,Dan,pro-am",
      context({ breakCategories })
    );
    expect(plan.rows[0].issues.map((issue) => issue.message)).toContain("The team name is missing.");
    expect(plan.rows[1].issues.map((issue) => issue.message)).toContain("Speaker 1 has an email or categories but no name.");
    expect(plan.rows[2].issues[0].message).toMatch(/Unknown break category on CSV row 4: pro-am/);
    expect(plan.rows.every((row) => row.actions.length === 1 && row.defaultAction === "skip")).toBe(true);
  });

  it("warns about placeholder speakers and short teams", () => {
    const plan = planImport("teams", "name,speaker1\nAlpha,\nBeta,Ann", context());
    expect(plan.rows[0].issues[0].message).toMatch(/2 placeholder speakers \("Alpha Speaker 1"/);
    expect(plan.rows[1].issues[0].message).toBe("Only 1 of 2 speakers named.");
    const { commit } = buildImportCommit(plan, {}, context());
    expect(commit?.teamsCreated[0].speakers.map((speaker) => speaker.name)).toEqual(["Alpha Speaker 1", "Alpha Speaker 2"]);
  });

  it("detects existing teams, in-file duplicates and shared speaker emails", () => {
    const plan = planImport(
      "teams",
      "name,speaker1,speaker1_email,speaker2\nOxford A,Ann,ANN@example.org,Ben\nNew A,Zed,ann@example.org,Yan\nnew  a,Q,,R",
      context({ teams: [team("team-1", "Oxford A")] })
    );
    expect(plan.rows[0].match).toEqual({ id: "team-1", name: "Oxford A", reason: "same team name" });
    expect(plan.rows[0].issues).toEqual([]);
    expect(plan.rows[1].issues[0].message).toMatch(/also used by Ann \(Oxford A\)/);
    expect(plan.rows[2].duplicateOfRow).toBe(3);
  });

  it("offers to create unknown institutions with editable, unique codes", () => {
    const plan = planImport(
      "teams",
      "name,institution,speaker1,speaker2\nA1,Oxford Union,A,B\nB1,Oxfam Society,C,D\nB2,oxfam society,E,F\nC1,Independent,G,H",
      context({ institutions: [...institutions, { id: "i3", tournamentId: "t1", name: "Other", code: "OXFA" }] })
    );
    expect(plan.rows[0].institution).toEqual({ existingId: "inst-oxf" });
    expect(plan.newInstitutions).toEqual([
      { key: "oxfam society", name: "Oxfam Society", code: "OXFA2", rowNumbers: [3, 4] },
    ]);
    expect(plan.rows[3].institution).toBeUndefined();

    const { commit } = buildImportCommit(plan, { newInstitutions: { "oxfam society": { code: "OXS" } } }, context());
    expect(commit?.institutionsCreated).toEqual([expect.objectContaining({ name: "Oxfam Society", code: "OXS" })]);
    const created = commit!.institutionsCreated[0];
    expect(commit?.teamsCreated.filter((item) => item.institutionId === created.id).map((item) => item.name)).toEqual(["B1", "B2"]);
  });

  it("keeps the name unlinked when the organiser declines to create the institution", () => {
    const plan = planImport("teams", "name,institution,speaker1,speaker2\nB1,Oxfam Society,C,D", context());
    const { commit } = buildImportCommit(plan, { newInstitutions: { "oxfam society": { create: false } } }, context());
    expect(commit?.institutionsCreated).toEqual([]);
    expect(commit?.teamsCreated[0]).toMatchObject({ institutionId: undefined, institutionName: "Oxfam Society" });
  });

  it("rejects duplicate codes for new institutions", () => {
    const plan = planImport("teams", "name,institution,speaker1,speaker2\nB1,Oxfam Society,C,D", context());
    expect(buildImportCommit(plan, { newInstitutions: { "oxfam society": { code: "oxf" } } }, context()).errors)
      .toEqual(["Code oxf for Oxfam Society is already used."]);
  });

  it("refuses a file with errors unless only valid rows are imported", () => {
    const plan = planImport("teams", "name,speaker1,speaker2\n,A,B\nGood,C,D", context());
    expect(buildImportCommit(plan, {}, context()).errors[0]).toMatch(/1 row has errors/);
    const { commit } = buildImportCommit(plan, { validRowsOnly: true }, context());
    expect(commit?.teamsCreated.map((item) => item.name)).toEqual(["Good"]);
    expect(commit?.skipped).toBe(1);
  });

  it("updates a team keeping speaker ids and blank-cell values", () => {
    const existing = team("team-1", "Oxford A", { codeName: "OXA", breakCategories: ["bc-esl"] });
    const plan = planImport("teams", "name,speaker1,speaker2,speaker2_email\nOxford A,Annie,Ben,ben@example.org", context({ teams: [existing] }));
    expect(chosenAction(plan.rows[0], { actions: { 2: "update" } })).toBe("update");
    const { commit } = buildImportCommit(plan, { actions: { 2: "update" } }, context({ teams: [existing] }));
    expect(commit?.teamsUpdated).toEqual([
      expect.objectContaining({
        id: "team-1",
        codeName: "OXA",
        institutionId: "inst-oxf",
        breakCategories: ["bc-esl"],
        speakers: [
          { id: "team-1-s1", name: "Annie", email: "ann@example.org" },
          { id: "team-1-s2", name: "Ben", email: "ben@example.org" },
        ],
      }),
    ]);
  });

  it("resolves speaker category names to ids and creates the unknown ones", () => {
    const speakerCategories = [{ id: "spk-esl", name: "ESL", slug: "esl", seq: 1, public: true }];
    const plan = planImport(
      "teams",
      "name,speaker1,speaker1_categories,speaker2,speaker2_categories\nA,Ann,esl; Novice,Ben,",
      context({ speakerCategories })
    );
    expect(plan.newSpeakerCategories).toEqual(["Novice"]);
    const { commit } = buildImportCommit(plan, {}, context({ speakerCategories }));
    const speakers = commit!.teamsCreated[0].speakers;
    expect(speakers[0].categories).toEqual(["spk-esl", "spkcat-novice"]);
    expect(speakers[1].categories).toBeUndefined();
    expect(commit?.speakerCategories).toEqual([
      { id: "spk-esl", name: "ESL", slug: "esl", seq: 1, public: true },
      { id: "spkcat-novice", name: "Novice", slug: "novice", seq: 2, public: false },
    ]);
  });

  it("leaves the category list alone when every name is known", () => {
    const speakerCategories = [{ id: "spk-esl", name: "ESL", slug: "esl", seq: 1, public: true }];
    const plan = planImport("teams", "name,speaker1,speaker1_categories\nA,Ann,ESL", context({ speakerCategories }));
    expect(buildImportCommit(plan, {}, context({ speakerCategories })).commit?.speakerCategories).toBeUndefined();
  });

  it("drafts teams for display", () => {
    const plan = planImport("teams", "name,institution,speaker1,speaker2\nA,Oxford Union,Ann,Ben", context());
    expect(plan.rows[0].details).toBe("Oxford Union · Ann, Ben");
    expect((plan.rows[0].draft as PlannedTeam).team.name).toBe("A");
  });
});

describe("planImport: adjudicators", () => {
  it("matches by email first, then by name and institution", () => {
    const existing = [
      adjudicator("adj-1", "Eleanor Vance", { email: "ev@example.org" }),
      adjudicator("adj-2", "David Kim", { institutionId: "inst-cam", institutionName: "Cambridge Union" }),
    ];
    const plan = planImport(
      "adjudicators",
      "name,email,institution\nE. Vance,EV@example.org,\ndavid kim,,Cambridge Union\nDavid Kim,,Oxford Union",
      context({ adjudicators: existing })
    );
    expect(plan.rows.map((row) => row.match?.reason)).toEqual(["same email", "same name and institution", undefined]);
    expect(plan.rows[2].issues[0].message).toMatch(/already exists at another institution/);
  });

  it("treats 'Independent' as no institution and validates flags and scores", () => {
    const plan = planImport("adjudicators", "name,institution,score,trainee\nA,Independent,6,no\nB,,high,maybe", context());
    expect(plan.rows[0].institution).toBeUndefined();
    expect(plan.newInstitutions).toEqual([]);
    expect(plan.rows[1].issues.map((issue) => issue.message)).toEqual([
      "Invalid score value on CSV row 3: high",
      "Invalid trainee value on CSV row 3: maybe",
    ]);
  });

  it("creates adjudicators with an own-institution conflict, including new institutions", () => {
    const plan = planImport("adjudicators", "name,institution\nA,Oxford Union\nB,Durham", context());
    const { commit } = buildImportCommit(plan, {}, context());
    const durham = commit!.institutionsCreated[0];
    expect(durham).toMatchObject({ name: "Durham", code: "DURH" });
    expect(commit?.adjudicatorsCreated.map((item) => [item.institutionId, item.independent, item.conflicts])).toEqual([
      ["inst-oxf", false, [{ institutionId: "inst-oxf", type: "institution" }]],
      [durham.id, false, [{ institutionId: durham.id, type: "institution" }]],
    ]);
  });

  it("updates only the columns the row fills and keeps other conflicts", () => {
    const existing = adjudicator("adj-1", "Eleanor Vance", {
      email: "ev@example.org",
      baseScore: 8,
      trainee: true,
      conflicts: [{ institutionId: "inst-oxf", type: "institution" }, { teamId: "team-9", type: "personal" }],
    });
    const plan = planImport("adjudicators", "name,email,institution,score\nEleanor Vance,ev@example.org,Cambridge Union,", context({ adjudicators: [existing] }));
    const { commit } = buildImportCommit(plan, { actions: { 2: "update" } }, context({ adjudicators: [existing] }));
    expect(commit?.adjudicatorsUpdated[0]).toMatchObject({
      id: "adj-1",
      baseScore: 8,
      trainee: true,
      institutionId: "inst-cam",
      conflicts: [{ teamId: "team-9", type: "personal" }, { institutionId: "inst-cam", type: "institution" }],
    });
  });
});
