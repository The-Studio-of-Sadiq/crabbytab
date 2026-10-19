import { describe, expect, it } from "vitest";
import type { BallotIntakeRecord, BallotSubmission, Debate, Round } from "@/types";
import { supportsCode39 } from "@/lib/checkins/code39";
import { isTournamentRuleError } from "./stateGuards";
import {
  addIntakeRecord,
  ballotSheetCode,
  buildBallotSheetIndex,
  createIntakeRecord,
  debateIntakeRow,
  expectedBallotSheets,
  intakeRecordId,
  parseSheetInput,
  resolveIntakeScan,
  roundIntakeRows,
  summarizeIntake,
  usesPerAdjudicatorSheets,
} from "./ballotIntake";

function debate(id: string, overrides: Partial<Debate> = {}): Debate {
  return {
    id,
    tournamentId: "t",
    roundId: "r1",
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: {} as Debate["teams"],
    adjudicators: { chairId: "c", panellistIds: ["p1", "p2"], traineeIds: ["tr"] } as unknown as Debate["adjudicators"],
    venueName: `Room ${id}`,
    ...overrides,
  };
}

const adjudicators = [
  { id: "c", name: "Chair" },
  { id: "p1", name: "Pan 1" },
  { id: "p2", name: "Pan 2" },
  { id: "tr", name: "Trainee" },
];

const rounds = [
  { id: "r1", name: "Round 1", cancelled: false },
  { id: "r2", name: "Round 2", cancelled: false },
  { id: "rx", name: "Round X", cancelled: true },
];

function ballot(overrides: Partial<BallotSubmission>): BallotSubmission {
  return {
    id: `b${overrides.version ?? 1}`,
    tournamentId: "t",
    roundId: "r1",
    debateId: "d1",
    version: 1,
    confirmed: false,
    discarded: false,
    submitterType: "tabroom",
    timestamp: "2026-10-18T10:00:00.000Z",
    speakerScores: {} as BallotSubmission["speakerScores"],
    teamScores: { AFF: { teamId: "a", rank: 1 }, NEG: { teamId: "n", rank: 2 } } as unknown as BallotSubmission["teamScores"],
    ...overrides,
  };
}

function receipt(sheetCode: string, overrides: Partial<BallotIntakeRecord> = {}): BallotIntakeRecord {
  return {
    id: intakeRecordId(sheetCode),
    tournamentId: "t",
    roundId: "r1",
    debateId: "d1",
    sheetCode,
    receivedAt: "2026-10-18T10:05:00.000Z",
    ...overrides,
  };
}

describe("ballot sheet ids", () => {
  it("are stable, compact, Code 39 compatible and distinct per adjudicator", () => {
    const code = ballotSheetCode("d1", "c");
    expect(code).toBe(ballotSheetCode("d1", "c"));
    expect(code).toHaveLength(8);
    expect(code).not.toBe(ballotSheetCode("d1", "p1"));
    expect(code).not.toBe(ballotSheetCode("d1"));
    expect(ballotSheetCode("d2", "c")).not.toBe(code);
    const [sheet] = expectedBallotSheets(debate("d1", { roundSeq: 12 }), adjudicators, true);
    expect(sheet.sheetId).toBe(`B12-${sheet.code}`);
    expect(supportsCode39(sheet.sheetId)).toBe(true);
  });

  it("has no collisions across a large tournament", () => {
    const codes = new Set<string>();
    for (let index = 0; index < 4000; index++) {
      for (const adjudicator of ["", "chair", "p1", "p2"]) codes.add(ballotSheetCode(`debate-${index}`, adjudicator || undefined));
    }
    expect(codes.size).toBe(16000);
  });

  it("parses full ids, bare codes, scanner asterisks, lowercase and look-alike letters", () => {
    const code = ballotSheetCode("d1", "c");
    expect(parseSheetInput(`B3-${code}`)).toEqual({ ok: true, code, roundSeq: 3 });
    expect(parseSheetInput(` *b3-${code.toLowerCase()}* `)).toEqual({ ok: true, code, roundSeq: 3 });
    expect(parseSheetInput(code)).toEqual({ ok: true, code });
    const withZero = Array.from({ length: 200 }, (_, index) => ballotSheetCode(`z${index}`)).find((item) => item.includes("0"));
    expect(withZero).toBeDefined();
    expect(parseSheetInput(withZero!.replace("0", "O"))).toEqual({ ok: true, code: withZero });
  });

  it("rejects malformed and mistyped ids, including swapped neighbours", () => {
    const code = ballotSheetCode("d1", "c");
    expect(parseSheetInput("").ok).toBe(false);
    expect(parseSheetInput("team-123").ok).toBe(false);
    const substituted = (code[0] === "2" ? "3" : "2") + code.slice(1);
    expect(parseSheetInput(substituted).ok).toBe(false);
    const swapIndex = [...code].findIndex((character, index) => index < 6 && character !== code[index + 1]);
    const swapped = code.slice(0, swapIndex) + code[swapIndex + 1] + code[swapIndex] + code.slice(swapIndex + 2);
    expect(parseSheetInput(swapped).ok).toBe(false);
  });
});

