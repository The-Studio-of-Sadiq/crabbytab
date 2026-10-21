import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { buildBallotResult, type BallotRules } from "@/lib/ballots/result";
import type { BallotSubmission, Debate, DebateSide, SpeakerScoreEntry, Team, Tournament } from "@/types";
import { createDebateXmlArchive } from "./debateXml";
import { importDebateXmlArchive, type XmlElementLike, type XmlParser } from "./debateXmlImport";

const parseXml: XmlParser = (text) => {
  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") throw new Error(message);
    },
  }).parseFromString(text, "application/xml");
  return document.documentElement as unknown as XmlElementLike;
};
const NOW = "2026-10-18T00:00:00.000Z";

/** A three-teams-per-room tournament: one full room and a short room of two. */
function polyArchive(ballotMode: "consensus" | "voting") {
  const tournament = {
    id: "t1",
    name: "Speech Open",
    shortName: "Speech",
    slug: "speech",
    format: "poly",
    preferences: {
      teamsInDebate: 3,
      substantiveSpeakers: 1,
      replyScoresEnabled: false,
      minSpeakerScore: 50,
      maxSpeakerScore: 99,
      stepSpeakerScore: 1,
      ballotMode,
      marginIncludesDissenters: true,
      teamScoreIncludesGhosts: false,
    },
  } as unknown as Tournament;
  const teams: Team[] = ["a", "b", "c", "d", "e"].map((key) => ({
    id: `team-${key}`,
    tournamentId: "t1",
    name: `Team ${key.toUpperCase()}`,
    speakers: [{ id: `team-${key}-s1`, name: `Speaker ${key}` }],
    breakCategories: [],
    speakerCategories: [],
  }));
  const debate = (id: string, members: Team[], chair: number): Debate => ({
    id,
    tournamentId: "t1",
    roundId: "r1",
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "confirmed",
    sidesConfirmed: true,
    flags: [],
    teams: Object.fromEntries(members.map((team, index) => [`P${index + 1}`, { teamId: team.id, teamName: team.name, side: `P${index + 1}` }])) as Debate["teams"],
    adjudicators: { chairId: `adj-${chair}`, panellistIds: ballotMode === "voting" ? [`adj-${chair + 1}`] : [], panellistNames: [], traineeIds: [], traineeNames: [] },
  });
  const debates = [debate("d1", teams.slice(0, 3), 1), debate("d2", teams.slice(3), 3)];
  const speeches = (members: Team[], totals: number[]) =>
    Object.fromEntries(members.map((team, index) => [
      `P${index + 1}`,
      [{ speakerId: team.speakers[0].id, speakerName: team.speakers[0].name, position: 1, score: totals[index] } as SpeakerScoreEntry],
    ])) as Record<DebateSide, SpeakerScoreEntry[]>;
  const ballot = (source: Debate, members: Team[], sheets: number[][]): BallotSubmission => {
    const rules: BallotRules = { format: "poly", preferences: tournament.preferences, sides: Object.keys(source.teams) as DebateSide[] };
    const teamIds = Object.fromEntries(Object.entries(source.teams).map(([side, slot]) => [side, slot?.teamId ?? ""]));
    const result = ballotMode === "voting"
      ? buildBallotResult({ speakerScores: {}, sheets: [source.adjudicators.chairId!, ...source.adjudicators.panellistIds].map((adjudicatorId, index) => ({ adjudicatorId, speakerScores: speeches(members, sheets[index]) })) }, teamIds, source.adjudicators.chairId, rules)
      : buildBallotResult({ speakerScores: speeches(members, sheets[0]) }, teamIds, source.adjudicators.chairId, rules);
    return {
      id: `b-${source.id}`,
      tournamentId: "t1",
      roundId: "r1",
      debateId: source.id,
      version: 1,
      confirmed: true,
      discarded: false,
      submitterType: "tabroom",
      speakerScores: result.speakerScores,
      teamScores: result.teamScores,
      ...(result.sheets ? { sheets: result.sheets } : {}),
      chairId: source.adjudicators.chairId,
      timestamp: NOW,
    };
  };
  return {
    tournament,
    rounds: [{ id: "r1", tournamentId: "t1", seq: 1, name: "Round 1", abbreviation: "R1", stage: "preliminary", drawType: "random", drawStatus: "released", feedbackWeight: 1, silent: false, motionsReleased: false, resultsReleased: true, completed: true, createdAt: NOW }],
    teams,
    adjudicators: ["adj-1", "adj-2", "adj-3", "adj-4"].map((id) => ({ id, tournamentId: "t1", name: id, baseScore: 5, trainee: false, independent: true, conflicts: [] })),
    venues: [{ id: "venue-1", tournamentId: "t1", name: "Room 1", priority: 1 }],
    motions: [],
    breakCategories: [],
    debates,
    ballots: [
      ballot(debates[0], teams.slice(0, 3), [[70, 80, 75], [72, 80, 80]]),
      ballot(debates[1], teams.slice(3), [[66, 77], [68, 75]]),
    ],
    feedback: [],
    institutions: [],
  } as Parameters<typeof createDebateXmlArchive>[0];
}

function roundTrip(ballotMode: "consensus" | "voting") {
  const xml = createDebateXmlArchive(polyArchive(ballotMode));
  const result = importDebateXmlArchive(xml, { parseXml, identity: { id: "t2", slug: "copy", ownerId: "o" }, now: NOW });
  expect(result.issues.filter((issue) => issue.severity === "error").map((issue) => `${issue.path}: ${issue.message}`)).toEqual([]);
  return { xml, data: result.data! };
}

describe("DebateXML for N teams per room", () => {
  it("exports every team of each room in position order, with no BP style", () => {
    const { xml } = roundTrip("consensus");
    expect(xml).not.toMatch(/style=/);
    const firstDebate = xml.slice(xml.indexOf("<debate"), xml.indexOf("</debate>"));
    expect((firstDebate.match(/<side /g) ?? []).length).toBe(3);
  });

  it("imports as N teams per room with the room's own positions and ranks from the totals", () => {
    const { data } = roundTrip("consensus");
    expect(data.tournament.format).toBe("poly");
    expect(data.tournament.preferences.teamsInDebate).toBe(3);
    const [full, short] = data.collections.debates.filter((debate) => !debate.byeTeamId);
    expect(Object.keys(full.teams).sort()).toEqual(["P1", "P2", "P3"]);
    expect(Object.keys(short.teams).sort()).toEqual(["P1", "P2"]);
    const ballots = new Map(data.collections.ballots.map((ballot) => [ballot.debateId, ballot]));
    const fullBallot = ballots.get(full.id)!;
    expect([fullBallot.teamScores.P2.rank, fullBallot.teamScores.P3.rank, fullBallot.teamScores.P1.rank]).toEqual([1, 2, 3]);
    expect(fullBallot.teamScores.P2.points).toBe(2);
    expect(ballots.get(short.id)!.teamScores.P2.points).toBe(1);
  });

  it("imports voting sheets as score-only ballots with margins including dissenters", () => {
    const { data } = roundTrip("voting");
    expect(data.tournament.preferences.ballotMode).toBe("voting");
    expect(data.tournament.preferences.marginIncludesDissenters).toBe(true);
    const ballot = data.collections.ballots.find((item) => item.debateId === "d1")!;
    expect(ballot.sheets).toHaveLength(2);
    expect(ballot.teamScores.P1.totalSpeakerScore).toBe(71);
    expect(ballot.teamScores.P1.rank).toBeUndefined();
  });
});
