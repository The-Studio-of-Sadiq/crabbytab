import { describe, expect, it } from "vitest";

import {
  isDataEntryRole,
  isTournamentAdministrator,
  resolveTournamentAccessRole,
  sanitizeAssistantAdjudicator,
  sanitizeAssistantTeam,
} from "./tournamentAccess";

describe("tournament staff roles", () => {
  const tournament = {
    ownerId: "owner-1",
    admins: { "admin-1": true },
  };

  it("recognizes tournament owners and existing admins as administrators", () => {
    expect(isTournamentAdministrator(tournament, "owner-1")).toBe(true);
    expect(isTournamentAdministrator(tournament, "admin-1")).toBe(true);
    expect(isTournamentAdministrator(tournament, "assistant-1")).toBe(false);
  });

  it("recognizes only assigned data-entry assistants", () => {
    expect(isDataEntryRole("dataEntry")).toBe(true);
    expect(isDataEntryRole("admin")).toBe(false);
    expect(isDataEntryRole(null)).toBe(false);
  });

  it("resolves tournament-scoped admin and data-entry access without global access", () => {
    expect(resolveTournamentAccessRole(tournament, "owner-1", null, false)).toBe("admin");
    expect(resolveTournamentAccessRole(tournament, "staff-admin", "admin", false)).toBe("admin");
    expect(resolveTournamentAccessRole(tournament, "assistant", "dataEntry", false)).toBe("dataEntry");
    expect(resolveTournamentAccessRole(tournament, "unassigned", null, false)).toBeNull();
    expect(resolveTournamentAccessRole(null, "global", null, true)).toBe("admin");
  });

  it("removes private participant portal and adjudicator conflict data", () => {
    const team = sanitizeAssistantTeam({
      id: "team-1",
      tournamentId: "tournament-1",
      name: "Team",
      speakers: [{ id: "speaker-1", name: "Speaker", email: "private@example.com" }],
      breakCategories: [],
      speakerCategories: [],
      privateUrlKey: "private-key",
      privatePasscode: "private-code",
    });
    const adjudicator = sanitizeAssistantAdjudicator({
      id: "adj-1",
      tournamentId: "tournament-1",
      name: "Judge",
      baseScore: 5,
      trainee: false,
      independent: false,
      conflicts: [{ type: "personal", teamId: "team-1" }],
      privateUrlKey: "private-key",
      privatePasscode: "private-code",
    });

    expect(team).not.toHaveProperty("privateUrlKey");
    expect(team).not.toHaveProperty("privatePasscode");
    expect(team.speakers[0]).not.toHaveProperty("email");
    expect(adjudicator).not.toHaveProperty("privateUrlKey");
    expect(adjudicator).not.toHaveProperty("privatePasscode");
    expect(adjudicator.conflicts).toEqual([]);
  });
});