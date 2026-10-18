import { describe, expect, it } from "vitest";

import type { Adjudicator, BallotSubmission, Debate, Round, Team, TeamStandingRow } from "@/types";
import { prepareEmailMessages } from "./messaging";
import {
  buildBallotReceiptRecipient,
  buildDrawAdjudicatorRecipients,
  buildDrawTeamRecipients,
  buildTeamPointsRecipients,
  chunkRecipients,
  NOTIFICATION_TEMPLATES,
  notificationLogId,
  releasedRoundNotifications,
} from "./notifications";

function round(id: string, seq: number, overrides: Partial<Round> = {}): Round {
  return {
    id,
    tournamentId: "t1",
    seq,
    name: `Round ${seq}`,
    abbreviation: `R${seq}`,
    stage: "preliminary",
    drawType: "random",
    drawStatus: "none",
    feedbackWeight: 1,
    silent: false,
    motionsReleased: false,
    resultsReleased: false,
    completed: false,
    createdAt: "2026-10-18T00:00:00.000Z",
    ...overrides,
  };
}

const teams: Team[] = [
  {
    id: "alpha",
    tournamentId: "t1",
    name: "Alpha",
    speakers: [{ id: "s1", name: "Ann", email: "ann@example.com" }],
    breakCategories: [],
    speakerCategories: [],
    privateUrlKey: "secret-key",
    privatePasscode: "secret-pass",
  },
  {
    id: "beta",
    tournamentId: "t1",
    name: "Beta",
    speakers: [{ id: "s2", name: "Bo", email: "bo@example.com" }],
    breakCategories: [],
    speakerCategories: [],
  },
];

const adjudicators: Adjudicator[] = [
  {
    id: "j1",
    tournamentId: "t1",
    name: "Judge",
    email: "judge@example.com",
    baseScore: 8,
    trainee: false,
    independent: true,
    conflicts: [],
  },
];

const debate: Debate = {
  id: "d1",
  tournamentId: "t1",
  roundId: "r1",
  roundSeq: 1,
  venueName: "Room 1",
  bracket: 0,
  roomRank: 1,
  importance: 0,
  resultStatus: "confirmed",
  sidesConfirmed: true,
  flags: [],
  teams: {
    AFF: { teamId: "alpha", teamName: "Alpha", side: "AFF" },
    NEG: { teamId: "beta", teamName: "Beta", side: "NEG" },
  } as Debate["teams"],
  adjudicators: {
    chairId: "j1",
    chairName: "Judge",
    panellistIds: [],
    panellistNames: [],
    traineeIds: [],
    traineeNames: [],
  },
};

describe("releasedRoundNotifications", () => {
  const rounds = [
    round("r1", 1, { drawStatus: "released", adjudicatorsRevealed: true, resultsReleased: true }),
    round("r2", 2, { drawStatus: "confirmed" }),
    round("r3", 3, { drawStatus: "draft" }),
    round("r4", 4, { drawStatus: "released", resultsReleased: true, silent: true }),
    round("r5", 5, { drawStatus: "released", cancelled: true }),
  ];

  it("sends nothing unless opted in", () => {
    expect(releasedRoundNotifications({}, rounds)).toEqual([]);
  });

  it("lists only released draws, revealed panels and public results", () => {
    const due = releasedRoundNotifications({ notifyDrawReleased: true, notifyTeamPoints: true }, rounds);
    expect(due.map((item) => `${item.event}:${item.round.id}`)).toEqual([
      "draw_teams:r1",
      "draw_adjudicators:r1",
      "team_points:r1",
      "draw_teams:r2",
      "draw_teams:r4",
    ]);
  });

  it("never emails results when public results are switched off", () => {
    const due = releasedRoundNotifications({ notifyTeamPoints: true, publicResults: false }, rounds);
    expect(due).toEqual([]);
  });
});

