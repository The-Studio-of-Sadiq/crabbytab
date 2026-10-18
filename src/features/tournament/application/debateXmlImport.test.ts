import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { aggregateVotingSheets, consensusTeamScores, type BallotRules } from "@/lib/ballots/result";
import type {
  Adjudicator,
  AdjudicatorSheet,
  BallotSubmission,
  Debate,
  DebateSide,
  SpeakerScoreEntry,
  Team,
  Tournament,
} from "@/types";
import { createDebateXmlArchive, type DebateXmlArchiveInput } from "./debateXml";
import {
  DEBATE_XML_MAX_CHARACTERS,
  importDebateXmlArchive,
  type DebateXmlImportResult,
  type XmlElementLike,
  type XmlParser,
} from "./debateXmlImport";

/** Same contract as the browser parser: throw on anything that is not well-formed. */
const parseXml: XmlParser = (text) => {
  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") throw new Error(message);
    },
  }).parseFromString(text, "application/xml");
  return document.documentElement as unknown as XmlElementLike;
};

const identity = { id: "tourn-imported", slug: "imported", ownerId: "owner-1" };
const NOW = "2026-10-18T00:00:00.000Z";

function runImport(xml: string): DebateXmlImportResult {
  return importDebateXmlArchive(xml, { parseXml, identity, now: NOW });
}

function errorsOf(result: DebateXmlImportResult): string[] {
  return result.issues.filter((issue) => issue.severity === "error").map((issue) => `${issue.path}: ${issue.message}`);
}

/* -------------------------------------------------------------------------- */
/* A two-team voting tournament exercising every exported feature             */
/* -------------------------------------------------------------------------- */

