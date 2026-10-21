import { describe, expect, it } from "vitest";
import type { Motion, Round } from "@/types";
import {
  applyMotionReleaseSync,
  infoSlidesVisible,
  motionsStatusOf,
  motionsVisible,
  planMotionsStatusChange,
  preparationMinutes,
  roundsNeedingMotionReleaseSync,
  setMotionsStatusCommand,
} from "./motionRelease";

const round = (id: string, motionsReleased = false) => ({ id, motionsReleased }) as Round;

describe("round motion release", () => {
  it("marks a round released once any of its motions is released, and unmarks it again", () => {
    const rounds = [round("r1"), round("r2", true), round("r3")];
    const motions = [
      { rounds: ["r1"], released: true },
      { rounds: ["r1", "r3"], released: false },
    ];
    const changed = roundsNeedingMotionReleaseSync(rounds, motions);
    expect(changed.map((item) => [item.id, item.motionsReleased])).toEqual([["r1", true], ["r2", false]]);
    const synced = applyMotionReleaseSync(rounds, changed);
    expect(synced.map((item) => item.motionsReleased)).toEqual([true, false, false]);
    expect(roundsNeedingMotionReleaseSync(synced, motions)).toEqual([]);
  });
});

const fullRound = (id: string, extra: Partial<Round> = {}) =>
  ({ id, name: id.toUpperCase(), seq: 1, motionsReleased: false, ...extra }) as Round;
const motion = (id: string, rounds: string[], released = false) =>
  ({ id, tournamentId: "t", text: `Motion ${id}`, rounds, released }) as Motion;

describe("three-state motion release", () => {
  it("derives the status of rounds saved before the three states existed", () => {
    expect(motionsStatusOf(fullRound("r1"))).toBe("not_released");
    expect(motionsStatusOf(fullRound("r1", { motionsReleased: true }))).toBe("motions_released");
    expect(motionsStatusOf(fullRound("r1", { motionsStatus: "info_slides_released" }))).toBe("info_slides_released");
    expect(infoSlidesVisible(fullRound("r1", { motionsStatus: "info_slides_released" }))).toBe(true);
    expect(motionsVisible(fullRound("r1", { motionsStatus: "info_slides_released" }))).toBe(false);
    expect(motionsStatusOf(undefined)).toBe("not_released");
  });

  it("keeps an info-slides release when no motion is released, and drops a stale motions release", () => {
    const rounds = [
      fullRound("info", { motionsStatus: "info_slides_released" }),
      fullRound("stale", { motionsStatus: "motions_released", motionsReleased: true }),
    ];
    const changed = roundsNeedingMotionReleaseSync(rounds, [motion("m1", ["info"]), motion("m2", ["stale"])]);
    expect(changed.map((item) => [item.id, item.motionsStatus, item.motionsReleased])).toEqual([["stale", "not_released", false]]);
  });

  it("releases every motion of the round and starts the round after the preparation time", () => {
    const now = new Date("2026-10-21T09:00:00.000Z");
    const target = fullRound("r1");
    const change = planMotionsStatusChange(target, "motions_released", {
      rounds: [target],
      motions: [motion("m1", ["r1"]), motion("m2", ["r1"], true), motion("m3", ["r2"])],
      preferences: { preparationTime: 15 },
      now,
    });
    expect(change.motions.map((item) => [item.id, item.released])).toEqual([["m1", true]]);
    expect(change.round).toMatchObject({ motionsStatus: "motions_released", motionsReleased: true, startsAt: "2026-10-21T09:15:00.000Z" });
    expect(preparationMinutes({ preparationTime: -1 })).toBeUndefined();
    const noPreparation = planMotionsStatusChange(target, "motions_released", { rounds: [target], motions: [motion("m1", ["r1"])], now });
    expect(noPreparation.round.startsAt).toBeUndefined();
  });

  it("withdraws motions to info slides, except motions released through another round", () => {
    const r1 = fullRound("r1", { motionsStatus: "motions_released", motionsReleased: true, startsAt: "2026-10-21T09:15:00.000Z" });
    const r2 = fullRound("r2", { motionsStatus: "motions_released", motionsReleased: true });
    const change = planMotionsStatusChange(r1, "info_slides_released", {
      rounds: [r1, r2],
      motions: [motion("only", ["r1"], true), motion("shared", ["r1", "r2"], true)],
      preferences: { preparationTime: 15 },
    });
    expect(change.motions.map((item) => [item.id, item.released])).toEqual([["only", false]]);
    expect(change.round).toMatchObject({ motionsStatus: "info_slides_released", motionsReleased: false, startsAt: r1.startsAt });
  });

  it("refuses to release a round without motions", () => {
    const target = fullRound("r1");
    expect(() => planMotionsStatusChange(target, "info_slides_released", { rounds: [target], motions: [] })).toThrow("no motions");
    expect(planMotionsStatusChange(target, "not_released", { rounds: [target], motions: [] }).motions).toEqual([]);
  });

  it("saves the motions before the round, then calls the event hook", async () => {
    const calls: string[] = [];
    const target = fullRound("r1");
    const change = await setMotionsStatusCommand("r1", "motions_released", {
      rounds: [target],
      motions: [motion("m1", ["r1"])],
      saveMotions: async (motions) => { calls.push(`motions:${motions.map((item) => item.id).join(",")}`); },
      saveRound: async (saved) => { calls.push(`round:${saved.motionsStatus}`); },
      onMotionsStatusChanged: (event) => { calls.push(`hook:${event.previousStatus}`); },
    });
    expect(calls).toEqual(["motions:m1", "round:motions_released", "hook:not_released"]);
    expect(change?.round.motionsReleased).toBe(true);
    await expect(setMotionsStatusCommand("r1", "motions_released", {
      rounds: [{ ...target, cancelled: true }],
      motions: [],
      saveMotions: async () => undefined,
      saveRound: async () => undefined,
    })).rejects.toThrow("cancelled");
  });
});
