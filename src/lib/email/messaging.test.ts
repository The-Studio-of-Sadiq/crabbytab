import { describe, expect, it, vi } from "vitest";
import { Adjudicator, Debate, Round, Team } from "@/types";
import {
  EmailCampaignInputError,
  EmailRecipient,
  renderEmailTemplate,
  resolveEmailRecipients,
  sendEmailCampaign,
} from "./messaging";
import { EmailMessage, EmailProvider } from "./provider";

const round: Round = {
  id: "r1",
  tournamentId: "t1",
  seq: 1,
  name: "Round 1",
  abbreviation: "R1",
  stage: "preliminary",
  drawType: "power_paired",
  drawStatus: "confirmed",
  feedbackWeight: 1,
  silent: false,
  motionsReleased: false,
  resultsReleased: false,
  completed: false,
  createdAt: "",
};

const team: Team = {
  id: "team-1",
  tournamentId: "t1",
  name: "Team One",
  institutionName: "Example University",
  speakers: [
    { id: "speaker-1", name: "Alex", email: "alex@example.com" },
    { id: "speaker-2", name: "No Email" },
  ],
  breakCategories: [],
  speakerCategories: [],
  breakStatus: "breaking",
};

const adjudicator: Adjudicator = {
  id: "adj-1",
  tournamentId: "t1",
  name: "Judge One",
  email: "judge@example.com",
  baseScore: 5,
  trainee: false,
  independent: false,
  checkedIn: true,
  conflicts: [],
};

const debate: Debate = {
  id: "d1",
  tournamentId: "t1",
  roundId: "r1",
  roundSeq: 1,
  venueName: "Room 4",
  bracket: 0,
  roomRank: 1,
  importance: 0,
  resultStatus: "none",
  sidesConfirmed: true,
  flags: [],
  teams: {
    AFF: { teamId: team.id, teamName: team.name, side: "AFF" },
    NEG: { teamId: "team-2", teamName: "Team Two", side: "NEG" },
  },
  adjudicators: {
    chairId: adjudicator.id,
    chairName: adjudicator.name,
    panellistIds: [],
    panellistNames: [],
    traineeIds: [],
    traineeNames: [],
  },
};

describe("email recipient resolution", () => {
  it("resolves team and adjudicator groups and deduplicates addresses", () => {
    const duplicateTeam: Team = {
      ...team,
      id: "team-2",
      name: "Second Team",
      speakers: [{ id: "speaker-3", name: "Alex Duplicate", email: "ALEX@example.com" }],
    };
    const recipients = resolveEmailRecipients(
      "all_participants",
      [team, duplicateTeam],
      [adjudicator],
      []
    );

    expect(recipients.map((recipient) => recipient.email)).toEqual([
      "alex@example.com",
      "judge@example.com",
    ]);
    expect(resolveEmailRecipients("breaking_teams", [team], [], [])[0].team).toBe("Team One");
  });

  it("resolves round participants and chair templates from round assignments", () => {
    const participantRecipients = resolveEmailRecipients(
      "round_participants",
      [team],
      [adjudicator],
      [debate],
      round
    );
    const chairRecipients = resolveEmailRecipients(
      "chairs",
      [],
      [adjudicator],
      [debate],
      round
    );

    expect(participantRecipients[0]).toMatchObject({
      name: "Alex",
      team: "Team One",
      round: "Round 1",
      debate: "Team One vs Team Two",
      venue: "Room 4",
      chair: "Judge One",
    });
    expect(chairRecipients.map((recipient) => recipient.email)).toEqual(["judge@example.com"]);
    expect(resolveEmailRecipients("chairs", [], [adjudicator], []).length).toBe(0);
  });

  it("renders supported variables and rejects unknown variables", () => {
    const recipient: EmailRecipient = {
      name: "Alex",
      email: "alex@example.com",
      team: "Team One",
    };

    expect(renderEmailTemplate("Hi {{ name }} from {{tournament}}", recipient, "Cup"))
      .toBe("Hi Alex from Cup");
    expect(() => renderEmailTemplate("{{unknown_variable}}", recipient, "Cup"))
      .toThrow(EmailCampaignInputError);
  });
});

describe("email campaign service", () => {
  const recipient = (index: number): EmailRecipient => ({
    email: `person${index}@example.com`,
    name: `Person ${index}`,
  });

  it("sends each message individually and reports partial failures", async () => {
    const sent: EmailMessage[] = [];
    const provider: EmailProvider = {
      verifyConnection: vi.fn(async () => undefined),
      send: vi.fn(async (message) => {
        if (message.to === "person2@example.com") throw new Error("SMTP failed");
        sent.push(message);
      }),
    };

    const result = await sendEmailCampaign(
      provider,
      [recipient(1), recipient(2)],
      "Tournament",
      undefined,
      "Hello {{name}}",
      "From {{tournament}}"
    );

    expect(provider.verifyConnection).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "person1@example.com",
      subject: "Hello Person 1",
      text: "From Tournament",
    });
    expect(result).toMatchObject({ sent: 1, failed: 1 });
  });

  it("rejects sends over 100 recipients before contacting the provider", async () => {
    const provider: EmailProvider = {
      verifyConnection: vi.fn(async () => undefined),
      send: vi.fn(async () => undefined),
    };
    await expect(
      sendEmailCampaign(
        provider,
        Array.from({ length: 101 }, (_, index) => recipient(index)),
        "Tournament",
        undefined,
        "Hello",
        "Message"
      )
    ).rejects.toThrow("limited to 100");
    expect(provider.verifyConnection).not.toHaveBeenCalled();
  });
});
