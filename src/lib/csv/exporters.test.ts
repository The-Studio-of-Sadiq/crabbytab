import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import type { Adjudicator, Debate, FeedbackSubmission, Round, SpeakerStandingRow, Team } from "@/types";
import {
  adjudicatorScoresCsv,
  csvFileStem,
  drawCsv,
  feedbackSubmissionsCsv,
  speakerStandingsCsv,
  toCsv,
} from "./exporters";

function parse(csv: string): string[][] {
  return Papa.parse<string[]>(csv, { skipEmptyLines: true }).data;
}

function speaker(overrides: Partial<SpeakerStandingRow>): SpeakerStandingRow {
  return {
    rank: 1,
    speakerId: "s1",
    speakerName: "Ada",
    teamId: "t1",
    teamName: "Alpha",
    categories: [],
    totalScore: 150,
    averageScore: 75,
    speechesCount: 2,
    scoresByRound: [],
    metrics: {} as SpeakerStandingRow["metrics"],
    ...overrides,
  };
}

describe("CSV exports", () => {
  it("quotes commas, quotes and newlines and neutralises spreadsheet formulas", () => {
    const csv = toCsv(["Name", "Note"], [["Smith, \"Jo\"", "line one\nline two"], ["=HYPERLINK(\"x\")", -3]]);
    expect(parse(csv)).toEqual([
      ["Name", "Note"],
      ["Smith, \"Jo\"", "line one\nline two"],
      ["'=HYPERLINK(\"x\")", "-3"],
    ]);
  });

  it("exports speaker standings with categories and one column per round", () => {
    const csv = speakerStandingsCsv([
      speaker({
        institutionCode: "UA",
        categories: ["novice", "esl"],
        scoresByRound: [
          { roundSeq: 2, score: 76, position: 1 },
          { roundSeq: 1, score: 74, position: 2 },
        ],
      }),
      speaker({ rank: 2, speakerId: "s2", speakerName: "Ben", totalScore: 70.333, averageScore: 70.333, speechesCount: 1, scoresByRound: [{ roundSeq: 1, score: 70.333, position: 1 }] }),
    ]);
    expect(parse(csv)).toEqual([
      ["Rank", "Speaker", "Team", "Institution", "Categories", "Speeches", "Total Score", "Average Score", "Round 1", "Round 2"],
      ["1", "Ada", "Alpha", "UA", "novice; esl", "2", "150.00", "75.00", "74", "76"],
      ["2", "Ben", "Alpha", "", "", "1", "70.33", "70.33", "70.333", ""],
    ]);
  });

  it("labels the reply tab and drops categories", () => {
    const [header] = parse(speakerStandingsCsv([speaker({ scoresByRound: [{ roundSeq: 1, score: 37, position: 4 }] })], { reply: true }));
    expect(header).toEqual(["Rank", "Reply Speaker", "Team", "Institution", "Speeches", "Total Score", "Average Score", "Round 1"]);
  });

  it("exports a draw in side order, with byes last and adjudicators optional", () => {
    const debate = (overrides: Partial<Debate>): Debate => ({
      id: "d",
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
      adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
      ...overrides,
    });
    const debates = [
      debate({ id: "bye", roomRank: 1, byeTeamId: "e", teams: { AFF: { teamId: "e", teamName: "Echo", side: "AFF" } } as Debate["teams"] }),
      debate({
        id: "d2",
        roomRank: 2,
        venueName: "Room 2",
        teams: {
          NEG: { teamId: "b", teamName: "Bravo", side: "NEG" },
          AFF: { teamId: "a", teamName: "Alpha, A", side: "AFF" },
        } as Debate["teams"],
        adjudicators: { chairName: "Jo", panellistIds: ["p"], panellistNames: ["Pat", "Sam"], traineeIds: [], traineeNames: ["Tia"] },
        motionText: "THW test",
      }),
    ];
    expect(parse(drawCsv(debates, { format: "wsdc", includeMotion: true }))).toEqual([
      ["Room Rank", "Venue", "Affirmative", "Negative", "Chair", "Panellists", "Trainees", "Motion", "Notes"],
      ["2", "Room 2", "Alpha, A", "Bravo", "Jo", "Pat; Sam", "Tia", "THW test", ""],
      ["1", "", "", "", "", "", "", "", "Bye: Echo"],
    ]);
    const [header] = parse(drawCsv(debates, { format: "bp", includeAdjudicators: false }));
    expect(header).toEqual(["Room Rank", "Venue", "Opening Government", "Opening Opposition", "Closing Government", "Closing Opposition", "Notes"]);
  });

  it("exports adjudicator scores and feedback submissions with question answers", () => {
    const adjudicator = { id: "a1", name: "Judge, One", institutionName: "UA", baseScore: 7, testScore: 6.5, trainee: false, independent: true } as Adjudicator;
    expect(parse(adjudicatorScoresCsv([{ adjudicator, feedbackCount: 2, feedbackAverage: 8.25, score: 7.123 }]))[1]).toEqual([
      "Judge, One", "UA", "7", "6.5", "2", "8.25", "7.12", "no", "yes",
    ]);

    const rounds = [{ id: "r1", seq: 1, name: "Round 1", abbreviation: "R1" }] as Round[];
    const teams = [{ id: "t1", name: "Alpha" }] as Team[];
    const submission: FeedbackSubmission = {
      id: "f1",
      tournamentId: "t",
      roundId: "r1",
      debateId: "d1",
      targetType: "adjudicator",
      targetAdjudicatorId: "a1",
      sourceType: "team",
      sourceId: "t1",
      sourceName: "",
      score: 4,
      agreeWithDecision: false,
      comments: "Said \"great\",\nthen left",
      answers: { q1: true, q2: ["Clear", "Fair"] },
      confirmed: true,
      timestamp: "2026-10-18T10:00:00.000Z",
    };
    const rows = parse(feedbackSubmissionsCsv([submission], {
      rounds,
      teams,
      adjudicators: [adjudicator],
      questions: [
        { id: "q1", label: "Clear?", type: "yes_no", required: true },
        { id: "q2", label: "Qualities", type: "select_many", required: false },
        { id: "q1", label: "Clear?", type: "yes_no", required: true },
      ],
    }));
    expect(rows[0]).toEqual(["Round", "Target", "Target Type", "Source", "Source Type", "Score", "Agrees With Decision", "Confirmed", "Ignored", "Comments", "Clear?", "Qualities", "Submitted At"]);
    expect(rows[1]).toEqual(["R1", "Judge, One", "adjudicator", "Alpha", "team", "4", "no", "yes", "no", "Said \"great\",\nthen left", "yes", "Clear; Fair", "2026-10-18T10:00:00.000Z"]);
  });

  it("builds safe file names", () => {
    expect(csvFileStem("Spring Open / 2026", "Round 1")).toBe("Spring_Open_2026_Round_1");
    expect(csvFileStem("  ", "")).toBe("export");
  });
});