describe("expected sheets", () => {
  it("prints one sheet per voting adjudicator (chair first, never trainees) or one per debate", () => {
    const voting = expectedBallotSheets(debate("d1"), adjudicators, true);
    expect(voting.map((sheet) => sheet.adjudicatorName)).toEqual(["Chair", "Pan 1", "Pan 2"]);
    const consensus = expectedBallotSheets(debate("d1"), adjudicators, false);
    expect(consensus).toHaveLength(1);
    expect(consensus[0].adjudicatorId).toBeUndefined();
    expect(consensus[0].adjudicatorName).toBe("Chair");
  });

  it("gives byes no sheet and an empty voting panel one debate sheet", () => {
    expect(expectedBallotSheets(debate("d1", { byeTeamId: "x" }), adjudicators, true)).toEqual([]);
    const empty = debate("d1", { adjudicators: { panellistIds: [] } as unknown as Debate["adjudicators"] });
    expect(expectedBallotSheets(empty, adjudicators, true)).toHaveLength(1);
  });

  it("uses voting sheets only for two-team voting ballots", () => {
    expect(usesPerAdjudicatorSheets({ format: "wsdc", preferences: { ballotMode: "voting" } })).toBe(true);
    expect(usesPerAdjudicatorSheets({ format: "bp", preferences: { ballotMode: "voting" } })).toBe(false);
    expect(usesPerAdjudicatorSheets({ format: "wsdc", preferences: {} })).toBe(false);
  });
});

describe("intake scans", () => {
  const debates = [debate("d1"), debate("d2", { roundId: "r2", roundSeq: 2 }), debate("d3", { roundId: "rx", roundSeq: 3 })];
  const index = buildBallotSheetIndex(debates, adjudicators);
  const scan = (input: string, intake: BallotIntakeRecord[] = [], roundId = "r1") =>
    resolveIntakeScan({ input, roundId, index, intake, rounds, debates });

  it("accepts a sheet of the round being received, in either ballot mode", () => {
    const voterSheet = expectedBallotSheets(debates[0], adjudicators, true)[1];
    const accepted = scan(voterSheet.sheetId);
    expect(accepted.kind).toBe("accepted");
    expect(accepted.kind === "accepted" && accepted.sheet.adjudicatorId).toBe("p1");
    expect(scan(expectedBallotSheets(debates[0], adjudicators, false)[0].code).kind).toBe("accepted");
  });

  it("reports re-scans as duplicates without recording them again", () => {
    const sheet = expectedBallotSheets(debates[0], adjudicators, false)[0];
    const outcome = scan(sheet.sheetId, [receipt(sheet.code, { receivedByName: "Sam" })]);
    expect(outcome.kind).toBe("duplicate");
    expect(outcome.message).toContain("Sam");
  });

  it("reports unknown, wrong-round, cancelled-round and invalid sheets", () => {
    expect(scan(ballotSheetCode("gone", "c")).kind).toBe("unknown");
    expect(scan("hello").kind).toBe("invalid");
    const other = scan(expectedBallotSheets(debates[1], adjudicators, false)[0].sheetId);
    expect(other.kind).toBe("wrong_round");
    expect(other.message).toContain("Round 2");
    expect(scan(expectedBallotSheets(debates[2], adjudicators, false)[0].sheetId).kind).toBe("blocked");
  });

  it("refuses to record intake for a cancelled round", () => {
    const sheet = expectedBallotSheets(debates[2], adjudicators, false)[0];
    const create = () => createIntakeRecord({
      sheet,
      round: { id: "rx", name: "Round X", cancelled: true } as Round,
      tournamentId: "t",
      receivedAt: "now",
    });
    expect(create).toThrow();
    try { create(); } catch (error) { expect(isTournamentRuleError(error)).toBe(true); }
  });

  it("keeps the first receipt when the same sheet is recorded twice", () => {
    const sheet = expectedBallotSheets(debates[0], adjudicators, false)[0];
    const first = createIntakeRecord({ sheet, round: { id: "r1", name: "Round 1" } as Round, tournamentId: "t", receivedAt: "1", receivedBy: "u1" });
    const second = { ...first, receivedAt: "2", receivedBy: "u2" };
    const once = addIntakeRecord([], first);
    const twice = addIntakeRecord(once.intake, second);
    expect(once.added).toBe(true);
    expect(twice.added).toBe(false);
    expect(twice.intake).toEqual([first]);
  });
});

