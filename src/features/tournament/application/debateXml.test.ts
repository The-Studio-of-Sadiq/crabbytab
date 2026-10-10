import { describe, expect, it } from "vitest";
import type { DebateXmlArchiveInput } from "./debateXml";
import { createDebateXmlArchive } from "./debateXml";

function archiveInput(): DebateXmlArchiveInput {
  const tournament = {
    id: "t1",
    name: "Test & Debate",
    shortName: "T&D",
    slug: "test-debate",
    format: "uadc",
    preferences: {
      teamsInDebate: 2,
      substantiveSpeakers: 3,
      replyScoresEnabled: true,
      minSpeakerScore: 60,
      maxSpeakerScore: 80,
      stepSpeakerScore: 1,
      minReplyScore: 30,
      maxReplyScore: 40,
      drawRule: "random",
      sideAllocationRule: "balanced",
      ballotDoubleEntry: false,
      publicDraw: true,
      publicResults: true,
      publicStandings: true,
      publicMotions: true,
      feedbackEnabled: true,
      feedbackMinScore: 1,
      feedbackMaxScore: 10,
      teamFeedbackQuestions: [{
        id: "q-team",
        label: "Was the chair clear?",
        type: "yes_no",
        required: true,
      }],
    },
  } as DebateXmlArchiveInput["tournament"];
  const rounds: DebateXmlArchiveInput["rounds"] = [{
    id: "r1",
    tournamentId: "t1",
    seq: 1,
    name: "Round 1",
    abbreviation: "R1",
    stage: "preliminary",
    drawType: "random",
    drawStatus: "released",
    feedbackWeight: 1,
    silent: false,
    motionsReleased: true,
    resultsReleased: true,
    completed: true,
    createdAt: "",
  }];
  const teams: DebateXmlArchiveInput["teams"] = [
    {
      id: "team-a",
      tournamentId: "t1",
      name: "A & B",
      institutionId: "inst-a",
      institutionName: "University A",
      speakers: [{ id: "speaker-a", name: "Speaker <One>", categories: ["novice"] }],
      breakCategories: ["open"],
      speakerCategories: ["novice"],
    },
    {
      id: "team-b",
      tournamentId: "t1",
      name: "Team B",
      speakers: [{ id: "speaker-b", name: "Speaker Two" }],
      breakCategories: [],
      speakerCategories: [],
    },
  ];
  const adjudicators: DebateXmlArchiveInput["adjudicators"] = [{
    id: "adj-1",
    tournamentId: "t1",
    name: "Judge One",
    email: "private@example.com",
    institutionId: "inst-a",
    institutionName: "University A",
    baseScore: 7,
    trainee: false,
    independent: false,
    conflicts: [],
  }];
  const debate: DebateXmlArchiveInput["debates"][number] = {
    id: "debate-1",
    tournamentId: "t1",
    roundId: "r1",
    roundSeq: 1,
    venueId: "venue-1",
    venueName: "Room 1",
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "confirmed",
    sidesConfirmed: true,
    flags: [],
    teams: {
      AFF: { teamId: "team-a", teamName: "A & B", side: "AFF" },
      NEG: { teamId: "team-b", teamName: "Team B", side: "NEG" },
    },
    adjudicators: {
      chairId: "adj-1",
      chairName: "Judge One",
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
    },
    motionId: "motion-1",
  };
  return {
    tournament,
    rounds,
    teams,
    adjudicators,
    venues: [{ id: "venue-1", tournamentId: "t1", name: "Room 1", priority: 1 }],
    motions: [{ id: "motion-1", tournamentId: "t1", text: "This House... &", rounds: ["r1"], released: true }],
    breakCategories: [{
      id: "open",
      tournamentId: "t1",
      name: "Open",
      slug: "open",
      seq: 1,
      breakSize: 8,
      reserveSize: 0,
      isGeneral: true,
      priority: 1,
    }],
    debates: [debate],
    ballots: [{
      id: "ballot-1",
      tournamentId: "t1",
      roundId: "r1",
      debateId: "debate-1",
      version: 1,
      confirmed: true,
      discarded: false,
      submitterType: "judge",
      speakerScores: {
        AFF: [{ speakerId: "speaker-a", speakerName: "Speaker <One>", position: 1, score: 75 }],
        NEG: [],
      },
      teamScores: {
        AFF: { side: "AFF", teamId: "team-a", points: 1, totalSpeakerScore: 75, win: true, rank: 1 },
        NEG: { side: "NEG", teamId: "team-b", points: 0, totalSpeakerScore: 70, win: false, rank: 2 },
      },
      chairId: "adj-1",
      timestamp: "",
    }],
    feedback: [{
      id: "feedback-1",
      tournamentId: "t1",
      roundId: "r1",
      debateId: "debate-1",
      targetType: "adjudicator",
      targetAdjudicatorId: "adj-1",
      sourceType: "team",
      sourceId: "team-a",
      sourceName: "A & B",
      score: 8,
      comments: "Do not export free-text comments into this schema.",
      answers: { "q-team": true },
      confirmed: true,
      timestamp: "",
    }],
    institutions: [{
      id: "inst-a",
      tournamentId: "t1",
      name: "University A",
      code: "UA",
    }],
  };
}

describe("DebateXML archive", () => {
  it("exports DTA-shaped XML with escaped values, references, results, and feedback", () => {
    const xml = createDebateXmlArchive(archiveInput());
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('name="Test &amp; Debate"');
    expect(xml).toContain("A &amp; B");
    expect(xml).toContain("Speaker &lt;One&gt;");
    expect(xml).toContain('rank="1"');
    expect(xml).toContain('<feedback source-team="team_team-a"');
    expect(xml).toContain('<answer question="question_q-team">true</answer>');
    expect(xml).not.toContain("private@example.com");
    expect(xml).not.toContain("Do not export free-text comments");
  });

  it("fails instead of fabricating required DebateXML records", () => {
    const input = archiveInput();
    expect(() => createDebateXmlArchive({ ...input, venues: [] })).toThrow("at least one venue");
    expect(() => createDebateXmlArchive({ ...input, adjudicators: [] })).toThrow("at least one adjudicator");
  });
});
