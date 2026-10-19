import { describe, expect, it, vi } from "vitest";

import type { CloudRecord } from "@/features/tournament/collections";
import type { BallotSubmission, Debate, Round } from "@/types";
import { confirmBallotCommand, submitBallotCommand, type BallotWorkflowDependencies } from "./ballots";
import { baselineEntryFor, type SyncBaselineEntry } from "./cloudSync";
import { createLiveSession, type LivePort, type LiveSessionHost, type LiveSnapshot } from "./liveSession";
import { planLiveWrites, type LiveCollectionName, type LiveScope, type LiveSyncStatus, type LiveWrite } from "./liveSync";

/** A Firestore stand-in: records subscriptions and commits; commits settle when the test says so. */
function fakePort() {
  const subscriptions = new Map<string, { scope: LiveScope; next(snapshot: LiveSnapshot): void; error(error: unknown): void; active: boolean }>();
  const commits: Array<{ writes: LiveWrite[]; resolve(): void; reject(error: unknown): void }> = [];
  const port: LivePort = {
    subscribe(scope, handlers) {
      const key = scope.roundId ? `${scope.collection}@${scope.roundId}` : scope.collection;
      const subscription = { scope, ...handlers, active: true };
      subscriptions.set(key, subscription);
      return () => {
        subscription.active = false;
        subscriptions.delete(key);
      };
    },
    commit(writes) {
      return new Promise<void>((resolve, reject) => commits.push({ writes, resolve, reject }));
    },
    waitForPendingWrites: () => Promise.resolve(),
  };
  return { port, subscriptions, commits };
}