describe("round status board", () => {
  const base = { adjudicators, perAdjudicator: false, doubleEntry: false, format: "wsdc" as const };
  const consensusCode = ballotSheetCode("d1");

  it("moves from missing to received to entered to confirmed", () => {
    const row = (intake: BallotIntakeRecord[], ballots: BallotSubmission[]) =>
      debateIntakeRow({ ...base, debate: debate("d1"), intake, ballots }).status;
    expect(row([], [])).toBe("missing");
    expect(row([receipt(consensusCode)], [])).toBe("received");
    expect(row([receipt(consensusCode)], [ballot({})])).toBe("entered");
    expect(row([receipt(consensusCode)], [ballot({ confirmed: true })])).toBe("confirmed");
    // A portal ballot with no paper still counts as entered.
    expect(row([], [ballot({ submitterType: "judge" })])).toBe("entered");
  });

  it("tracks partial receipt of voting sheets", () => {
    const voting = { ...base, perAdjudicator: true, debate: debate("d1"), ballots: [] };
    const one = debateIntakeRow({ ...voting, intake: [receipt(ballotSheetCode("d1", "c"), { adjudicatorId: "c" })] });
    expect(one.status).toBe("partial");
    expect(one.missingSheets.map((sheet) => sheet.adjudicatorId)).toEqual(["p1", "p2"]);
    // A whole-debate sheet (e.g. printed before switching to voting) covers every voter.
    expect(debateIntakeRow({ ...voting, intake: [receipt(consensusCode)] }).status).toBe("received");
  });

  it("separates awaiting check from disputed under double entry", () => {
    const double = { ...base, doubleEntry: true, debate: debate("d1"), intake: [] };
    expect(debateIntakeRow({ ...double, ballots: [ballot({})] }).status).toBe("awaiting_check");
    const agreeing = [ballot({ version: 1 }), ballot({ version: 2 })];
    expect(debateIntakeRow({ ...double, ballots: agreeing }).status).toBe("awaiting_check");
    const disagreeing = [
      ballot({ version: 1 }),
      ballot({ version: 2, teamScores: { AFF: { teamId: "a", rank: 2 }, NEG: { teamId: "n", rank: 1 } } as unknown as BallotSubmission["teamScores"] }),
    ];
    const disputed = debateIntakeRow({ ...double, ballots: disagreeing });
    expect(disputed.status).toBe("disputed");
    expect(disputed.disputeReason).toContain("v2, v1");
    expect(debateIntakeRow({ ...double, ballots: [ballot({ discarded: true })] }).status).toBe("disputed");
    expect(debateIntakeRow({ ...double, ballots: [ballot({ discarded: true }), ballot({ version: 2, confirmed: true })] }).status)
      .toBe("confirmed");
  });

  it("lists a round's debates in room order without byes and counts them", () => {
    const debates = [
      debate("d2", { roomRank: 2 }),
      debate("d1", { roomRank: 1 }),
      debate("bye", { byeTeamId: "x", roomRank: 3 }),
      debate("other", { roundId: "r2" }),
    ];
    const rows = roundIntakeRows({
      ...base,
      roundId: "r1",
      debates,
      intake: [receipt(consensusCode)],
      ballots: [ballot({ debateId: "d2", confirmed: true })],
    });
    expect(rows.map((row) => row.debateId)).toEqual(["d1", "d2"]);
    const summary = summarizeIntake(rows);
    expect(summary.debates).toBe(2);
    expect(summary.counts.received).toBe(1);
    expect(summary.counts.confirmed).toBe(1);
    expect(summary.sheetsExpected).toBe(2);
    expect(summary.sheetsReceived).toBe(1);
  });
});
