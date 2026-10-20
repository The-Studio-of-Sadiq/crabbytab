import { describe, expect, it } from "vitest";
import type { Team } from "@/types";
import { assignSpeakerPrivateUrls, getSpeakerPrivatePath, removeSpeakerPrivateUrls, speakerUrlKeyIndex } from "./privateSpeakerUrls";
import { matchPrivateTeamCredential } from "./privateSpeakerAccess";
import { sanitizeAssistantTeam } from "./tournamentAccess";
import { resolveEmailRecipients } from "./email/messaging";

let counter = 0;
const generate = (prefix?: string) => `${prefix ? `${prefix}_` : ""}k${(counter += 1)}`;

const team = (id: string, extra: Partial<Team> = {}): Team => ({
  id,
  tournamentId: "t1",
  name: `Team ${id}`,
  privateUrlKey: `team_${id}`,
  privatePasscode: `pass_${id}`,
  speakers: [
    { id: `${id}-s1`, name: "Ann", email: "ann@example.com" },
    { id: `${id}-s2`, name: "Bo", email: "bo@example.com" },
  ],
  breakCategories: [],
  speakerCategories: [],
  ...extra,
});

describe("per-speaker private URLs", () => {
  it("gives speakers keys without touching the team URL, and indexes them", () => {
    const [updated] = assignSpeakerPrivateUrls([team("a")], generate);
    expect(updated.privateUrlKey).toBe("team_a");
    expect(updated.privatePasscode).toBe("pass_a");
    expect(updated.speakers.every((speaker) => speaker.privateUrlKey?.startsWith("spk_") && speaker.privatePasscode)).toBe(true);
    expect(updated.speakerUrlKeys).toEqual(speakerUrlKeyIndex(updated));
    // Nothing missing: nothing changes.
    expect(assignSpeakerPrivateUrls([updated], generate)).toEqual([]);
  });

  it("removes speaker URLs only", () => {
    const [withKeys] = assignSpeakerPrivateUrls([team("a")], generate);
    const [removed] = removeSpeakerPrivateUrls([withKeys]);
    expect(removed.privateUrlKey).toBe("team_a");
    expect(removed).not.toHaveProperty("speakerUrlKeys");
    expect(removed.speakers.some((speaker) => speaker.privateUrlKey)).toBe(false);
  });

  it("opens a team's portal with the team's or a speaker's own credentials only", () => {
    const [withKeys] = assignSpeakerPrivateUrls([team("a")], generate);
    const speaker = withKeys.speakers[0];
    expect(matchPrivateTeamCredential(withKeys, "team_a", "pass_a")).toEqual({});
    expect(matchPrivateTeamCredential(withKeys, speaker.privateUrlKey!, speaker.privatePasscode!)).toEqual({ speakerId: speaker.id });
    // A speaker key with the team passcode, another speaker's passcode, or a wrong one: refused.
    expect(matchPrivateTeamCredential(withKeys, speaker.privateUrlKey!, "pass_a")).toBeNull();
    expect(matchPrivateTeamCredential(withKeys, speaker.privateUrlKey!, withKeys.speakers[1].privatePasscode!)).toBeNull();
    expect(matchPrivateTeamCredential(withKeys, "spk_unknown", speaker.privatePasscode!)).toBeNull();
    // A key still in the index after its speaker was removed opens nothing.
    const without = { ...withKeys, speakers: withKeys.speakers.slice(1) };
    expect(matchPrivateTeamCredential(without, speaker.privateUrlKey!, speaker.privatePasscode!)).toBeNull();
  });

  it("keeps speaker credentials away from assistants", () => {
    const [withKeys] = assignSpeakerPrivateUrls([team("a")], generate);
    const safe = sanitizeAssistantTeam(withKeys);
    expect(safe).not.toHaveProperty("speakerUrlKeys");
    expect(safe.speakers[0]).not.toHaveProperty("privateUrlKey");
    expect(safe.speakers[0]).not.toHaveProperty("privatePasscode");
  });

  it("emails a speaker their own URL when they have one", () => {
    const [withKeys] = assignSpeakerPrivateUrls([team("a")], generate);
    const plain = team("b");
    const recipients = resolveEmailRecipients("all_teams", [withKeys, plain], [], [], undefined, {
      includePrivateCredentials: true,
      privateUrlOrigin: "https://tab.example",
      tournamentSlug: "open",
      preserveDuplicateEmails: true,
    });
    const ann = recipients.find((recipient) => recipient.teamId === "a" && recipient.name === "Ann")!;
    expect(ann.privateUrl).toBe(`https://tab.example${getSpeakerPrivatePath("open", withKeys.speakers[0].privateUrlKey!)}`);
    expect(ann.passcode).toBe(withKeys.speakers[0].privatePasscode);
    const plainAnn = recipients.find((recipient) => recipient.teamId === "b" && recipient.name === "Ann")!;
    expect(plainAnn.privateUrl).toBe("https://tab.example/open/private/team/team_b");
  });
});