function votingTournament(): DebateXmlArchiveInput {
  const tournament = {
    id: "t1",
    name: "Spring Open & Co",
    shortName: "Spring",
    slug: "spring",
    format: "uadc",
    preferences: {
      teamsInDebate: 2,
      substantiveSpeakers: 3,
      replyScoresEnabled: true,
      ballotMode: "voting",
      teamFeedbackQuestions: [
        { id: "q-team", label: "Was the chair clear?", type: "yes_no", required: true },
        { id: "q-scale", label: "Rate the oral", type: "scale", required: false, min: 1, max: 5 },
      ],
      adjudicatorFeedbackQuestions: [{ id: "q-adj", label: "Comments on <panel>", type: "text", required: false }],
    },
  } as unknown as Tournament;
  const rules: BallotRules = { format: tournament.format, preferences: tournament.preferences };

  const team = (id: string, name: string, extra: Partial<Team> = {}): Team => ({
    id,
    tournamentId: "t1",
    name,
    speakers: [1, 2, 3].map((n) => ({ id: `${id}-s${n}`, name: `${name} speaker ${n}` })),
    breakCategories: ["open"],
    speakerCategories: [],
    ...extra,
  });
  const teams: Team[] = [
    {
      ...team("team-a", "Alpha & Sons", { institutionId: "inst-a", institutionName: "University A", codeName: "UA 1" }),
      speakers: [
        { id: "team-a-s1", name: "Ada <A>", categories: ["novice"] },
        { id: "team-a-s2", name: "Ben" },
        { id: "team-a-s3", name: "Cy" },
      ],
      breakCategories: ["open", "novice"],
      speakerCategories: ["novice"],
    },
    team("team-b", "Bravo", { institutionId: "inst-b", institutionName: "University B" }),
    team("team-c", "Charlie", { institutionId: "inst-a", institutionName: "University A" }),
    team("team-d", "Delta", { institutionName: "Name Only College" }),
    team("team-e", "Echo"),
  ];
  const adjudicator = (id: string, name: string, extra: Partial<Adjudicator> = {}): Adjudicator => ({
    id,
    tournamentId: "t1",
    name,
    baseScore: 6,
    trainee: false,
    independent: false,
    conflicts: [],
    ...extra,
  });
  const adjudicators: Adjudicator[] = [
    adjudicator("adj-1", "Judge One", {
      institutionId: "inst-a",
      institutionName: "University A",
      baseScore: 8.5,
      conflicts: [
        { institutionId: "inst-a", type: "institution" },
        { teamId: "team-d", type: "personal" },
        { adjudicatorId: "adj-4", type: "personal" },
      ],
    }),
    adjudicator("adj-2", "Judge Two", { independent: true }),
    adjudicator("adj-3", "Judge Three"),
    adjudicator("adj-4", "Judge Four"),
    adjudicator("adj-5", "Trainee Five", { trainee: true, baseScore: 3 }),
  ];

  const speeches = (team: Team, scores: number[], ghostAt?: number): SpeakerScoreEntry[] =>
    scores.map((score, index) => {
      const position = index + 1;
      const speaker = position === 4 || position === ghostAt ? team.speakers[0] : team.speakers[index];
      return {
        speakerId: speaker.id,
        speakerName: speaker.name,
        position,
        score,
        ...(position === ghostAt ? { ghost: true } : {}),
      };
    });
  const [alpha, bravo, charlie, delta] = teams;
  const sheet = (adjudicatorId: string, aff: number[], neg: number[]): AdjudicatorSheet => ({
    adjudicatorId,
    speakerScores: { AFF: speeches(alpha, aff), NEG: speeches(bravo, neg) } as AdjudicatorSheet["speakerScores"],
  });
  const sheets = [
    sheet("adj-1", [75, 76, 74, 37.5], [72, 73, 71, 36]),
    sheet("adj-2", [74, 75, 75, 38], [73, 72, 72, 36.5]),
    sheet("adj-3", [70, 71, 70, 35], [76, 75, 74, 38]),
  ];
  const teamIds = { AFF: "team-a", NEG: "team-b" };
  const voting = aggregateVotingSheets(sheets, "adj-1", teamIds, rules);
  const consensusScores = {
    AFF: speeches(charlie, [70, 71, 72, 35], 3),
    NEG: speeches(delta, [74, 73, 75, 37]),
  } as BallotSubmission["speakerScores"];
  const ballot = (id: string, debateId: string, extra: Partial<BallotSubmission>): BallotSubmission => ({
    id,
    tournamentId: "t1",
    roundId: "r1",
    debateId,
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "tabroom",
    speakerScores: {} as BallotSubmission["speakerScores"],
    teamScores: {} as BallotSubmission["teamScores"],
    timestamp: NOW,
    ...extra,
  });
  const panel = (chairId: string, panellistIds: string[] = [], traineeIds: string[] = []) => ({
    chairId,
    panellistIds,
    panellistNames: [],
    traineeIds,
    traineeNames: [],
  });
  const debate = (id: string, roundId: string, teamsBySide: Array<[DebateSide, Team]>, extra: Partial<Debate>): Debate => ({
    id,
    tournamentId: "t1",
    roundId,
    roundSeq: roundId === "r1" ? 1 : 2,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: Object.fromEntries(teamsBySide.map(([side, item]) => [side, { teamId: item.id, teamName: item.name, side }])) as Debate["teams"],
    adjudicators: panel("adj-4"),
    ...extra,
  });

  return {
    tournament,
    rounds: [
      { id: "r1", tournamentId: "t1", seq: 1, name: "Round 1", abbreviation: "R1", stage: "preliminary", drawType: "random", drawStatus: "released", feedbackWeight: 0.5, silent: false, motionsReleased: true, resultsReleased: true, completed: true, createdAt: NOW },
      { id: "r2", tournamentId: "t1", seq: 2, name: "Grand Final", abbreviation: "GF", stage: "elimination", drawType: "elimination", drawStatus: "draft", feedbackWeight: 1, silent: false, motionsReleased: false, resultsReleased: false, breakCategoryIds: ["open"], completed: false, createdAt: NOW },
    ],
    teams,
    adjudicators,
    venues: [
      { id: "venue-1", tournamentId: "t1", name: "Room \"One\"", priority: 10 },
      { id: "venue-2", tournamentId: "t1", name: "Room Two", priority: 5 },
    ],
    motions: [
      { id: "motion-1", tournamentId: "t1", text: "This House would <test> & verify", reference: "Education", infoSlide: "Some context", rounds: ["r1"], released: true },
      { id: "motion-2", tournamentId: "t1", text: "This House regrets unused motions", rounds: [], released: false },
    ],
    breakCategories: [
      { id: "open", tournamentId: "t1", name: "Open", slug: "open", seq: 1, breakSize: 4, reserveSize: 0, isGeneral: true, priority: 10 },
      { id: "novice", tournamentId: "t1", name: "Novice", slug: "novice", seq: 2, breakSize: 2, reserveSize: 1, isGeneral: false, priority: 5 },
    ],
    debates: [
      // Sides deliberately inserted NEG-first: the archive must still order them AFF, NEG.
      debate("debate-1", "r1", [["NEG", bravo], ["AFF", alpha]], {
        venueId: "venue-1",
        motionId: "motion-1",
        resultStatus: "confirmed",
        adjudicators: panel("adj-1", ["adj-2", "adj-3"], ["adj-5"]),
      }),
      debate("debate-2", "r1", [["AFF", charlie], ["NEG", delta]], {
        venueId: "venue-2",
        motionId: "motion-1",
        resultStatus: "confirmed",
      }),
      {
        ...debate("debate-bye", "r1", [["AFF", teams[4]]], { flags: ["bye"] }),
        byeTeamId: "team-e",
        adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
      },
      debate("debate-3", "r2", [["AFF", alpha], ["NEG", delta]], { venueId: "venue-1", adjudicators: panel("adj-2", ["adj-3", "adj-4"]) }),
    ],
    ballots: [
      ballot("ballot-1", "debate-1", {
        speakerScores: voting.speakerScores,
        teamScores: voting.teamScores,
        sheets,
        chairId: "adj-1",
        motionId: "motion-1",
      }),
      ballot("ballot-2", "debate-2", {
        speakerScores: consensusScores,
        teamScores: consensusTeamScores(consensusScores, { AFF: 2, NEG: 1 }, { AFF: "team-c", NEG: "team-d" }, rules),
        chairId: "adj-4",
      }),
      ballot("ballot-old", "debate-2", { confirmed: false, discarded: true }),
    ],
    feedback: [
      {
        id: "f1", tournamentId: "t1", roundId: "r1", debateId: "debate-1", targetType: "adjudicator",
        targetAdjudicatorId: "adj-1", sourceType: "team", sourceId: "team-a", sourceName: "Alpha & Sons",
        score: 4, answers: { "q-team": true, "q-scale": 4 }, comments: "private", confirmed: true, timestamp: NOW,
      },
      {
        id: "f2", tournamentId: "t1", roundId: "r1", debateId: "debate-1", targetType: "adjudicator",
        targetAdjudicatorId: "adj-1", sourceType: "adjudicator", sourceId: "adj-2", sourceName: "Judge Two",
        score: 3, answers: { "q-adj": "Fine, & clear" }, ignored: true, confirmed: true, timestamp: NOW,
      },
      {
        id: "f3", tournamentId: "t1", roundId: "r1", debateId: "debate-2", targetType: "adjudicator",
        targetAdjudicatorId: "adj-4", sourceType: "team", sourceId: "team-c", sourceName: "Charlie",
        score: 5, confirmed: false, timestamp: NOW,
      },
    ],
    institutions: [
      { id: "inst-a", tournamentId: "t1", name: "University A", code: "UA", region: "North" },
      { id: "inst-b", tournamentId: "t1", name: "University B", code: "UB" },
    ],
  };
}

