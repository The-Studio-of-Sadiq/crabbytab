import { describe, expect, it } from "vitest";
import { stableStringify } from "@/lib/publicView/hash";
import { buildPublicCheckinsSource, type PublicSourceData, type SourceRecord } from "@/lib/publicView/projection";
import { countCheckins, listCheckins } from "@/lib/publicView/snapshot";

const tournament = (preferences: Record<string, unknown>): SourceRecord => ({
  id: "t1",
  name: "Test Open",
  slug: "test-open",
  format: "bp",
  preferences: { publicCheckInStatus: true, ...preferences },
});

const source: Pick<PublicSourceData, "rounds" | "teams" | "adjudicators"> = {
  rounds: [{ id: "r1", seq: 1, name: "Round 1" }, { id: "r2", seq: 2, name: "Round 2" }],
  teams: [
    { id: "team-a", name: "Alpha", codeName: "Fox", speakers: [], checkedIn: true, privateUrlKey: "secret" },
    { id: "team-b", name: "Beta", speakers: [], roundAvailability: { r2: false } },
  ],
  adjudicators: [
    { id: "adj-1", name: "Judge", checkedIn: true, email: "judge@example.com" },
    { id: "adj-2", name: "Hidden Judge", anonymous: true, checkedIn: true },
  ],
};

describe("public per-person check-in status", () => {
  it("lists nobody unless the participants list is public too", () => {
    const checkins = buildPublicCheckinsSource(tournament({}), source);
    expect(checkins.people).toBeUndefined();
    expect(stableStringify(checkins)).not.toContain("Alpha");
    expect(listCheckins(checkins, Date.now())).toEqual({ teams: [], adjudicators: [] });
  });

  it("lists teams and adjudicators by public name with their status per round", () => {
    const checkins = buildPublicCheckinsSource(tournament({ publicParticipants: true }), source);
    const text = stableStringify(checkins);
    expect(text).not.toContain("team-a");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("judge@example.com");
    // Anonymous adjudicators are left out of the list (still counted).
    expect(text).not.toContain("Hidden Judge");
    expect(listCheckins(checkins, Date.now())).toEqual({
      teams: [
        { name: "Alpha", present: { r1: true, r2: true } },
        { name: "Beta", present: { r1: true, r2: false } },
      ],
      adjudicators: [{ name: "Judge", present: { r1: true, r2: true } }],
    });
    expect(countCheckins(checkins, Date.now())[0]).toMatchObject({ adjudicatorsTotal: 2, teamsTotal: 2 });
  });

  it("uses team code names when they are on", () => {
    const checkins = buildPublicCheckinsSource(tournament({ publicParticipants: true, teamCodeNames: "everywhere" }), source);
    expect(checkins.people?.teams.map((team) => team.name)).toEqual(["", "Fox"]);
    expect(stableStringify(checkins)).not.toContain("Alpha");
  });

  it("stores nothing when public check-in status is off", () => {
    const checkins = buildPublicCheckinsSource(tournament({ publicCheckInStatus: false, publicParticipants: true }), source);
    expect(checkins.people).toBeUndefined();
    expect(checkins.teams).toEqual([]);
  });
});
