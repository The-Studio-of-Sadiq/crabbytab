import { describe, expect, it } from "vitest";
import { hashValue, stableStringify } from "@/lib/publicView/hash";
import type { PublicSourceData, SourceRecord } from "@/lib/publicView/projection";
import { buildPublicCheckinsSource, buildPublicProjection } from "@/lib/publicView/projection";
import {
  assembleProjection,
  buildPublicViewRoot,
  buildPublicViewSections,
  changedSections,
  chunkSectionJson,
  countCheckins,
  fingerprintPublicSource,
  parseSectionChunks,
  PUBLIC_VIEW_SECTIONS,
} from "@/lib/publicView/snapshot";

const tournament: SourceRecord = {
  id: "t1",
  name: "Test Open",
  shortName: "TO",
  slug: "test-open",
  format: "bp",
  ownerId: "owner-uid",
  ownerEmail: "owner@example.com",
  admins: { "owner-uid": true },
  preferences: { publicDraw: true, publicResults: true, publicMotions: true, publicCheckInStatus: true },
  updatedAt: "2026-10-18T10:00:00.000Z",
};

function source(overrides: Partial<PublicSourceData> = {}): PublicSourceData {
  return {
    rounds: [
      { id: "r1", seq: 1, name: "Round 1", drawStatus: "released", adjudicatorsRevealed: false, resultsReleased: true, teamSpeaksReleased: false },
      { id: "r2", seq: 2, name: "Round 2", drawStatus: "draft" },
    ],
    teams: [
      { id: "team-a", name: "Alpha", privateUrlKey: "secret", privatePasscode: "1234", speakers: [{ id: "s1", name: "Ann", email: "ann@example.com" }], checkedIn: true },
      { id: "team-b", name: "Beta", speakers: [], checkedIn: false },
      { id: "team-hidden", name: "Not drawn", speakers: [] },
    ],
    adjudicators: [{ id: "adj-1", name: "Judge", baseScore: 7, conflicts: [{ type: "institution" }], checkedIn: true }],
    debates: [
      {
        id: "d1",
        roundId: "r1",
        teams: { AFF: { teamId: "team-a", side: "AFF" }, NEG: { teamId: "team-b", side: "NEG" } },
        adjudicators: { chairId: "adj-1", chairName: "Judge", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
        resultStatus: "confirmed",
      },
      { id: "d2", roundId: "r2", teams: {}, adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] } },
    ],
    ballots: [
      {
        id: "b1",
        roundId: "r1",
        debateId: "d1",
        confirmed: true,
        speakerScores: { AFF: [{ speakerId: "s1", score: 75 }] },
        teamScores: { AFF: { side: "AFF", teamId: "team-a", points: 1, totalSpeakerScore: 150, win: true } },
      },
      { id: "b2", roundId: "r1", debateId: "d1", confirmed: false, teamScores: {} },
    ],
    motions: [
      { id: "m1", text: "THW test", released: true },
      { id: "m2", text: "Secret motion", released: false },
    ],
    breakCategories: [],
    institutions: [],
    venues: [],
    ...overrides,
  };
}

describe("buildPublicProjection", () => {
  it("removes private fields and unreleased data", () => {
    const projection = buildPublicProjection(tournament, source());
    expect(projection.tournament).not.toHaveProperty("ownerEmail");
    expect(projection.tournament.ownerId).toBe("");
    expect(projection.collections.rounds.map((round) => round.id)).toEqual(["r1"]);
    expect(projection.collections.debates.map((debate) => debate.id)).toEqual(["d1"]);
    expect(projection.collections.teams.map((team) => team.id)).toEqual(["team-a", "team-b"]);
    const alpha = projection.collections.teams[0];
    expect(alpha).not.toHaveProperty("privateUrlKey");
    expect(alpha).not.toHaveProperty("privatePasscode");
    expect(alpha.speakers).toEqual([{ id: "s1", name: "Ann" }]);
    expect(projection.collections.motions.map((motion) => motion.id)).toEqual(["m1"]);
  });

  it("hides unrevealed panels and unreleased speaker scores", () => {
    const projection = buildPublicProjection(tournament, source());
    expect(projection.collections.debates[0].adjudicators).toEqual({
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
    });
    expect(projection.collections.adjudicators).toEqual([]);
    expect(projection.collections.ballots.map((ballot) => ballot.id)).toEqual(["b1"]);
    expect(projection.collections.ballots[0].speakerScores).toEqual({});
    expect(projection.collections.ballots[0].teamScores).toEqual({
      AFF: { side: "AFF", teamId: "team-a", points: 1, win: true },
    });
  });

  it("ignores soft-deleted records", () => {
    const data = source();
    data.debates[0] = { ...data.debates[0], deletedAt: "2026-10-18T00:00:00.000Z" };
    expect(buildPublicProjection(tournament, data).collections.debates).toEqual([]);
  });
});

