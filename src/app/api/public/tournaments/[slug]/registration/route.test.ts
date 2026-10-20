import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createFakeAdminFirestore, type FakeAdminFirestore } from "@/test/fakeAdminFirestore";
import { defaultRegistrationSettings } from "@/lib/registration/validation";
import { issueRepresentative } from "@/lib/registration/service";
import { issueTeamInvitation } from "@/lib/registration/teamInvitations";

let fake: FakeAdminFirestore;
vi.mock("@/lib/firebaseAdmin", () => ({ getAdminFirestore: () => fake.firestore }));
vi.mock("@/lib/email/templatedEmail", () => ({ sendTemplatedEmail: async () => ({ delivered: false }) }));

import { POST } from "./route";

const T = "tournaments/t1";
const params = { params: Promise.resolve({ slug: "open" }) };
let teamToken = "";
let representativeToken = "";

function request(body: unknown): NextRequest {
  const text = JSON.stringify(body);
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
    body: text,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  const representative = issueRepresentative(
    { institution: { name: "Oxford", key: "oxford" }, email: "coach@example.com", name: "Coach" },
    { tournamentId: "t1", actorUid: "owner", now: Date.now() }
  );
  const invitation = issueTeamInvitation("t1", { id: "alpha", name: "Alpha" }, "owner", new Date().toISOString());
  teamToken = invitation.token;
  representativeToken = representative.token;
  fake = createFakeAdminFirestore({
    "tournamentSlugs/open": { tournamentId: "t1" },
    [T]: { name: "Open", slug: "open" },
    [`${T}/serverOnly/registration`]: {
      ...defaultRegistrationSettings("Open", 2), enabled: true, teamRegistration: true, maxSpeakers: 3,
    },
    [`${T}/serverOnly/registration/teamInvitations/alpha`]: invitation.record as unknown as Record<string, unknown>,
    [`${T}/serverOnly/registration/representatives/${representative.record.id}`]: representative.record as unknown as Record<string, unknown>,
    [`${T}/serverOnly/registration/submissions/s1`]: {
      id: "s1", kind: "team", status: "approved", representativeId: representative.record.id,
      institution: { name: "Oxford", key: "oxford" }, contactName: "Private", contactEmail: "private@example.com",
      submittedAt: "2026-10-01T00:00:00Z", team: { name: "Oxford A", speakers: [{ name: "Ann", categories: [] }] },
    },
    [`${T}/teams/alpha`]: { name: "Alpha", speakers: [{ id: "s1", name: "Ann" }] },
  });
});

describe("public registration: team invitations and the coach view", () => {
  it("joins the invited team through the route, with the spam checks", async () => {
    const startedAt = Date.now() - 10_000;
    const bot = await POST(request({ action: "joinTeam", token: teamToken, speaker: { name: "Bot" }, website: "spam", startedAt }), params);
    expect(await bot.json()).toEqual({ received: true });
    const response = await POST(request({ action: "joinTeam", token: teamToken, speaker: { name: "Bo" }, startedAt }), params);
    expect(response.status).toBe(200);
    expect(fake.store.get(`${T}/teams/alpha`)!.speakers).toHaveLength(2);
  });

  it("refuses a representative link as a team invitation", async () => {
    const response = await POST(request({
      action: "joinTeam", token: representativeToken, speaker: { name: "Bo" }, startedAt: Date.now() - 10_000,
    }), params);
    expect(response.status).toBe(404);
    expect(fake.store.get(`${T}/teams/alpha`)!.speakers).toHaveLength(1);
  });

  it("shows a representative their institution's response without contact details", async () => {
    const response = await POST(request({ action: "representative", token: representativeToken }), params);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.representative.response).toEqual([
      expect.objectContaining({ id: "s1", name: "Oxford A", status: "approved", speakers: ["Ann"] }),
    ]);
    expect(JSON.stringify(body)).not.toContain("private@example.com");
  });
});
