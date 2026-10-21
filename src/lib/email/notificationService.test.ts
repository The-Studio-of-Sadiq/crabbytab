import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

import type { BallotSubmission, Debate, Round, Tournament } from "@/types";
import type { EmailMessage, EmailProvider } from "./provider";
import {
  ballotConfirmationEmailMode,
  ballotReceiptsApply,
  baselineRoundNotifications,
  receiptModeSendsConfirmation,
  sendBallotReceipts,
  sendNextRoundNotification,
} from "./notificationService";

/** A minimal in-memory stand-in for the parts of the Admin SDK the service uses. */
function createFakeFirestore(initial: Record<string, Record<string, unknown>>) {
  const store = new Map<string, Record<string, unknown>>(Object.entries(initial));
  let autoId = 0;

  const snapshot = (path: string) => {
    const data = store.get(path);
    return { id: path.split("/").pop()!, exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
  };
  const querySnapshot = (collectionPath: string, filter?: [string, unknown]) => ({
    docs: [...store.keys()]
      .filter((key) => key.startsWith(`${collectionPath}/`) && !key.slice(collectionPath.length + 1).includes("/"))
      .map((key) => snapshot(key))
      .filter((document) => !filter || document.data()?.[filter[0]] === filter[1]),
  });
  function docRef(path: string) {
    return {
      id: path.split("/").pop()!,
      path,
      get: async () => snapshot(path),
      create: async (data: Record<string, unknown>) => {
        if (store.has(path)) throw Object.assign(new Error("exists"), { code: 6 });
        store.set(path, data);
      },
      set: async (data: Record<string, unknown>) => void store.set(path, data),
      update: async (data: Record<string, unknown>) => void store.set(path, { ...store.get(path), ...data }),
      collection: (name: string) => collectionRef(`${path}/${name}`),
    };
  }
  function collectionRef(path: string) {
    return {
      doc: (id?: string) => docRef(`${path}/${id ?? `auto-${(autoId += 1)}`}`),
      get: async () => querySnapshot(path),
      where: (field: string, _operator: string, value: unknown) => ({ get: async () => querySnapshot(path, [field, value]) }),
    };
  }
  type Ref = ReturnType<typeof docRef>;
  const firestore = {
    collection: (name: string) => collectionRef(name),
    getAll: async (...refs: Ref[]) => refs.map((ref) => snapshot(ref.path)),
    runTransaction: async <T,>(fn: (transaction: unknown) => Promise<T>) =>
      fn({ get: async (ref: Ref) => snapshot(ref.path), set: (ref: Ref, data: Record<string, unknown>) => store.set(ref.path, data) }),
    batch: () => {
      const operations: (() => void)[] = [];
      return {
        create: (ref: Ref, data: Record<string, unknown>) => operations.push(() => store.set(ref.path, data)),
        commit: async () => operations.forEach((operation) => operation()),
      };
    },
  };
  return { firestore: firestore as unknown as Firestore, store };
}

function fakeProvider() {
  const sent: EmailMessage[] = [];
  const provider: EmailProvider = {
    verifyConnection: vi.fn(async () => undefined),
    send: vi.fn(async (message: EmailMessage) => void sent.push(message)),
  };
  return { provider, sent };
}

const T = "tournaments/t1";
function tournament(preferences: Record<string, unknown>) {
  return { name: "Cup", slug: "cup", format: "wsdc", preferences: { publicResults: true, ...preferences } };
}
function roundDoc(overrides: Partial<Round>) {
  return { seq: 1, name: "Round 1", stage: "preliminary", drawStatus: "released", silent: false, ...overrides };
}
const debate = {
  roundId: "r1",
  venueName: "Room 1",
  teams: {
    AFF: { teamId: "alpha", teamName: "Alpha", side: "AFF" },
    NEG: { teamId: "beta", teamName: "Beta", side: "NEG" },
  },
  adjudicators: { chairId: "j1", chairName: "Judge", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
};
const baseDocs = (preferences: Record<string, unknown>, round: Partial<Round> = {}) => ({
  [T]: tournament(preferences),
  [`${T}/rounds/r1`]: roundDoc(round),
  [`${T}/teams/alpha`]: { name: "Alpha", speakers: [{ id: "s1", name: "Ann", email: "ann@example.com" }] },
  [`${T}/teams/beta`]: { name: "Beta", speakers: [{ id: "s2", name: "Bo", email: "bo@example.com" }] },
  [`${T}/adjudicators/j1`]: { name: "Judge", email: "judge@example.com", conflicts: [] },
  [`${T}/debates/d1`]: debate,
});
const sender = { uid: "admin", email: "admin@example.com", name: "Admin" };

describe("sendNextRoundNotification", () => {
  it("sends each due chunk once, then goes idle", async () => {
    const { firestore, store } = createFakeFirestore(baseDocs({ notifyDrawReleased: true }));
    const { provider, sent } = fakeProvider();
    const first = await sendNextRoundNotification({ firestore, tournamentId: "t1", sender, createProvider: () => provider });
    expect(first).toMatchObject({ status: "sent", event: "draw_teams", sent: 2, failed: 0 });
    expect(sent.map((message) => message.to)).toEqual(["ann@example.com", "bo@example.com"]);
    expect(sent[0].text).toContain("Side: AFF");
    expect(sent[0].text).toContain("Chair: TBA");
    expect(await sendNextRoundNotification({ firestore, tournamentId: "t1", sender, createProvider: () => provider })).toEqual({
      status: "idle",
    });
    expect(sent).toHaveLength(2);
    const campaigns = [...store.entries()].filter(([key]) => key.startsWith(`${T}/emailCampaigns/`));
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0][1]).toMatchObject({ notificationKey: "draw_teams-r1#1", sent: 2, status: "completed" });
  });

  it("does nothing for unreleased draws or when not opted in", async () => {
    const { provider, sent } = fakeProvider();
    const draft = createFakeFirestore(baseDocs({ notifyDrawReleased: true }, { drawStatus: "draft" }));
    expect(await sendNextRoundNotification({ firestore: draft.firestore, tournamentId: "t1", sender, createProvider: () => provider }))
      .toEqual({ status: "idle" });
    const optedOut = createFakeFirestore(baseDocs({}));
    expect(await sendNextRoundNotification({ firestore: optedOut.firestore, tournamentId: "t1", sender, createProvider: () => provider }))
      .toEqual({ status: "idle" });
    expect(sent).toEqual([]);
  });

  it("skips rounds released before opting in", async () => {
    const { firestore } = createFakeFirestore(baseDocs({ notifyDrawReleased: true }, { adjudicatorsRevealed: true }));
    expect(await baselineRoundNotifications(firestore, "t1", ["draw_teams", "draw_adjudicators"])).toBe(2);
    const { provider, sent } = fakeProvider();
    expect(await sendNextRoundNotification({ firestore, tournamentId: "t1", sender, createProvider: () => provider }))
      .toEqual({ status: "idle" });
    expect(sent).toEqual([]);
  });

  it("does not consume a notification when SMTP is not configured", async () => {
    const { firestore, store } = createFakeFirestore(baseDocs({ notifyDrawReleased: true }));
    await expect(
      sendNextRoundNotification({
        firestore,
        tournamentId: "t1",
        sender,
        createProvider: () => {
          throw new Error("SMTP_HOST must be configured.");
        },
      })
    ).rejects.toThrow("SMTP_HOST");
    expect([...store.keys()].some((key) => key.includes("notificationLog"))).toBe(false);
  });
});

