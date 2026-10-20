import { beforeEach, describe, expect, it } from "vitest";
import type { DocumentReference } from "firebase-admin/firestore";
import { createFakeAdminFirestore, type FakeAdminFirestore } from "@/test/fakeAdminFirestore";
import { defaultRegistrationSettings } from "./validation";
import {
  describeTeamInvitation,
  issueTeamInvitation,
  joinTeamByInvitation,
  teamInvitationsRef,
} from "./teamInvitations";

const T = "tournaments/t1";
const now = Date.parse("2026-10-21T10:00:00Z");
let fake: FakeAdminFirestore;
let tournamentRef: DocumentReference;
let token: string;

function seed(settings: Record<string, unknown> = {}) {
  fake = createFakeAdminFirestore({
    [T]: { name: "Open", slug: "open" },
    [`${T}/serverOnly/registration`]: {
      ...defaultRegistrationSettings("Open", 2),
      enabled: true,
      teamRegistration: true,
      maxSpeakers: 3,
      speakerCategories: ["ESL"],
      ...settings,
    },
    [`${T}/teams/alpha`]: { name: "Alpha", syncVersion: 4, speakers: [{ id: "s1", name: "Ann", email: "ann@example.com" }] },
    [`${T}/teams/beta`]: { name: "Beta", speakers: [] },
  });
  tournamentRef = fake.firestore.collection("tournaments").doc("t1") as unknown as DocumentReference;
  const issued = issueTeamInvitation("t1", { id: "alpha", name: "Alpha" }, "owner", "2026-10-20T00:00:00Z");
  fake.store.set(`${T}/serverOnly/registration/teamInvitations/alpha`, issued.record as unknown as Record<string, unknown>);
  token = issued.token;
}

const join = (speaker: unknown, withToken = token) =>
  joinTeamByInvitation({ firestore: fake.firestore, tournamentRef, token: withToken, speaker, now });

describe("team invitations", () => {
  beforeEach(() => seed());

  it("adds a validated speaker to the invitation's team only, bumping its version", async () => {
    const result = await join({ name: "Bo", email: "BO@example.com", categories: ["ESL"] });
    expect(result.teamName).toBe("Alpha");
    const team = fake.store.get(`${T}/teams/alpha`)!;
    expect(team.speakers).toHaveLength(2);
    expect((team.speakers as Array<Record<string, unknown>>)[1]).toMatchObject({ name: "Bo", email: "bo@example.com", categories: ["ESL"] });
    expect(team.syncVersion).toBe(5);
    expect(fake.store.get(`${T}/teams/beta`)!.speakers).toEqual([]);
    expect(fake.store.get(`${T}/serverOnly/registration/teamInvitations/alpha`)!.joined).toBe(1);
  });

  it("describes the team without exposing its speakers", async () => {
    const view = await describeTeamInvitation(tournamentRef, token, now);
    expect(view).toMatchObject({ teamName: "Alpha", speakers: 1, maxSpeakers: 3, speakerCategories: ["ESL"] });
    expect(JSON.stringify(view)).not.toContain("Ann");
  });

  it("refuses forged, withdrawn and other tournaments' links", async () => {
    await expect(join({ name: "Bo" }, `${token.slice(0, -2)}xx`)).rejects.toThrow(/not valid/);
    await expect(join({ name: "Bo" }, token.replace("t1.", "t2."))).rejects.toThrow(/not valid/);
    await teamInvitationsRef(tournamentRef).doc("alpha").update({ status: "revoked" });
    await expect(join({ name: "Bo" })).rejects.toThrow(/withdrawn/);
    expect(fake.store.get(`${T}/teams/alpha`)!.speakers).toHaveLength(1);
  });

  it("applies the registration validation, window and team size", async () => {
    await expect(join({ name: "" })).rejects.toThrow();
    await expect(join({ name: "Bo", categories: ["Novice"] })).rejects.toThrow(/categories/);
    await expect(join({ name: "ann" })).rejects.toThrow(/already on this team/);
    await expect(join({ name: "Cy", email: "ann@example.com" })).rejects.toThrow(/email/);
    await join({ name: "Bo" });
    await join({ name: "Cy" });
    await expect(join({ name: "Di" })).rejects.toThrow(/most allowed/);

    seed({ closesAt: "2026-10-01T00:00:00Z" });
    await expect(join({ name: "Bo" })).rejects.toThrow(/closed/);
    seed({ teamRegistration: false });
    await expect(join({ name: "Bo" })).rejects.toThrow(/not taking team registrations/);
  });
});
