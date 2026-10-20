import { describe, expect, it, vi } from "vitest";
import { createFakeAdminFirestore } from "@/test/fakeAdminFirestore";
import type { EmailMessage, EmailProvider } from "./provider";
import {
  baselineBallotConfirmations,
  sendNextBallotConfirmation,
  sendNextRoundNotification,
} from "./notificationService";
import { areRoundMotionsReleased, formatRoundMotions } from "./notifications";
import { DELIVERY_REF_HEADER } from "./messaging";

const T = "tournaments/t1";

function fakeProvider() {
  const sent: EmailMessage[] = [];
  const provider: EmailProvider = {
    verifyConnection: vi.fn(async () => undefined),
    send: vi.fn(async (message: EmailMessage) => void sent.push(message)),
  };
  return { provider, sent };
}

function seed(preferences: Record<string, unknown>, round: Record<string, unknown> = {}) {
  return createFakeAdminFirestore({
    [T]: { name: "Cup", slug: "cup", format: "wsdc", preferences },
    [`${T}/rounds/r1`]: { seq: 1, name: "Round 1", stage: "preliminary", drawStatus: "released", adjudicatorsRevealed: true, motionsReleased: true, ...round },
    [`${T}/teams/aff`]: { name: "Aff", speakers: [{ id: "s1", name: "Sam", email: "sam@x.org" }] },
    [`${T}/teams/neg`]: { name: "Neg", speakers: [{ id: "s2", name: "Nia", email: "nia@x.org" }] },
    [`${T}/adjudicators/c`]: { name: "Chair", email: "chair@x.org" },
    [`${T}/adjudicators/p`]: { name: "Panel", email: "panel@x.org" },
    [`${T}/debates/d1`]: {
      roundId: "r1",
      venueName: "Room 1",
      teams: { AFF: { teamId: "aff", teamName: "Aff", side: "AFF" }, NEG: { teamId: "neg", teamName: "Neg", side: "NEG" } },
      adjudicators: { chairId: "c", panellistIds: ["p"], panellistNames: [], traineeIds: [], traineeNames: [] },
    },
    [`${T}/motions/m1`]: { text: "THW ban cars", rounds: ["r1"], released: true, seq: 1, infoSlide: "Cities only" },
    [`${T}/motions/m2`]: { text: "Unreleased", rounds: ["r1"], released: false, seq: 2 },
    [`${T}/serverOnly/emailSettings`]: { replyToName: "Tab", replyToAddress: "tab@x.org", templates: {} },
  });
}

function confirmedBallot(id: string) {
  return {
    tournamentId: "t1",
    roundId: "r1",
    debateId: "d1",
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "tabroom",
    speakerScores: {
      AFF: [{ speakerId: "s1", speakerName: "Sam", position: 1, score: 75 }],
      NEG: [{ speakerId: "s2", speakerName: "Nia", position: 1, score: 72 }],
    },
    teamScores: {
      AFF: { side: "AFF", teamId: "aff", points: 1, totalSpeakerScore: 75, win: true },
      NEG: { side: "NEG", teamId: "neg", points: 0, totalSpeakerScore: 72, win: false },
    },
    timestamp: "2026-10-20T10:00:00.000Z",
  };
}

describe("motions released emails", () => {
  it("formats only the round's released motions", () => {
    const text = formatRoundMotions(
      [
        { id: "m1", tournamentId: "t1", text: "A", rounds: ["r1"], released: true, infoSlide: "Slide" },
        { id: "m2", tournamentId: "t1", text: "B", rounds: ["r1"], released: false },
      ],
      "r1"
    );
    expect(text).toBe("A\n   Info slide: Slide");
    expect(areRoundMotionsReleased({ motionsReleased: true, drawStatus: "draft" })).toBe(false);
  });

  it("emails speakers and adjudicators of the round once, with Reply-To and a delivery ref", async () => {
    const fake = seed({ notifyMotionsReleased: true });
    const { provider, sent } = fakeProvider();
    const input = { firestore: fake.firestore, tournamentId: "t1", sender: { uid: "u", email: "", name: "U" }, createProvider: () => provider };
    const result = await sendNextRoundNotification(input);
    expect(result).toMatchObject({ status: "sent", event: "motions_released", sent: 4 });
    expect(sent.map((message) => message.to).sort()).toEqual(["chair@x.org", "nia@x.org", "panel@x.org", "sam@x.org"]);
    expect(sent[0].text).toContain("THW ban cars");
    expect(sent[0].text).not.toContain("Unreleased");
    expect(sent[0].replyTo).toBe("\"Tab\" <tab@x.org>");
    expect(sent[0].headers?.[DELIVERY_REF_HEADER]).toMatch(/^t1\//);
    expect((await sendNextRoundNotification(input)).status).toBe("idle");
  });

  it("sends nothing before the motions are released", async () => {
    const fake = seed({ notifyMotionsReleased: true }, { motionsReleased: false });
    const { provider } = fakeProvider();
    const result = await sendNextRoundNotification({ firestore: fake.firestore, tournamentId: "t1", sender: { uid: "u", email: "", name: "U" }, createProvider: () => provider });
    expect(result.status).toBe("idle");
  });
});

describe("ballot confirmed emails", () => {
  it("emails each confirmed result once to the debate's adjudicators", async () => {
    const fake = seed({ notifyBallotConfirmed: true });
    fake.store.set(`${T}/ballots/b1`, confirmedBallot("b1"));
    const { provider, sent } = fakeProvider();
    const input = { firestore: fake.firestore, tournamentId: "t1", createProvider: () => provider };
    expect(await sendNextBallotConfirmation(input)).toMatchObject({ status: "sent", event: "ballot_confirmed", sent: 2 });
    expect(sent.map((message) => message.to).sort()).toEqual(["chair@x.org", "panel@x.org"]);
    expect(sent[0].text).toContain("Sam: 75");
    expect((await sendNextBallotConfirmation(input)).status).toBe("idle");
  });

  it("skips confirmations made before the organiser opted in, and unconfirmed ballots", async () => {
    const fake = seed({ notifyBallotConfirmed: true });
    fake.store.set(`${T}/ballots/b1`, confirmedBallot("b1"));
    expect(await baselineBallotConfirmations(fake.firestore, "t1")).toBe(1);
    fake.store.set(`${T}/ballots/b2`, { ...confirmedBallot("b2"), confirmed: false });
    const { provider, sent } = fakeProvider();
    expect((await sendNextBallotConfirmation({ firestore: fake.firestore, tournamentId: "t1", createProvider: () => provider })).status).toBe("idle");
    expect(sent).toEqual([]);
  });

  it("does nothing when the notification is off", async () => {
    const fake = seed({});
    fake.store.set(`${T}/ballots/b1`, confirmedBallot("b1"));
    const { provider } = fakeProvider();
    expect((await sendNextBallotConfirmation({ firestore: fake.firestore, tournamentId: "t1", createProvider: () => provider })).status).toBe("idle");
  });
});
