import { describe, expect, it } from "vitest";
import type { Round } from "@/types";
import { makeRound } from "@/test/tournamentFixtures";
import { projectorAccess, projectorRounds, staffProjectorRound } from "./display";

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

describe("staff projection before release", () => {
  // Regression: /display only had the public projection, so nobody could project a confirmed but
  // unreleased draw, and draw.display / motions.display gave staff nothing there.
  it("lets administrators and permitted staff project early", () => {
    expect(projectorAccess({ isOwnerOrAdmin: true, isDataEntryAssistant: false, permissions: [] }))
      .toEqual({ draw: true, motions: true });
    expect(projectorAccess({ isOwnerOrAdmin: false, isDataEntryAssistant: true, permissions: ["draw.display"] }))
      .toEqual({ draw: true, motions: false });
    expect(projectorAccess({ isOwnerOrAdmin: false, isDataEntryAssistant: true, permissions: ["motions.display"] }))
      .toEqual({ draw: false, motions: true });
    expect(projectorAccess({ isOwnerOrAdmin: false, isDataEntryAssistant: false, permissions: ["draw.display"] }))
      .toEqual({ draw: false, motions: false });
  });

  it("projects confirmed (locked) draws for staff, never drafts", () => {
    const locked = round(7, { drawStatus: "locked" });
    const draft = round(8, { drawStatus: "draft" });
    expect(projectorRounds(locked, [locked], { staff: true, legacyPublicDraw: true, concurrent: false })).toEqual([locked]);
    expect(projectorRounds(locked, [locked], { staff: false, legacyPublicDraw: true, concurrent: false })).toEqual([]);
    expect(projectorRounds(draft, [draft], { staff: true, legacyPublicDraw: true, concurrent: false })).toEqual([]);
  });

  it("opens on the current round, else the public round, else the latest confirmed draw", () => {
    const locked = round(7, { drawStatus: "locked" });
    const draft = round(8, { drawStatus: "draft" });
    const staffRounds = [r1, locked, draft];
    expect(staffProjectorRound(staffRounds, draft.id, r1.id)?.id).toBe(draft.id);
    expect(staffProjectorRound(staffRounds, undefined, r1.id)?.id).toBe(r1.id);
    expect(staffProjectorRound(staffRounds, undefined, undefined)?.id).toBe(locked.id);
  });
});