describe("sendBallotReceipts", () => {
  const ballot = {
    id: "b1",
    roundId: "r1",
    debateId: "d1",
    teamScores: {
      AFF: { side: "AFF", teamId: "alpha", points: 1, totalSpeakerScore: 75, win: true },
      NEG: { side: "NEG", teamId: "beta", points: 0, totalSpeakerScore: 74, win: false },
    },
    speakerScores: {},
  } as unknown as BallotSubmission;
  const input = (preferences: Record<string, unknown>, firestore: Firestore, provider: EmailProvider) => ({
    firestore,
    tournament: { id: "t1", ...tournament(preferences) } as unknown as Tournament,
    adjudicator: { id: "j1", name: "Judge", email: "judge@example.com" },
    ballots: [ballot],
    debates: new Map([["d1", { id: "d1", ...debate } as unknown as Debate]]),
    rounds: new Map([["r1", { id: "r1", ...roundDoc({}) } as unknown as Round]]),
    createProvider: () => provider,
  });

  it("emails the submitter once per ballot", async () => {
    const { firestore } = createFakeFirestore({});
    const { provider, sent } = fakeProvider();
    await sendBallotReceipts(input({ notifyBallotReceipt: true }, firestore, provider));
    await sendBallotReceipts(input({ notifyBallotReceipt: true }, firestore, provider));
    expect(sent.map((message) => message.to)).toEqual(["judge@example.com"]);
    expect(sent[0].text).toContain("AFF Alpha: Win, total 75");
  });

  it("is off by default and never throws", async () => {
    const { firestore } = createFakeFirestore({});
    const { provider, sent } = fakeProvider();
    await sendBallotReceipts(input({}, firestore, provider));
    expect(sent).toEqual([]);
    const failing: EmailProvider = {
      verifyConnection: async () => undefined,
      send: async () => {
        throw new Error("SMTP down");
      },
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(sendBallotReceipts(input({ notifyBallotReceipt: true }, firestore, failing))).resolves.toBeUndefined();
    consoleError.mockRestore();
  });
});

describe("ballot receipts beyond private-URL submissions (Tabbycat enable_ballot_receipts)", () => {
  it("emails tab-room confirmations as receipts when receipts are on and confirmed emails are off", () => {
    expect(ballotConfirmationEmailMode({ notifyBallotReceipt: true } as Tournament["preferences"])).toBe("receipt");
    expect(ballotConfirmationEmailMode({ notifyBallotReceipt: true, notifyBallotConfirmed: true } as Tournament["preferences"])).toBe("confirmed");
    expect(ballotConfirmationEmailMode({} as Tournament["preferences"])).toBeNull();
  });

  it("skips adjudicators' own ballots (receipted on submission) and BP elimination rounds", () => {
    const two = { format: "wsdc" } as Pick<Tournament, "format">;
    const bp = { format: "bp" } as Pick<Tournament, "format">;
    expect(receiptModeSendsConfirmation({ submitterType: "tabroom" }, two, { stage: "preliminary" })).toBe(true);
    expect(receiptModeSendsConfirmation({ submitterType: "judge" }, two, { stage: "preliminary" })).toBe(false);
    expect(receiptModeSendsConfirmation({ submitterType: "tabroom" }, bp, { stage: "elimination" })).toBe(false);
    expect(ballotReceiptsApply(bp, { stage: "preliminary" })).toBe(true);
    expect(ballotReceiptsApply(two, { stage: "elimination" })).toBe(true);
  });

  it("sends no private-URL receipt for a BP elimination ballot", async () => {
    const { firestore } = createFakeFirestore({});
    const { provider, sent } = fakeProvider();
    await sendBallotReceipts({
      firestore,
      tournament: { id: "t1", ...tournament({ notifyBallotReceipt: true }), format: "bp" } as unknown as Tournament,
      adjudicator: { id: "j1", name: "Judge", email: "judge@example.com" },
      ballots: [{ id: "b1", roundId: "r1", debateId: "d1", teamScores: {}, speakerScores: {} } as unknown as BallotSubmission],
      debates: new Map([["d1", { id: "d1", ...debate } as unknown as Debate]]),
      rounds: new Map([["r1", { id: "r1", ...roundDoc({ stage: "elimination" }) } as unknown as Round]]),
      createProvider: () => provider,
    });
    expect(sent).toEqual([]);
  });
});
