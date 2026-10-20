import { describe, expect, it } from "vitest";
import type { Round } from "@/types";
import { makeRound } from "@/test/tournamentFixtures";
import {
  currentDrawRoundId,
  currentDrawRoundIds,
  explicitCurrentRound,
  isRoundDrawPublic,
  portalCurrentRound,
  sharedViewCurrentRound,
} from "./publicFeatures";

const T = "t-current";
const round = (seq: number, overrides: Partial<Round> = {}) => makeRound(T, seq, overrides);

const r1 = round(1, { drawStatus: "confirmed", completed: true });
const r2a = round(2, { drawStatus: "confirmed", scheduleGroup: 2 });
const r2b = round(3, { drawStatus: "draft", scheduleGroup: 2 });
const r4 = round(4, { drawStatus: "none" });
const rounds = [r1, r2a, r2b, r4];

describe("explicit current round", () => {
  it("is absent unless it names a live round", () => {
    expect(explicitCurrentRound(rounds, undefined)).toBeUndefined();
    expect(explicitCurrentRound(rounds, "")).toBeUndefined();
    expect(explicitCurrentRound(rounds, "deleted-round")).toBeUndefined();
    expect(explicitCurrentRound([{ ...r1, cancelled: true }], r1.id)).toBeUndefined();
    expect(explicitCurrentRound(rounds, r1.id)?.id).toBe(r1.id);
  });

  it("without one, the current round is derived as before: the latest publicly released draw", () => {
    expect(currentDrawRoundId(rounds)).toBe(r2a.id);
    expect(currentDrawRoundIds(rounds)).toEqual(new Set([r2a.id]));
    // A locked or teams-only draw is not "released" for the derivation.
    expect(currentDrawRoundId([r1, round(2, { drawStatus: "teams_released" })])).toBe(r1.id);
    expect(currentDrawRoundId([r1, round(2, { drawStatus: "locked" })])).toBe(r1.id);
  });

  it("an explicit current round replaces the derivation and brings its concurrent rounds", () => {
    expect(currentDrawRoundId(rounds, r1.id)).toBe(r1.id);
    expect(currentDrawRoundIds(rounds, r1.id)).toEqual(new Set([r1.id]));
    expect(currentDrawRoundIds(rounds, r2b.id)).toEqual(new Set([r2a.id, r2b.id]));
    // A stale value falls back to the derivation.
    expect(currentDrawRoundIds(rounds, "gone")).toEqual(new Set([r2a.id]));
  });
});

describe("public draw gating with the current round", () => {
  it("never shows a draw that is not fully released, whatever the current round", () => {
    const current = currentDrawRoundIds(rounds, r2b.id);
    expect(isRoundDrawPublic(r2a, "current", current)).toBe(true);
    expect(isRoundDrawPublic(r2b, "current", current)).toBe(false);
    expect(isRoundDrawPublic(r1, "current", current)).toBe(false);
    expect(isRoundDrawPublic(r1, "all", current)).toBe(true);
    expect(isRoundDrawPublic(round(5, { drawStatus: "teams_released" }), "all", undefined)).toBe(false);
    expect(isRoundDrawPublic(round(5, { drawStatus: "locked" }), "all", undefined)).toBe(false);
    expect(isRoundDrawPublic(r2a, "off", current)).toBe(false);
  });

  it("accepts the single round id used before (compatibility)", () => {
    expect(isRoundDrawPublic(r2a, "current", r2a.id)).toBe(true);
    expect(isRoundDrawPublic(r1, "current", r2a.id)).toBe(false);
  });
});

describe("the round shared views and portals open on", () => {
  it("public pages open on the explicit current round when they can see it", () => {
    expect(sharedViewCurrentRound(rounds)?.id).toBe(r2a.id);
    expect(sharedViewCurrentRound(rounds, r1.id)?.id).toBe(r1.id);
    // The projection only carries visible rounds, so an unseen explicit round falls back.
    expect(sharedViewCurrentRound([r1], r2b.id)?.id).toBe(r1.id);
  });

  it("portals open on the explicit current round among their own rounds, else their latest", () => {
    expect(portalCurrentRound([r1, r2a])?.id).toBe(r2a.id);
    expect(portalCurrentRound([r1, r2a], r1.id)?.id).toBe(r1.id);
    expect(portalCurrentRound([r1], r2a.id)?.id).toBe(r1.id);
  });
});
