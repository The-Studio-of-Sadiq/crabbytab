import { describe, expect, it } from "vitest";
import type { Round } from "@/types";
import { makeRound } from "@/test/tournamentFixtures";
import { projectorRounds } from "./display";

const T = "t-projector";
const round = (seq: number, overrides: Partial<Round> & { drawPublic?: boolean } = {}) =>
  makeRound(T, seq, overrides) as Round & { drawPublic?: boolean };

const r1 = round(1, { drawStatus: "confirmed" });
const a = round(2, { scheduleGroup: 2, drawStatus: "confirmed", name: "Round 2 (A)" });
const b = round(3, { scheduleGroup: 2, drawStatus: "teams_released", name: "Round 2 (B)" });
const c = round(4, { scheduleGroup: 2, drawStatus: "confirmed", name: "Round 2 (C)" });
const cancelled = round(5, { scheduleGroup: 2, drawStatus: "confirmed", cancelled: true });
const elimination = round(6, { scheduleGroup: 2, stage: "elimination", drawStatus: "confirmed" });
const rounds = [r1, a, b, c, cancelled, elimination];

describe("projector rounds (concurrent rounds)", () => {
  it("shows staff every live round of the active round's slot and stage, by sequence", () => {
    const shown = projectorRounds(b, rounds, { staff: true, legacyPublicDraw: true, concurrent: true });
    expect(shown.map((item) => item.id)).toEqual([a.id, b.id, c.id]);
  });

  it("shows only the active round when narrowed, or when it has no concurrent rounds", () => {
    expect(projectorRounds(b, rounds, { staff: true, legacyPublicDraw: true, concurrent: false }).map((item) => item.id))
      .toEqual([b.id]);
    expect(projectorRounds(r1, rounds, { staff: true, legacyPublicDraw: true, concurrent: true }).map((item) => item.id))
      .toEqual([r1.id]);
    expect(projectorRounds(null, rounds, { staff: true, legacyPublicDraw: true, concurrent: true })).toEqual([]);
  });

  it("shows the public only fully released draws (a teams-only release stays off the projector)", () => {
    const shown = projectorRounds(a, rounds, { staff: false, legacyPublicDraw: true, concurrent: true });
    expect(shown.map((item) => item.id)).toEqual([a.id, c.id]);
    expect(projectorRounds(a, rounds, { staff: false, legacyPublicDraw: false, concurrent: true })).toEqual([]);
  });

  it("follows the projection's drawPublic mark when it is present", () => {
    const marked = [{ ...a, drawPublic: false }, { ...c, drawPublic: true }];
    const shown = projectorRounds(marked[0], marked, { staff: false, legacyPublicDraw: true, concurrent: true });
    expect(shown.map((item) => item.id)).toEqual([c.id]);
  });
});