describe("draw recipients", () => {
  it("hides panels from teams until they are revealed and never includes private credentials", () => {
    const unrevealed = buildDrawTeamRecipients(round("r1", 1, { drawStatus: "confirmed" }), [debate], teams, adjudicators);
    expect(unrevealed.map((recipient) => [recipient.email, recipient.side, recipient.chair])).toEqual([
      ["ann@example.com", "AFF", "TBA"],
      ["bo@example.com", "NEG", "TBA"],
    ]);
    const messages = prepareEmailMessages(
      unrevealed,
      "Cup",
      "Round 1",
      NOTIFICATION_TEMPLATES.draw_teams.subject,
      NOTIFICATION_TEMPLATES.draw_teams.body
    );
    expect(messages[0].text).toContain("Side: AFF");
    expect(messages[0].text).toContain("Venue: Room 1");
    expect(messages.map((message) => message.text).join("\n")).not.toContain("secret");
    const revealed = buildDrawTeamRecipients(
      round("r1", 1, { drawStatus: "confirmed", adjudicatorsRevealed: true }),
      [debate],
      teams,
      adjudicators
    );
    expect(revealed[0].chair).toBe("Judge");
  });

  it("returns nothing for an unreleased draw or unrevealed panels", () => {
    expect(buildDrawTeamRecipients(round("r1", 1, { drawStatus: "draft" }), [debate], teams, adjudicators)).toEqual([]);
    expect(
      buildDrawAdjudicatorRecipients(round("r1", 1, { drawStatus: "released" }), [debate], teams, adjudicators)
    ).toEqual([]);
    expect(
      buildDrawAdjudicatorRecipients(
        round("r1", 1, { drawStatus: "released", adjudicatorsRevealed: true }),
        [debate],
        teams,
        adjudicators
      ).map((recipient) => recipient.email)
    ).toEqual(["judge@example.com"]);
  });
});

describe("team points recipients", () => {
  const released = round("r1", 1, { drawStatus: "released", resultsReleased: true });
  const standings = [
    { teamId: "alpha", points: 2, roundResults: [{ roundSeq: 1, side: "AFF", points: 1, speakerScore: 150, win: true }] },
    { teamId: "beta", points: 0, roundResults: [{ roundSeq: 1, side: "NEG", points: 0, speakerScore: 140, win: false }] },
  ] as unknown as TeamStandingRow[];

  it("reports the round result and running points", () => {
    const recipients = buildTeamPointsRecipients(released, [debate], teams, standings, false, {});
    expect(recipients.map((recipient) => [recipient.team, recipient.result, recipient.points])).toEqual([
      ["Alpha", "Win", "2"],
      ["Beta", "Loss", "0"],
    ]);
  });

  it("skips teams without a confirmed result and unreleased or silent rounds", () => {
    expect(buildTeamPointsRecipients(released, [debate], teams, [standings[0]], false, {}).map((r) => r.team)).toEqual([
      "Alpha",
    ]);
    expect(buildTeamPointsRecipients({ ...released, resultsReleased: false }, [debate], teams, standings, false, {})).toEqual([]);
    expect(buildTeamPointsRecipients({ ...released, silent: true }, [debate], teams, standings, false, {})).toEqual([]);
  });
});

describe("ballot receipt", () => {
  const ballot: BallotSubmission = {
    id: "b1",
    tournamentId: "t1",
    roundId: "r1",
    debateId: "d1",
    version: 1,
    confirmed: false,
    discarded: false,
    submitterType: "judge",
    speakerScores: {
      AFF: [{ speakerId: "s1", speakerName: "Ann", position: 1, score: 75 }],
      NEG: [{ speakerId: "s2", speakerName: "Bo", position: 1, score: 74.5 }],
    } as BallotSubmission["speakerScores"],
    teamScores: {
      AFF: { side: "AFF", teamId: "alpha", points: 1, totalSpeakerScore: 75, win: true },
      NEG: { side: "NEG", teamId: "beta", points: 0, totalSpeakerScore: 74.5, win: false },
    } as BallotSubmission["teamScores"],
    timestamp: "2026-10-18T00:00:00.000Z",
  };

  it("summarises the submitted ballot for the submitter", () => {
    const recipient = buildBallotReceiptRecipient(adjudicators[0], ballot, debate, { name: "Round 1" }, false);
    expect(recipient?.email).toBe("judge@example.com");
    expect(recipient?.ballot).toBe(
      "AFF Alpha: Win, total 75\n  1. Ann: 75\nNEG Beta: Loss, total 74.50\n  1. Bo: 74.50"
    );
  });

  it("needs an email address", () => {
    expect(buildBallotReceiptRecipient({ ...adjudicators[0], email: "" }, ballot, debate, undefined, false)).toBeNull();
  });
});

describe("helpers", () => {
  it("chunks recipients deterministically by address", () => {
    const chunks = chunkRecipients(
      [
        { email: "c@example.com", name: "C" },
        { email: "A@example.com", name: "A" },
        { email: "b@example.com", name: "B" },
      ],
      2
    );
    expect(chunks.map((chunk) => chunk.map((recipient) => recipient.name))).toEqual([["A", "B"], ["C"]]);
  });

  it("builds slash-free log ids", () => {
    expect(notificationLogId("draw_teams", "r1")).toBe("draw_teams-r1");
  });
});