describe("participant lists", () => {
  const withLists = (preferences: Record<string, unknown>): SourceRecord => ({
    ...tournament,
    preferences: { ...(tournament.preferences as Record<string, unknown>), ...preferences },
  });
  const listSource = () =>
    source({
      adjudicators: [
        { id: "adj-1", name: "Judge", baseScore: 7, email: "j@example.com", privateUrlKey: "k", conflicts: [{ type: "institution" }] },
        { id: "adj-core", name: "Core", baseScore: 9, testScore: 8, adjCore: true, breaking: true, conflicts: [] },
        { id: "adj-break", name: "Breaker", baseScore: 8, breaking: true, conflicts: [] },
      ],
    });

  it("keeps undrawn teams, unrevealed adjudicators and the core / breaking flags hidden by default", () => {
    const projection = buildPublicProjection(tournament, listSource());
    expect(projection.collections.teams.map((team) => team.id)).toEqual(["team-a", "team-b"]);
    expect(projection.collections.adjudicators).toEqual([]);
    expect(stableStringify(projection)).not.toContain("adjCore");
    expect(stableStringify(projection)).not.toContain("breaking\":true");
  });

  it("lists every team and adjudicator when participants are released, without private fields", () => {
    const projection = buildPublicProjection(withLists({ publicParticipants: true }), listSource());
    expect(projection.collections.teams.map((team) => team.id)).toEqual(["team-a", "team-b", "team-hidden"]);
    expect(projection.collections.adjudicators.map((adjudicator) => adjudicator.id)).toEqual([
      "adj-1",
      "adj-core",
      "adj-break",
    ]);
    const json = stableStringify(projection.collections.adjudicators);
    for (const secret of ["email", "privateUrlKey", "baseScore", "testScore", "conflicts", "adjCore", "breaking"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("exposes only the released list's members and flag", () => {
    const core = buildPublicProjection(withLists({ publicAdjudicatorCore: true }), listSource());
    expect(core.collections.adjudicators).toEqual([
      { id: "adj-core", name: "Core", adjCore: true },
    ]);
    const breaking = buildPublicProjection(withLists({ publicBreakingAdjudicators: true }), listSource());
    expect(breaking.collections.adjudicators).toEqual([
      { id: "adj-core", name: "Core", breaking: true },
      { id: "adj-break", name: "Breaker", breaking: true },
    ]);
  });

  it("does not reveal break results through the participants list", () => {
    const data = source({
      teams: [
        { id: "team-a", name: "Alpha", speakers: [], breakStatus: "breaking", breakCategoryIds: ["open"] },
        { id: "team-hidden", name: "Not drawn", speakers: [], breakStatus: "eliminated" },
      ],
    });
    const projection = buildPublicProjection(withLists({ publicParticipants: true }), data);
    for (const team of projection.collections.teams) {
      expect(team).not.toHaveProperty("breakStatus");
      expect(team).not.toHaveProperty("breakCategoryIds");
    }
  });
});

describe("check-in source", () => {
  it("stores no identities and counts availability (unset check-in counts as available)", () => {
    const checkins = buildPublicCheckinsSource(tournament, source());
    expect(stableStringify(checkins)).not.toContain("team-a");
    expect(stableStringify(checkins)).not.toContain("Alpha");
    expect(countCheckins(checkins, Date.now())).toEqual([
      { id: "r1", name: "Round 1", teamsPresent: 2, teamsTotal: 3, adjudicatorsPresent: 1, adjudicatorsTotal: 1 },
      { id: "r2", name: "Round 2", teamsPresent: 2, teamsTotal: 3, adjudicatorsPresent: 1, adjudicatorsTotal: 1 },
    ]);
  });

  it("keeps no availability data when public counts are disabled", () => {
    const checkins = buildPublicCheckinsSource(
      { ...tournament, preferences: { publicCheckInStatus: false } },
      source()
    );
    expect(checkins).toMatchObject({ enabled: false, rounds: [], teams: [], adjudicators: [] });
  });
});

describe("fingerprints", () => {
  it("ignore private-only and updatedAt changes", () => {
    const base = fingerprintPublicSource(tournament, source());
    const data = source();
    data.teams[0] = { ...data.teams[0], privatePasscode: "9999" };
    data.adjudicators[0] = { ...data.adjudicators[0], baseScore: 9 };
    expect(fingerprintPublicSource({ ...tournament, updatedAt: "2026-10-19T00:00:00.000Z" }, data)).toBe(base);
  });

  it("change when something public changes", () => {
    const base = fingerprintPublicSource(tournament, source());
    const data = source();
    data.rounds[1] = { ...data.rounds[1], drawStatus: "released" };
    expect(fingerprintPublicSource(tournament, data)).not.toBe(base);
  });

  it("do not depend on key order", () => {
    expect(hashValue({ a: 1, b: { c: 2, d: 3 } })).toBe(hashValue({ b: { d: 3, c: 2 }, a: 1 }));
  });
});

describe("chunking and roots", () => {
  it("round-trips sections that exceed the chunk size, including multi-byte text", () => {
    const value = { items: Array.from({ length: 200 }, (_, index) => ({ index, text: "débat 🎤 ".repeat(20) })) };
    const chunks = chunkSectionJson(value, 2_000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(2_000);
    expect(parseSectionChunks(chunks)).toEqual(value);
  });

  it("reports only changed sections and reassembles the projection", () => {
    const first = buildPublicViewRoot({
      tournamentId: "t1",
      slug: "test-open",
      sections: buildPublicViewSections(tournament, source()),
      publishedAt: "2026-10-18T10:00:00.000Z",
    });
    expect(changedSections(null, first.root)).toEqual([...PUBLIC_VIEW_SECTIONS]);

    const data = source();
    data.motions[1] = { ...data.motions[1], released: true };
    const second = buildPublicViewRoot({
      tournamentId: "t1",
      slug: "test-open",
      sections: buildPublicViewSections(tournament, data),
      publishedAt: "2026-10-18T11:00:00.000Z",
    });
    expect(changedSections(first.root, second.root)).toEqual(["motions"]);
    expect(second.root.version).not.toBe(first.root.version);

    const sections = Object.fromEntries(
      PUBLIC_VIEW_SECTIONS.map((section) => [section, parseSectionChunks(second.chunks[section])])
    );
    expect(assembleProjection(sections)).toEqual(buildPublicProjection(tournament, data));
  });
});

describe("tournament-level releases", () => {
  const released = (preferences: Record<string, unknown>) => ({
    ...tournament,
    preferences: { ...(tournament.preferences as Record<string, unknown>), ...preferences },
  });

  it("exposes silent completed preliminary rounds only once a tab is released", () => {
    const data = source();
    data.rounds = [{ id: "r1", seq: 1, name: "Round 1", stage: "preliminary", completed: true, silent: true, drawStatus: "released", resultsReleased: false }];
    expect(buildPublicProjection(tournament, data).collections.ballots).toEqual([]);
    const projection = buildPublicProjection(released({ releaseTeamTab: true }), data);
    expect(projection.collections.ballots.map((ballot) => ballot.id)).toEqual(["b1"]);
    expect(projection.collections.ballots[0].speakerScores).not.toEqual({});
  });

  it("hides break results until the category is released", () => {
    const data = source();
    data.breakCategories = [{ id: "open", name: "Open", generatedBreak: { breakingTeamIds: ["team-hidden"] } }];
    data.teams[2] = { ...data.teams[2], breakStatus: "breaking", breakCategoryIds: ["open"] };
    const hidden = buildPublicProjection(tournament, data);
    expect(hidden.collections.teams.map((team) => team.id)).not.toContain("team-hidden");
    expect(hidden.collections.breakCategories[0]).not.toHaveProperty("generatedBreak");

    const shown = buildPublicProjection(released({ releasedBreakCategoryIds: ["open"] }), data);
    expect(shown.collections.teams.find((team) => team.id === "team-hidden")).toMatchObject({ breakStatus: "breaking" });
    expect(shown.collections.breakCategories[0]).toHaveProperty("generatedBreak");
  });
});
