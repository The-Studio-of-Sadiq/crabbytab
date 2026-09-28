import { describe, it, expect } from "vitest";
import { calculateStandings } from "./calculator";
import { Tournament, Round, Team, Debate, BallotSubmission } from "@/types";

function createMockTournament(format: "bp" | "uadc", replyEnabled: boolean): Tournament {
  return {
    id: "tourn-test",
    name: "Test Tournament",
    shortName: "Test",
    slug: "test",
    format,
    active: true,
    ownerId: "director",
    admins: {},
    preferences: {
      teamsInDebate: format === "bp" ? 4 : 2,
      substantiveSpeakers: format === "bp" ? 2 : 3,
      replyScoresEnabled: replyEnabled,
      minSpeakerScore: 68,
      maxSpeakerScore: 84,
      stepSpeakerScore: 1,
      minReplyScore: 34,
      maxReplyScore: 42,
      drawRule: "power_paired",
      sideAllocationRule: "balanced",
      ballotDoubleEntry: false,
      publicDraw: true,
      publicResults: true,
      publicStandings: true,
      publicMotions: true,
      feedbackEnabled: true,
      feedbackMinScore: 1,
      feedbackMaxScore: 10,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Standings Calculator (calculateStandings)", () => {
  it("calculates BP standings with 3/2/1/0 points and firsts/seconds/thirds tiebreaks", () => {
    const tournament = createMockTournament("bp", false);
    const round1: Round = {
      id: "r1",
      tournamentId: "tourn-test",
      seq: 1,
      name: "Round 1",
      abbreviation: "R1",
      stage: "preliminary",
      drawType: "random",
      drawStatus: "confirmed",
      feedbackWeight: 1,
      silent: false,
      motionsReleased: true,
      resultsReleased: true,
      completed: true,
      createdAt: "",
    };

    const teams: Team[] = [
      { id: "t1", tournamentId: "tourn-test", name: "Team 1", speakers: [{ id: "s1a", name: "Alice" }, { id: "s1b", name: "Bob" }], breakCategories: [], speakerCategories: [] },
      { id: "t2", tournamentId: "tourn-test", name: "Team 2", speakers: [{ id: "s2a", name: "Charlie" }, { id: "s2b", name: "David" }], breakCategories: [], speakerCategories: [] },
      { id: "t3", tournamentId: "tourn-test", name: "Team 3", speakers: [{ id: "s3a", name: "Eve" }, { id: "s3b", name: "Frank" }], breakCategories: [], speakerCategories: [] },
      { id: "t4", tournamentId: "tourn-test", name: "Team 4", speakers: [{ id: "s4a", name: "Grace" }, { id: "s4b", name: "Heidi" }], breakCategories: [], speakerCategories: [] },
    ];

    const debate: Debate = {
      id: "d1",
      tournamentId: "tourn-test",
      roundId: "r1",
      roundSeq: 1,
      bracket: 0,
      roomRank: 1,
      importance: 0,
      resultStatus: "confirmed",
      sidesConfirmed: true,
      flags: [],
      teams: {
        OG: { teamId: "t1", teamName: "Team 1", side: "OG" },
        OO: { teamId: "t2", teamName: "Team 2", side: "OO" },
        CG: { teamId: "t3", teamName: "Team 3", side: "CG" },
        CO: { teamId: "t4", teamName: "Team 4", side: "CO" },
      },
      adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    };

    const ballot: BallotSubmission = {
      id: "b1",
      tournamentId: "tourn-test",
      roundId: "r1",
      debateId: "d1",
      version: 1,
      confirmed: true,
      discarded: false,
      submitterType: "tabroom",
      timestamp: "",
      speakerScores: {
        OG: [{ speakerId: "s1a", speakerName: "Alice", position: 1, score: 79 }, { speakerId: "s1b", speakerName: "Bob", position: 2, score: 78 }], // 157
        OO: [{ speakerId: "s2a", speakerName: "Charlie", position: 1, score: 77 }, { speakerId: "s2b", speakerName: "David", position: 2, score: 76 }], // 153
        CG: [{ speakerId: "s3a", speakerName: "Eve", position: 1, score: 75 }, { speakerId: "s3b", speakerName: "Frank", position: 2, score: 75 }], // 150
        CO: [{ speakerId: "s4a", speakerName: "Grace", position: 1, score: 74 }, { speakerId: "s4b", speakerName: "Heidi", position: 2, score: 73 }], // 147
      },
      teamScores: {
        OG: { side: "OG", teamId: "t1", points: 3, totalSpeakerScore: 157, rank: 1 },
        OO: { side: "OO", teamId: "t2", points: 2, totalSpeakerScore: 153, rank: 2 },
        CG: { side: "CG", teamId: "t3", points: 1, totalSpeakerScore: 150, rank: 3 },
        CO: { side: "CO", teamId: "t4", points: 0, totalSpeakerScore: 147, rank: 4 },
      },
    };

    const result = calculateStandings(tournament, [round1], teams, [debate], [ballot]);

    expect(result.teams).toHaveLength(4);
    expect(result.teams[0].teamId).toBe("t1");
    expect(result.teams[0].points).toBe(3);
    expect(result.teams[0].firstPlaces).toBe(1);
    expect(result.teams[0].rank).toBe(1);

    expect(result.teams[1].teamId).toBe("t2");
    expect(result.teams[1].points).toBe(2);
    expect(result.teams[1].secondPlaces).toBe(1);
    expect(result.teams[1].rank).toBe(2);

    expect(result.teams[2].teamId).toBe("t3");
    expect(result.teams[2].points).toBe(1);
    expect(result.teams[2].thirdPlaces).toBe(1);
    expect(result.teams[2].rank).toBe(3);

    expect(result.teams[3].teamId).toBe("t4");
    expect(result.teams[3].points).toBe(0);
    expect(result.teams[3].fourthPlaces).toBe(1);
    expect(result.teams[3].rank).toBe(4);

    // Speaker standings
    expect(result.speakers[0].speakerId).toBe("s1a");
    expect(result.speakers[0].totalScore).toBe(79);
    expect(result.speakers[0].averageScore).toBe(79);
  });

  it("calculates two-team standings with wins, margins, and reply standings", () => {
    const tournament = createMockTournament("uadc", true);
    const round1: Round = {
      id: "r1",
      tournamentId: "tourn-test",
      seq: 1,
      name: "Round 1",
      abbreviation: "R1",
      stage: "preliminary",
      drawType: "random",
      drawStatus: "confirmed",
      feedbackWeight: 1,
      silent: false,
      motionsReleased: true,
      resultsReleased: true,
      completed: true,
      createdAt: "",
    };

    const teams: Team[] = [
      {
        id: "t1",
        tournamentId: "tourn-test",
        name: "Gov Team",
        speakers: [
          { id: "g1", name: "Gov 1" },
          { id: "g2", name: "Gov 2" },
          { id: "g3", name: "Gov 3" },
          { id: "gr", name: "Gov Reply" },
        ],
        breakCategories: [],
        speakerCategories: [],
      },
      {
        id: "t2",
        tournamentId: "tourn-test",
        name: "Opp Team",
        speakers: [
          { id: "o1", name: "Opp 1" },
          { id: "o2", name: "Opp 2" },
          { id: "o3", name: "Opp 3" },
          { id: "or", name: "Opp Reply" },
        ],
        breakCategories: [],
        speakerCategories: [],
      },
    ];

    const debate: Debate = {
      id: "d1",
      tournamentId: "tourn-test",
      roundId: "r1",
      roundSeq: 1,
      bracket: 0,
      roomRank: 1,
      importance: 0,
      resultStatus: "confirmed",
      sidesConfirmed: true,
      flags: [],
      teams: {
        AFF: { teamId: "t1", teamName: "Gov Team", side: "AFF" },
        NEG: { teamId: "t2", teamName: "Opp Team", side: "NEG" },
      } as any,
      adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    };

    const ballot: BallotSubmission = {
      id: "b1",
      tournamentId: "tourn-test",
      roundId: "r1",
      debateId: "d1",
      version: 1,
      confirmed: true,
      discarded: false,
      submitterType: "tabroom",
      timestamp: "",
      speakerScores: {
        AFF: [
          { speakerId: "g1", speakerName: "Gov 1", position: 1, score: 75 },
          { speakerId: "g2", speakerName: "Gov 2", position: 2, score: 76 },
          { speakerId: "g3", speakerName: "Gov 3", position: 3, score: 77 },
          { speakerId: "gr", speakerName: "Gov Reply", position: 4, score: 38 }, // Reply speech
        ],
        NEG: [
          { speakerId: "o1", speakerName: "Opp 1", position: 1, score: 74 },
          { speakerId: "o2", speakerName: "Opp 2", position: 2, score: 74 },
          { speakerId: "o3", speakerName: "Opp 3", position: 3, score: 75 },
          { speakerId: "or", speakerName: "Opp Reply", position: 4, score: 37 }, // Reply speech
        ],
      } as any,
      teamScores: {
        AFF: { side: "AFF", teamId: "t1", points: 1, totalSpeakerScore: 266, win: true, margin: 6 },
        NEG: { side: "NEG", teamId: "t2", points: 0, totalSpeakerScore: 260, win: false, margin: -6 },
      } as any,
    };

    const result = calculateStandings(tournament, [round1], teams, [debate], [ballot]);

    expect(result.teams[0].teamId).toBe("t1");
    expect(result.teams[0].wins).toBe(1);
    expect(result.teams[0].margins).toBe(6);

    expect(result.teams[1].teamId).toBe("t2");
    expect(result.teams[1].losses).toBe(1);
    expect(result.teams[1].margins).toBe(-6);

    // Reply standings separated from substantive
    expect(result.replies).toHaveLength(2);
    expect(result.replies[0].speakerId).toBe("gr");
    expect(result.replies[0].totalScore).toBe(38);
    expect(result.replies[1].speakerId).toBe("or");
    expect(result.replies[1].totalScore).toBe(37);

    // Substantive speakers (positions 1-3 with positive score)
    const substantiveSpeakersWithScore = result.speakers.filter((s) => s.speechesCount > 0);
    expect(substantiveSpeakersWithScore.find((s) => s.speakerId === "gr")).toBeUndefined();
    expect(substantiveSpeakersWithScore[0].speakerId).toBe("g3"); // 77
  });

  it("shares rank when teams are tied across all metrics", () => {
    const tournament = createMockTournament("bp", false);
    const teams: Team[] = [
      { id: "t1", tournamentId: "tourn-test", name: "Alpha", speakers: [], breakCategories: [], speakerCategories: [] },
      { id: "t2", tournamentId: "tourn-test", name: "Beta", speakers: [], breakCategories: [], speakerCategories: [] },
    ];
    // No debates played yet, both have 0 points, 0 speaks
    const result = calculateStandings(tournament, [], teams, [], []);
    expect(result.teams[0].rank).toBe(1);
    expect(result.teams[1].rank).toBe(1); // Tied teams share rank 1!
  });
});