function fakeHost() {
  const statuses: LiveSyncStatus[] = [];
  const snapshots: Array<{ collection: LiveCollectionName; snapshot: LiveSnapshot }> = [];
  const rejected: LiveWrite[][] = [];
  const host: LiveSessionHost = {
    applySnapshot: (collection, snapshot) => snapshots.push({ collection, snapshot }),
    onWritesRejected: (writes) => rejected.push(writes),
    onStatus: (status) => statuses.push(status),
  };
  return { host, statuses, snapshots, rejected, last: () => statuses[statuses.length - 1] };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("live session listeners", () => {
  it("re-scopes debates and ballots when the active round changes and keeps check-in listeners", () => {
    const { port, subscriptions } = fakePort();
    const session = createLiveSession(port, fakeHost().host);
    session.setActiveRound("r1");
    expect([...subscriptions.keys()].sort()).toEqual(["adjudicators", "ballots@r1", "debates@r1", "teams"]);
    const teams = subscriptions.get("teams");
    session.setActiveRound("r2");
    expect([...subscriptions.keys()].sort()).toEqual(["adjudicators", "ballots@r2", "debates@r2", "teams"]);
    expect(subscriptions.get("teams")).toBe(teams);
    session.setActiveRound(null);
    expect([...subscriptions.keys()].sort()).toEqual(["adjudicators", "teams"]);
    session.dispose();
    expect(subscriptions.size).toBe(0);
  });

  it("reports connecting, live, and offline with queued changes from the listeners", () => {
    const { port, subscriptions } = fakePort();
    const { host, last, snapshots } = fakeHost();
    const session = createLiveSession(port, host);
    session.setActiveRound(null);
    expect(last().mode).toBe("connecting");
    subscriptions.get("teams")!.next({ changes: [], fromCache: false, pendingIds: [] });
    subscriptions.get("adjudicators")!.next({ changes: [{ type: "added", record: { id: "a1" } }], fromCache: false, pendingIds: [] });
    expect(last()).toEqual({ mode: "live", queuedWrites: 0 });
    expect(snapshots.map((item) => item.collection)).toEqual(["adjudicators"]);
    subscriptions.get("teams")!.next({ changes: [], fromCache: true, pendingIds: ["t1", "t2"] });
    expect(last()).toEqual({ mode: "offline", queuedWrites: 2 });
    session.setOnline(false);
    subscriptions.get("teams")!.next({ changes: [], fromCache: false, pendingIds: [] });
    expect(last()).toEqual({ mode: "offline", queuedWrites: 0 });
    session.setOnline(true);
    expect(last()).toEqual({ mode: "live", queuedWrites: 0 });
  });

  it("stops on a refused listener and says so", () => {
    const { port, subscriptions } = fakePort();
    const { host, last } = fakeHost();
    const session = createLiveSession(port, host);
    session.setActiveRound(null);
    subscriptions.get("teams")!.error({ code: "permission-denied" });
    expect(last().mode).toBe("error");
    expect(last().error).toContain("refused access");
  });
});

describe("live session writes", () => {
  const write = (id: string, value: boolean): LiveWrite => ({
    kind: "patch",
    collection: "ballots",
    id,
    record: { id },
    fields: [{ path: ["confirmed"], value }],
    syncVersion: 2,
  });

  it("commits the writes of one tick as one batch and counts them until acknowledged", async () => {
    const { port, commits } = fakePort();
    const { host, last } = fakeHost();
    const session = createLiveSession(port, host);
    session.write([write("b1", true)]);
    session.write([write("b2", false), write("b1", true)]);
    expect(last().queuedWrites).toBe(2);
    await settle();
    expect(commits).toHaveLength(1);
    expect(commits[0].writes.map((item) => item.id)).toEqual(["b1", "b2"]);
    commits[0].resolve();
    await settle();
    expect(last().queuedWrites).toBe(0);
  });

  it("hands refused writes back to the host", async () => {
    const { port, commits } = fakePort();
    const { host, rejected, last } = fakeHost();
    const session = createLiveSession(port, host);
    session.write([write("b1", true)]);
    await settle();
    commits[0].reject({ code: "permission-denied" });
    await settle();
    expect(rejected).toEqual([[write("b1", true)]]);
    expect(last().mode).toBe("error");
  });

  it("commits queued writes when disposed, so the cloud SDK keeps them", () => {
    const { port, commits } = fakePort();
    const session = createLiveSession(port, fakeHost().host);
    session.write([write("b1", true)]);
    session.dispose();
    expect(commits).toHaveLength(1);
  });
});

describe("state rules run before any live write", () => {
  const round: Round = {
    id: "r1",
    tournamentId: "t",
    seq: 1,
    name: "Round 1",
    abbreviation: "R1",
    stage: "preliminary",
    drawType: "power_paired",
    drawStatus: "released",
  } as Round;
  const debate = {
    id: "d1",
    tournamentId: "t",
    roundId: "r1",
    roundSeq: 1,
    teams: { AFF: { teamId: "ta" }, NEG: { teamId: "tn" } },
    adjudicators: { chairId: "a1", panellistIds: [], traineeIds: [] },
    resultStatus: "draft",
    syncVersion: 1,
  } as unknown as Debate;
  const ballot = (id: string, overrides: Partial<BallotSubmission> = {}): BallotSubmission => ({
    id,
    tournamentId: "t",
    roundId: "r1",
    debateId: "d1",
    version: 1,
    confirmed: false,
    discarded: false,
    submitterType: "tabroom",
    submitterId: "operator-1",
    speakerScores: { AFF: [], NEG: [] },
    teamScores: {
      AFF: { side: "AFF", teamId: "ta", points: 1, totalSpeakerScore: 150 },
      NEG: { side: "NEG", teamId: "tn", points: 0, totalSpeakerScore: 148 },
    },
    timestamp: "2026-10-19T09:00:00.000Z",
    syncVersion: 1,
    ...overrides,
  }) as BallotSubmission;

  /** A device in a live session: command saves become planned live writes, as in TournamentContext. */
  function liveDevice(input: { ballots: BallotSubmission[]; actorId: string }) {
    const { port, commits } = fakePort();
    const session = createLiveSession(port, fakeHost().host);
    const state: Record<"ballots" | "debates", CloudRecord[]> = {
      ballots: input.ballots as unknown as CloudRecord[],
      debates: [debate as unknown as CloudRecord],
    };
    const baseline: Record<string, Record<string, SyncBaselineEntry>> = {
      ballots: Object.fromEntries(state.ballots.map((record) => [record.id, baselineEntryFor(record)])),
      debates: Object.fromEntries(state.debates.map((record) => [record.id, baselineEntryFor(record)])),
    };
    const save = (name: "ballots" | "debates", base: CloudRecord[], next: CloudRecord[]) => {
      const plan = planLiveWrites({ collection: name, base, next, latest: state[name], baseline: baseline[name], now: "now" });
      state[name] = plan.records;
      session.write(plan.writes);
    };
    const initialBallots = state.ballots;
    const initialDebates = state.debates;
    const dependencies: BallotWorkflowDependencies = {
      ballots: input.ballots,
      debates: [debate],
      rounds: [round],
      adjudicators: [],
      repository: {
        saveBallots: (items) => save("ballots", initialBallots, items as unknown as CloudRecord[]),
        saveDebates: (items) => save("debates", initialDebates, items as unknown as CloudRecord[]),
      },
      updateRound: vi.fn(async () => undefined),
      recordAuditEvent: vi.fn(async () => undefined),
      queuePrivateRecord: vi.fn(async () => undefined),
      checkPolicy: { doubleEntry: true, actorId: input.actorId },
    };
    return { dependencies, commits, state };
  }

  it("refuses a same-person check under double entry without writing anything", async () => {
    const { dependencies, commits } = liveDevice({ ballots: [ballot("b1")], actorId: "operator-1" });
    await expect(confirmBallotCommand("b1", "d1", undefined, dependencies)).rejects.toThrow(/different person/);
    await settle();
    expect(commits).toEqual([]);
  });

  it("refuses to overwrite a confirmed version without writing anything", async () => {
    const { dependencies, commits } = liveDevice({ ballots: [ballot("b1", { confirmed: true })], actorId: "operator-2" });
    await expect(submitBallotCommand(ballot("b1", { confirmed: false }), undefined, dependencies)).rejects.toThrow(/cannot be overwritten/);
    await settle();
    expect(commits).toEqual([]);
  });

  it("commits a confirmation, the discarded versions and the debate result as one batch", async () => {
    const { dependencies, commits, state } = liveDevice({
      ballots: [ballot("b1"), ballot("b2", { version: 2, submitterId: "operator-3" })],
      actorId: "operator-2",
    });
    await confirmBallotCommand("b1", "d1", undefined, dependencies);
    await settle();
    expect(commits).toHaveLength(1);
    const written = new Map(commits[0].writes.map((item) => [`${item.collection}/${item.id}`, item]));
    expect([...written.keys()].sort()).toEqual(["ballots/b1", "ballots/b2", "debates/d1"]);
    expect(written.get("ballots/b1")).toMatchObject({ kind: "patch", record: { confirmed: true, discarded: false } });
    expect(written.get("ballots/b2")).toMatchObject({ kind: "patch", record: { confirmed: false, discarded: true } });
    expect(written.get("debates/d1")).toMatchObject({ record: { resultStatus: "confirmed" } });
    expect(state.ballots.filter((item) => (item as unknown as BallotSubmission).confirmed).map((item) => item.id)).toEqual(["b1"]);
  });
});
