import { describe, expect, it } from "vitest";
import type { Adjudicator, BallotSubmission, Debate, Round, Team } from "@/types";
import { renderEmailTemplate, resolveEmailRecipients } from "./messaging";
import { buildBallotConfirmedRecipients, buildDrawAdjudicatorRecipients } from "./notifications";

/* Tabbycat notifications/utils.py: BallotsEmailGenerator and AdjudicatorAssignmentEmailGenerator. */

const round = { id: "r1", seq: 1, name: "Round 1", stage: "preliminary", drawStatus: "released", adjudicatorsRevealed: true } as Round;
const debate = {
  id: "d1",
  roundId: "r1",
  venueName: "Room 1",
  teams: { AFF: { teamId: "aff", teamName: "Aff", side: "AFF" }, NEG: { teamId: "neg", teamName: "Neg", side: "NEG" } },
  adjudicators: { chairId: "c", chairName: "Chair", panellistIds: ["p"], panellistNames: ["Panel"], traineeIds: ["t"], traineeNames: ["Trainee"] },
} as unknown as Debate;
const adjudicators = [
  { id: "c", name: "Chair", email: "chair@x.org", privateUrlKey: "keyc", privatePasscode: "111" },
  { id: "p", name: "Panel", email: "panel@x.org", privateUrlKey: "keyp", privatePasscode: "222" },
  { id: "t", name: "Trainee", email: "trainee@x.org", privateUrlKey: "keyt", privatePasscode: "333" },
] as unknown as Adjudicator[];
const speeches = (prefix: string, scores: number[]) =>
  scores.map((score, index) => ({ speakerId: `${prefix}${index + 1}`, speakerName: `${prefix}${index + 1}`, position: index + 1, score }));

const votingBallot = {
  id: "b1", tournamentId: "t", roundId: "r1", debateId: "d1", version: 1, confirmed: true, discarded: false,
  submitterType: "tabroom", timestamp: "",
  speakerScores: { AFF: speeches("a", [75, 75]), NEG: speeches("n", [70, 70]) },
  teamScores: {
    AFF: { side: "AFF", teamId: "aff", points: 1, win: true, totalSpeakerScore: 150, votes: 1 },
    NEG: { side: "NEG", teamId: "neg", points: 0, win: false, totalSpeakerScore: 140, votes: 1 },
  },
  sheets: [
    { adjudicatorId: "c", speakerScores: { AFF: speeches("a", [75, 75]), NEG: speeches("n", [70, 70]) } },
    { adjudicatorId: "p", speakerScores: { AFF: speeches("a", [70, 70]), NEG: speeches("n", [72, 72]) } },
  ],
} as unknown as BallotSubmission;

describe("ballot-confirmed emails", () => {
  it("send each voting adjudicator their own sheet only, and nothing to trainees", () => {
    const recipients = buildBallotConfirmedRecipients(votingBallot, debate, adjudicators, round, false, {
      format: "wsdc",
      preferences: { substantiveSpeakers: 2 },
    });
    expect(recipients.map((recipient) => recipient.adjudicatorId)).toEqual(["c", "p"]);
    const panel = recipients.find((recipient) => recipient.adjudicatorId === "p")!.ballot!;
    // The panellist dissented: their own sheet gives the debate to NEG, with their own totals.
    expect(panel).toContain("NEG Neg: Win, total 144");
    expect(panel).toContain("AFF Aff: Loss, total 140");
    expect(panel).not.toContain("150");
  });

  it("send a consensus ballot to every adjudicator, trainees included", () => {
    const { sheets: _sheets, ...consensus } = votingBallot;
    const recipients = buildBallotConfirmedRecipients(consensus as BallotSubmission, debate, adjudicators, round, false);
    expect(recipients.map((recipient) => recipient.adjudicatorId)).toEqual(["c", "p", "t"]);
  });
});

describe("Tabbycat template variables", () => {
  it("give allocation emails each adjudicator's position and own private URL, never the passcode", () => {
    const recipients = buildDrawAdjudicatorRecipients(round, [debate], [], adjudicators, [], {
      privateUrlOrigin: "https://tab.example",
      tournamentSlug: "cup",
    });
    const panel = recipients.find((recipient) => recipient.adjudicatorId === "p")!;
    expect(panel.position).toBe("Panellist");
    expect(panel.privateUrl).toContain("keyp");
    expect(panel.passcode).toBeUndefined();
    expect(renderEmailTemplate("{{position}} {{key}}", panel, "Cup")).toBe("Panellist keyp");
    expect(recipients.find((recipient) => recipient.adjudicatorId === "t")!.position).toBe("Trainee");
  });

  it("offer a team's long name", () => {
    const teams = [{ id: "aff", name: "Uni 1", longName: "University 1", speakers: [{ id: "s", name: "Sam", email: "sam@x.org" }] }] as unknown as Team[];
    const [recipient] = resolveEmailRecipients("all_teams", teams, [], []);
    expect(renderEmailTemplate("{{long_name}}", recipient, "Cup")).toBe("University 1");
  });
});