function asArchiveInput(result: DebateXmlImportResult): DebateXmlArchiveInput {
  const data = result.data!;
  return { tournament: data.tournament, ...data.collections };
}

describe("DebateXML import", () => {
  it("round-trips a voting tournament: export → import → export produces the same archive", () => {
    const original = votingTournament();
    const first = createDebateXmlArchive(original);
    const imported = runImport(first);

    expect(errorsOf(imported)).toEqual([]);
    expect(imported.data).toBeDefined();
    const second = createDebateXmlArchive(asArchiveInput(imported));
    expect(second).toBe(first);
  });

  it("restores ids, sides, voting sheets, ghosts, replies, byes, conflicts and feedback", () => {
    const original = votingTournament();
    const result = runImport(createDebateXmlArchive(original));
    const { tournament, collections } = result.data!;

    expect(tournament).toMatchObject({
      id: "tourn-imported",
      slug: "imported",
      name: "Spring Open & Co",
      shortName: "Spring",
      format: "uadc",
      ownerId: "owner-1",
      admins: { "owner-1": true },
    });
    expect(tournament.preferences).toMatchObject({
      substantiveSpeakers: 3,
      replyScoresEnabled: true,
      ballotMode: "voting",
    });
    expect(result.counts).toMatchObject({
      institutions: 3,
      teams: 5,
      speakers: 15,
      adjudicators: 5,
      venues: 2,
      motions: 2,
      breakCategories: 2,
      rounds: 2,
      debates: 3,
      byes: 1,
      ballots: 2,
      votingBallots: 1,
      feedback: 2,
      feedbackQuestions: 3,
    });

    expect(collections.teams.map((team) => team.id)).toEqual(original.teams.map((team) => team.id));
    expect(collections.teams[0]).toMatchObject({
      codeName: "UA 1",
      institutionId: "inst-a",
      breakCategories: ["open", "novice"],
      speakerCategories: ["novice"],
    });
    expect(collections.teams[0].speakers[0]).toEqual({ id: "team-a-s1", name: "Ada <A>", categories: ["novice"] });
    expect(collections.teams[3].institutionName).toBe("Name Only College");

    const judgeOne = collections.adjudicators[0];
    expect(judgeOne.baseScore).toBe(8.5);
    expect(judgeOne.conflicts).toEqual([
      { teamId: "team-d", type: "personal" },
      { institutionId: "inst-a", type: "institution" },
      { adjudicatorId: "adj-4", type: "personal" },
    ]);
    expect(collections.adjudicators[1].independent).toBe(true);
    expect(collections.adjudicators[4].trainee).toBe(true);

    const [debateOne, debateTwo, bye] = collections.debates;
    expect(debateOne.teams.AFF.teamId).toBe("team-a");
    expect(debateOne.teams.NEG.teamId).toBe("team-b");
    expect(debateOne.adjudicators).toMatchObject({ chairId: "adj-1", panellistIds: ["adj-2", "adj-3"], traineeIds: ["adj-5"] });
    expect(debateOne).toMatchObject({ venueId: "venue-1", venueName: 'Room "One"', motionId: "motion-1", resultStatus: "confirmed" });
    expect(bye).toMatchObject({ byeTeamId: "team-e", flags: ["bye"] });
    expect(collections.debates[3].resultStatus).toBe("none");

    const originalVoting = original.ballots[0];
    const votingBallot = collections.ballots.find((ballot) => ballot.debateId === debateOne.id)!;
    expect(votingBallot.sheets).toEqual(originalVoting.sheets);
    expect(votingBallot.teamScores).toEqual(originalVoting.teamScores);
    expect(votingBallot.speakerScores).toEqual(originalVoting.speakerScores);

    const consensus = collections.ballots.find((ballot) => ballot.debateId === debateTwo.id)!;
    expect(consensus.sheets).toBeUndefined();
    expect(consensus.speakerScores.AFF[2]).toMatchObject({ speakerId: "team-c-s1", position: 3, ghost: true });
    expect(consensus.speakerScores.AFF[3]).toMatchObject({ speakerId: "team-c-s1", position: 4, score: 35 });
    expect(consensus.speakerScores.AFF[3].ghost).toBeUndefined();
    expect(consensus.teamScores).toEqual(original.ballots[1].teamScores);
    expect(debateTwo.teams.NEG).toMatchObject({ points: 1, speakerScoreTotal: 259 });

    const [roundOne, final] = collections.rounds;
    expect(roundOne).toMatchObject({ name: "Round 1", abbreviation: "R1", feedbackWeight: 0.5, completed: true, drawStatus: "draft", motionsReleased: false, resultsReleased: false });
    expect(final).toMatchObject({ stage: "elimination", drawType: "elimination", breakCategoryIds: ["open"], completed: false });
    expect(collections.motions[0]).toMatchObject({ infoSlide: "Some context", reference: "Education", rounds: [roundOne.id], released: false });
    expect(collections.breakCategories[1]).toMatchObject({ breakSize: 2, reserveSize: 1, isGeneral: false });

    expect(collections.feedback).toHaveLength(2);
    expect(collections.feedback[0]).toMatchObject({
      sourceType: "team",
      sourceId: "team-a",
      targetAdjudicatorId: "adj-1",
      roundId: roundOne.id,
      answers: { "q-team": true, "q-scale": 4 },
    });
    expect(collections.feedback[0].comments).toBeUndefined();
    expect(collections.feedback[1]).toMatchObject({ sourceType: "adjudicator", ignored: true, answers: { "q-adj": "Fine, & clear" } });
    expect(tournament.preferences.teamFeedbackQuestions?.[1]).toMatchObject({ id: "q-scale", min: 1, max: 5 });
  });

  it("reads a Tabbycat-style BP archive with panel-signed consensus ballots", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<tournament name="Tabbycat Open" short="TO">
  <participants>
    <team id="T1" name="Oxford A" code="Ox A" institution="I1"><speaker id="S1" categories="SC1">Ana</speaker><speaker id="S2">Bo</speaker></team>
    <team id="T2" name="Cam B"><speaker id="S3" institutions="I2">Cid</speaker><speaker id="S4">Dee</speaker></team>
    <team id="T3" name="LSE"><speaker id="S5">Eve</speaker><speaker id="S6">Fay</speaker></team>
    <team id="T4" name="UCL"><speaker id="S7">Gus</speaker><speaker id="S8">Hal</speaker></team>
    <adjudicator id="A1" name="Ivy" score="7" institutions="I1" team-conflicts="T2"/>
    <adjudicator id="A2" name="Jo" score="5"/>
  </participants>
  <round name="Round 1" abbreviation="R1" feedback-weight="0.7">
    <debate id="D1" chair="A1" adjudicators="A1 A2" venue="V1" motion="M1">
      <side team="T3"><ballot adjudicators="A1 A2" rank="2">2</ballot><speech speaker="S5"><ballot adjudicators="A1 A2">76</ballot></speech><speech speaker="S6"><ballot adjudicators="A1 A2">75</ballot></speech></side>
      <side team="T1"><ballot adjudicators="A1 A2" rank="1">3</ballot><speech speaker="S1"><ballot adjudicators="A1 A2">78</ballot></speech><speech speaker="S2"><ballot adjudicators="A1 A2">77</ballot></speech></side>
      <side team="T2"><ballot adjudicators="A1 A2" rank="4">0</ballot><speech speaker="S3"><ballot adjudicators="A1 A2">70</ballot></speech><speech speaker="S4"><ballot adjudicators="A1 A2">71</ballot></speech></side>
      <side team="T4"><ballot adjudicators="A1 A2" rank="3">1</ballot><speech speaker="S7"><ballot adjudicators="A1 A2">72</ballot></speech><speech speaker="S8"><ballot adjudicators="A1 A2">73</ballot></speech></side>
    </debate>
  </round>
  <institution id="I1" reference="OX">Oxford</institution>
  <institution id="I2" reference="CAM">Cambridge</institution>
  <motion id="M1" reference="Tech">THW ban <![CDATA[AI & art]]></motion>
  <venue id="V1" priority="100">Hall</venue>
  <speaker-category id="SC1">ESL</speaker-category>
  <feedback-ignored/>
</tournament>`;
    const result = runImport(xml);
    expect(errorsOf(result)).toEqual([]);
    const { tournament, collections } = result.data!;
    expect(tournament.format).toBe("bp");
    expect(tournament.preferences.substantiveSpeakers).toBe(2);
    expect(tournament.preferences.replyScoresEnabled).toBe(false);

    const [debate] = collections.debates;
    expect(Object.fromEntries(Object.entries(debate.teams).map(([side, slot]) => [side, slot.teamId]))).toEqual({
      OG: "T3",
      OO: "T1",
      CG: "T2",
      CO: "T4",
    });
    const [ballot] = collections.ballots;
    expect(ballot.chairId).toBe("A1");
    expect(ballot.teamScores.OO).toMatchObject({ rank: 1, points: 3, totalSpeakerScore: 155 });
    expect(ballot.teamScores.CG).toMatchObject({ rank: 4, points: 0 });
    expect(collections.motions[0].text).toBe("THW ban AI & art");
    expect(collections.teams[0]).toMatchObject({ institutionId: "I1", institutionName: "Oxford", codeName: "Ox A" });
    expect(collections.teams[1].institutionId).toBe("I2");
    expect(collections.teams[0].speakers[0].categories).toEqual(["ESL"]);
    expect(collections.adjudicators[0].conflicts).toEqual([
      { teamId: "T2", type: "personal" },
      { institutionId: "I1", type: "institution" },
    ]);
  });

  describe("rejects malformed or hostile input without returning data", () => {
    const base = createDebateXmlArchive(votingTournament());

    it.each([
      ["malformed XML", "<tournament><round></tournament>", "not well-formed"],
      ["a DOCTYPE (entity expansion)", '<?xml version="1.0"?><!DOCTYPE t [<!ENTITY a "aaaa">]><tournament>&a;</tournament>', "DOCTYPE"],
      ["the wrong root element", "<html><body/></html>", "Expected a <tournament> root"],
      ["an oversized file", `<tournament>${" ".repeat(DEBATE_XML_MAX_CHARACTERS)}</tournament>`, "larger than"],
    ])("%s", (_label, xml, message) => {
      const result = runImport(xml);
      expect(result.data).toBeUndefined();
      expect(errorsOf(result).join("\n")).toContain(message);
    });

    it("reports an undefined team reference with the element path", () => {
      const result = runImport(base.replace('<side team="team_team-b">', '<side team="team_missing">'));
      expect(result.data).toBeUndefined();
      expect(errorsOf(result)).toContainEqual(
        expect.stringMatching(/round "Round 1" › debate "debate_debate-1" › side 2: Refers to team "team_missing"/)
      );
    });

    it("refuses duplicate ids and a team drawn twice in one round", () => {
      const duplicated = base.replace('<venue id="venue_venue-2"', '<venue id="venue_venue-1"');
      expect(errorsOf(runImport(duplicated)).join("\n")).toContain('"venue_venue-1" is used more than once');

      const twice = base.replace('<side team="team_team-d">', '<side team="team_team-a">');
      expect(errorsOf(runImport(twice)).join("\n")).toContain('Team "Alpha & Sons" appears more than once in this round');
    });

    it("refuses non-numeric scores and wrong side counts", () => {
      const badScore = base.replace(">75</ballot>", ">seventy-five</ballot>");
      expect(errorsOf(runImport(badScore)).join("\n")).toContain('"seventy-five" is not a number');

      const bp = base.replace('style="uadc"', 'style="bp"');
      expect(errorsOf(runImport(bp)).join("\n")).toContain("A BP debate needs 4 teams; this one has 2");
    });

    it("does not execute or keep markup from text content", () => {
      const result = runImport(base.replace("Room Two", "&lt;script&gt;alert(1)&lt;/script&gt;"));
      expect(errorsOf(result)).toEqual([]);
      expect(result.data!.collections.venues[1].name).toBe("<script>alert(1)</script>");
    });
  });
});
