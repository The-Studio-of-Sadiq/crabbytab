import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createFakeAdminFirestore, type FakeAdminFirestore } from "@/test/fakeAdminFirestore";
import { hashPublicFormsPassword } from "@/lib/publicFormsPassword";

let fake: FakeAdminFirestore;
vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => fake.firestore,
  getAdminAuth: () => ({}),
}));

import { POST } from "./route";

const T = "tournaments/t1";
const SIDES = ["OG", "OO", "CG", "CO"] as const;
const params = { params: Promise.resolve({ slug: "open" }) };

function request(body: unknown, ip = "10.0.0.1"): NextRequest {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function seed(preferences: Record<string, unknown>, extra: Record<string, Record<string, unknown>> = {}) {
  fake = createFakeAdminFirestore({
    "tournamentSlugs/open": { tournamentId: "t1" },
    [T]: {
      name: "Open",
      slug: "open",
      format: "bp",
      preferences: {
        substantiveSpeakers: 1,
        replyScoresEnabled: false,
        minSpeakerScore: 68,
        maxSpeakerScore: 84,
        stepSpeakerScore: 1,
        feedbackMinScore: 1,
        feedbackMaxScore: 5,
        ...preferences,
      },
      ownerId: "owner",
      admins: {},
    },
    [`${T}/rounds/r1`]: { seq: 1, name: "Round 1", stage: "preliminary", drawStatus: "released", adjudicatorsRevealed: true },
    [`${T}/debates/d1`]: {
      roundId: "r1",
      roundSeq: 1,
      resultStatus: "none",
      sidesConfirmed: true,
      flags: [],
      teams: Object.fromEntries(SIDES.map((side) => [side, { side, teamId: `team-${side}`, teamName: side }])),
      adjudicators: {
        chairId: "chair",
        chairName: "Chair",
        panellistIds: ["panel"],
        panellistNames: ["Panel"],
        traineeIds: ["trainee"],
        traineeNames: ["Trainee"],
      },
    },
    ...Object.fromEntries(SIDES.map((side) => [
      `${T}/teams/team-${side}`,
      { name: side, speakers: [{ id: `speaker-${side}`, name: `${side} Speaker` }] },
    ])),
    [`${T}/adjudicators/chair`]: { name: "Chair" },
    [`${T}/adjudicators/panel`]: { name: "Panel" },
    [`${T}/adjudicators/trainee`]: { name: "Trainee", trainee: true },
    ...extra,
  });
}

function ballotBody(sourceId = "chair", password?: string) {
  return {
    action: "submit",
    kind: "ballot",
    sourceType: "adjudicator",
    sourceId,
    ...(password !== undefined ? { password } : {}),
    ballot: {
      // The server ignores these: it sets the id and the submitter itself.
      id: "ballot-forged",
      submitterId: "someone-else",
      teamScores: Object.fromEntries(SIDES.map((side, index) => [side, { rank: index + 1 }])),
      speakerScores: Object.fromEntries(SIDES.map((side, index) => [
        side,
        [{ speakerId: `speaker-${side}`, position: 1, score: 80 - index * 2 }],
      ])),
    },
  };
}

function storedBallots() {
  return [...fake.store.entries()].filter(([path]) => path.startsWith(`${T}/ballots/`)).map(([, data]) => data);
}

describe("POST /api/public/tournaments/{slug}/forms", () => {
  beforeEach(() => seed({ publicBallotForm: true, publicFeedbackForm: true }));

  it("refuses ballots and feedback while the public forms are off", async () => {
    seed({});
    expect((await POST(request(ballotBody()), params)).status).toBe(403);
    const feedback = await POST(request({ action: "load", kind: "feedback", sourceType: "team", sourceId: "team-OG" }), params);
    expect(feedback.status).toBe(403);
    expect(storedBallots()).toHaveLength(0);
  });

  it("keeps the feedback form closed when feedback is switched off", async () => {
    seed({ publicFeedbackForm: true, feedbackEnabled: false });
    const response = await POST(request({ action: "load", kind: "feedback", sourceType: "team", sourceId: "team-OG" }), params);
    expect(response.status).toBe(403);
  });

  it("stores a public ballot unconfirmed, with a server-chosen id and submitter", async () => {
    const response = await POST(request(ballotBody()), params);
    expect(response.status).toBe(200);
    const [ballot] = storedBallots();
    expect(ballot).toMatchObject({ debateId: "d1", submitterId: "chair", submitterType: "judge", confirmed: false, discarded: false });
    expect(ballot?.confirmedBy).toBeUndefined();
    expect(String(ballot?.id)).toMatch(/^ballot-d1-adj-chair-/);
  });

  it("refuses ballots from trainees and from adjudicators without a debate", async () => {
    expect((await POST(request(ballotBody("trainee")), params)).status).toBe(403);
    seed({ publicBallotForm: true }, { [`${T}/adjudicators/idle`]: { name: "Idle" } });
    expect((await POST(request(ballotBody("idle")), params)).status).toBe(404);
    expect(storedBallots()).toHaveLength(0);
  });

  it("refuses ballots until the round's motions are released", async () => {
    seed({ publicBallotForm: true }, { [`${T}/motions/m1`]: { text: "THW", rounds: ["r1"], released: false } });
    const response = await POST(request(ballotBody()), params);
    expect(response.status).toBe(409);
    expect(storedBallots()).toHaveLength(0);
  });

  it("validates ballots like private-URL submissions", async () => {
    const body = ballotBody();
    body.ballot.teamScores.OO = { rank: 1 };
    const response = await POST(request(body), params);
    expect(response.status).toBe(400);
    expect(storedBallots()).toHaveLength(0);
  });

  it("checks the tournament password against the stored hash and closes the form until one is set", async () => {
    seed({ publicBallotForm: true, publicFormsUsePassword: true });
    expect((await POST(request(ballotBody("chair", "letmein")), params)).status).toBe(403);

    seed(
      { publicBallotForm: true, publicFormsUsePassword: true },
      { [`${T}/serverOnly/publicForms`]: { password: hashPublicFormsPassword("letmein") } }
    );
    const wrong = await POST(request(ballotBody("chair", "nope")), params);
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ passwordRequired: true });
    expect(storedBallots()).toHaveLength(0);
    expect((await POST(request(ballotBody("chair", "letmein")), params)).status).toBe(200);
    expect(storedBallots()).toHaveLength(1);
  });

  it("lists feedback targets and stores feedback validated like private-URL feedback", async () => {
    const load = await POST(request({ action: "load", kind: "feedback", sourceType: "team", sourceId: "team-OG" }), params);
    expect(load.status).toBe(200);
    const loaded = await load.json() as { options: Array<{ targetType: string; targetId: string }> };
    // Default paths: teams rate the chair only.
    expect(loaded.options.filter((option) => option.targetType === "adjudicator").map((option) => option.targetId)).toEqual(["chair"]);

    const invalid = await POST(request({
      action: "submit", kind: "feedback", sourceType: "team", sourceId: "team-OG",
      feedback: { debateId: "d1", targetType: "adjudicator", targetId: "panel", score: 3 },
    }), params);
    expect(invalid.status).toBe(403);
    const outOfRange = await POST(request({
      action: "submit", kind: "feedback", sourceType: "team", sourceId: "team-OG",
      feedback: { debateId: "d1", targetType: "adjudicator", targetId: "chair", score: 9 },
    }), params);
    expect(outOfRange.status).toBe(400);

    const response = await POST(request({
      action: "submit", kind: "feedback", sourceType: "team", sourceId: "team-OG",
      feedback: { debateId: "d1", targetType: "adjudicator", targetId: "chair", score: 4, comments: "Clear" },
    }), params);
    expect(response.status).toBe(200);
    const stored = [...fake.store.entries()].filter(([path]) => path.startsWith(`${T}/feedback/`)).map(([, data]) => data);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      sourceType: "team", sourceId: "team-OG", targetAdjudicatorId: "chair", targetAdjudicatorName: "Chair", score: 4, roundId: "r1",
    });
  });

  it("rejects malformed requests", async () => {
    expect((await POST(request({ action: "submit", kind: "ballot", sourceType: "team", sourceId: "team-OG" }), params)).status).toBe(400);
    expect((await POST(request({ action: "drop", kind: "ballot", sourceType: "adjudicator", sourceId: "chair" }), params)).status).toBe(400);
  });
});
