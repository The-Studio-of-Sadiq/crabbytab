import { describe, expect, it } from "vitest";
import type { Motion } from "@/types";
import { buildPublicProjection, type PublicSourceData, type SourceRecord } from "@/lib/publicView/projection";
import { buildMotionRevealSteps, motionsForDisplay } from "@/lib/display";

const tournament = (preferences: Record<string, unknown>): SourceRecord => ({
  id: "t1",
  name: "Cup",
  slug: "cup",
  format: "wsdc",
  ownerId: "owner",
  preferences: { publicDraw: true, publicMotions: true, ...preferences },
});

function source(overrides: Partial<PublicSourceData> = {}): PublicSourceData {
  return {
    rounds: [
      { id: "r1", seq: 1, name: "Round 1", drawStatus: "released", motionsReleased: true, startsAt: "2026-10-21T09:00:00.000Z", scheduleGroup: 1 },
      { id: "r2", seq: 2, name: "Round 2", drawStatus: "released", motionsStatus: "info_slides_released", motionsReleased: false },
      { id: "r3", seq: 3, name: "Round 3", drawStatus: "none" },
    ],
    teams: [],
    adjudicators: [],
    debates: [],
    ballots: [],
    motions: [
      { id: "m1", text: "THW one", reference: "One", released: true, rounds: ["r1"], roundSeq: { r1: 1 } },
      { id: "m2", text: "Secret two", reference: "Hint", infoSlide: "Context for two", released: false, rounds: ["r2", "r3"], roundSeq: { r2: 2, r3: 1 } },
      { id: "m3", text: "Secret three", released: false, rounds: ["r2"] },
      { id: "m4", text: "Secret four", infoSlide: "Not out", released: false, rounds: ["r3"] },
    ],
    breakCategories: [],
    institutions: [],
    venues: [],
    ...overrides,
  };
}

describe("public projection: rounds, motions and schedule", () => {
  it("carries round start times, slots and the motions status", () => {
    const projection = buildPublicProjection(tournament({}), source());
    const rounds = projection.collections.rounds;
    expect(rounds.map((round) => [round.id, round.motionsStatus, round.startsAt, round.scheduleGroup])).toEqual([
      ["r1", "motions_released", "2026-10-21T09:00:00.000Z", 1],
      ["r2", "info_slides_released", undefined, undefined],
    ]);
    const hidden = buildPublicProjection(tournament({ publicMotions: false }), source());
    expect(hidden.collections.rounds.map((round) => round.motionsStatus)).toEqual(["not_released", "not_released"]);
    expect(hidden.collections.motions).toEqual([]);
  });

  it("exposes only the info slides of an info-slides round, never the motion text or reference", () => {
    const motions = buildPublicProjection(tournament({}), source()).collections.motions;
    expect(motions.map((motion) => motion.id)).toEqual(["m1", "m2"]);
    expect(motions[1]).toEqual({ id: "m2", tournamentId: undefined, text: "", infoSlide: "Context for two", rounds: ["r2"], roundSeq: { r2: 2 }, released: false });
    expect(JSON.stringify(motions)).not.toContain("Secret");
    expect(JSON.stringify(motions)).not.toContain("Not out");
  });

  it("publishes the schedule only when it is public, with titles resolved", () => {
    const events = [{ id: "e1", type: "debate", roundId: "r3", startTime: "2026-10-21T13:00:00.000Z" }];
    const hidden = buildPublicProjection(tournament({ scheduleEvents: events }), source());
    expect(hidden.tournament.preferences).not.toHaveProperty("scheduleEvents");
    const shown = buildPublicProjection(tournament({ scheduleEvents: events, publicSchedule: true }), source());
    expect(shown.tournament.preferences.scheduleEvents).toEqual([
      { id: "e1", type: "debate", title: "Round 3 — Debate", roundId: "r3", startTime: "2026-10-21T13:00:00.000Z" },
    ]);
  });
});

describe("projector motion reveal", () => {
  const motions = [
    { id: "a", tournamentId: "t1", text: "", infoSlide: "Slide A", rounds: ["r2"], roundSeq: { r2: 2 }, released: false },
    { id: "b", tournamentId: "t1", text: "", infoSlide: "Slide B", rounds: ["r2"], roundSeq: { r2: 1 }, released: false },
    { id: "c", tournamentId: "t1", text: "", rounds: ["r2"], released: false },
  ] as Motion[];

  it("shows viewers only the info slides while the motions are held back, in round order", () => {
    const visible = motionsForDisplay(motions, "r2", false, "info_slides_released");
    expect(visible.map((motion) => motion.id)).toEqual(["a", "b"]);
    const steps = buildMotionRevealSteps(visible, { roundId: "r2", infoSlidesOnly: true });
    expect(steps.map((step) => (step.kind === "cover" ? "cover" : `${step.kind}:${step.motion.id}`))).toEqual(["cover", "info:b", "info:a"]);
    expect(motionsForDisplay(motions, "r2", false, "not_released")).toEqual([]);
  });
});
