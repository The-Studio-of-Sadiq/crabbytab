import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createFakeAdminFirestore, type FakeAdminFirestore } from "@/test/fakeAdminFirestore";

let fake: FakeAdminFirestore;
vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => fake.firestore,
}));

import { POST } from "./route";

const T = "tournaments/t1";

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/private/team", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  fake = createFakeAdminFirestore({
    [T]: { name: "Open", slug: "open", format: "wsdc", preferences: {} },
    [`${T}/teams/alpha`]: {
      name: "Alpha",
      privateUrlKey: "team_alpha",
      privatePasscode: "team-pass",
      speakerUrlKeys: ["spk_ann"],
      speakers: [
        { id: "ann", name: "Ann", privateUrlKey: "spk_ann", privatePasscode: "ann-pass", email: "ann@example.com" },
        { id: "bo", name: "Bo" },
      ],
    },
    [`${T}/teams/beta`]: { name: "Beta", privateUrlKey: "team_beta", privatePasscode: "beta-pass", speakers: [] },
  });
});

describe("POST /api/private/team with speaker URLs", () => {
  it("keeps the team URL and passcode working", async () => {
    const response = await POST(request({ tournamentId: "t1", privateUrlKey: "team_alpha", passcode: "team-pass" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.team.id).toBe("alpha");
    expect(body.team.speakerId).toBeUndefined();
  });

  it("opens the speaker's own team with the speaker's key and passcode, without leaking credentials", async () => {
    const response = await POST(request({ tournamentId: "t1", privateUrlKey: "spk_ann", passcode: "ann-pass" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.team.id).toBe("alpha");
    expect(body.team.speakerId).toBe("ann");
    expect(JSON.stringify(body)).not.toContain("ann-pass");
    expect(JSON.stringify(body)).not.toContain("team-pass");
    expect(JSON.stringify(body)).not.toContain("ann@example.com");
  });

  it("refuses a speaker key with the team passcode or another team's passcode", async () => {
    for (const passcode of ["team-pass", "beta-pass", "wrong"]) {
      const response = await POST(request({ tournamentId: "t1", privateUrlKey: "spk_ann", passcode }));
      expect(response.status).toBe(403);
    }
  });
});
