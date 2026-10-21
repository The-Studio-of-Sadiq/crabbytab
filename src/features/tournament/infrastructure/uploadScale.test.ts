import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ db: { fake: true }, auth: null }));
vi.mock("firebase/firestore", () => import("@/test/fakeFirestore"));

import type { Tournament } from "@/types";
import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "@/features/tournament/collections";
import { uploadTournamentCommand, type SyncBaseline } from "@/features/tournament/application/cloudSync";
import { fakeStore, resetFakeStore } from "@/test/fakeFirestore";
import { createFirestoreTournamentRepository } from "./tournamentRepository";

/**
 * Firestore cost of uploading a 1000-team BP tournament (550 adjudicators, 9 rounds), counted the
 * way Firestore bills reads and writes. Uploads send only records changed since the synced
 * baseline, so a round's upload costs about as much as the records that round changed.
 */

type Collections = Record<CloudCollectionName, CloudRecord[]>;
const TOURNAMENT_ID = "t-scale";
const ROOMS = 250;

function record(id: string, fields: Record<string, unknown> = {}): CloudRecord {
  return { id, tournamentId: TOURNAMENT_ID, ...fields } as CloudRecord;
}

function roundRecords(round: number) {
  const debates = Array.from({ length: ROOMS }, (_, room) => record(`d-${round}-${room}`, {
    roundId: `r-${round}`,
    teams: Array.from({ length: 4 }, (_, side) => ({ teamId: `team-${(room * 4 + side + round) % 1000}`, side })),
    adjudicators: { chairId: `adj-${room % 550}`, panellistIds: [`adj-${(room + 250) % 550}`] },
  }));
  const ballots = debates.map((debate, room) => record(`b-${round}-${room}`, {
    debateId: debate.id,
    confirmed: true,
    speakerScores: Array.from({ length: 8 }, (_, speaker) => ({ speakerId: `s-${room}-${speaker}`, score: 75 })),
  }));
  const feedback = Array.from({ length: 2 * ROOMS }, (_, index) => record(`f-${round}-${index}`, {
    debateId: `d-${round}-${index % ROOMS}`,
    score: 3,
  }));
  const auditEvents = Array.from({ length: 40 }, (_, index) => record(`a-${round}-${index}`, {
    actorType: "user",
    actorId: "owner",
    action: "ballot.confirm",
  }));
  return { debates, ballots, feedback, auditEvents };
}

function tournamentAfterRounds(rounds: number): Collections {
  const collections = Object.fromEntries(CLOUD_COLLECTIONS.map((name) => [name, []])) as unknown as Collections;
  collections.teams = Array.from({ length: 1000 }, (_, i) => record(`team-${i}`, {
    name: `Team ${i}`,
    institutionId: `inst-${i % 150}`,
    speakers: [{ id: `sp-${i}-1`, name: "A" }, { id: `sp-${i}-2`, name: "B" }],
  }));
  collections.adjudicators = Array.from({ length: 550 }, (_, i) => record(`adj-${i}`, { name: `Adj ${i}`, baseScore: 3 }));
  collections.venues = Array.from({ length: ROOMS + 10 }, (_, i) => record(`venue-${i}`, { name: `Room ${i}` }));
  collections.institutions = Array.from({ length: 150 }, (_, i) => record(`inst-${i}`, { name: `Institution ${i}` }));
  collections.breakCategories = [record("open", { name: "Open" })];
  for (let round = 1; round <= 9; round++) {
    collections.rounds.push(record(`r-${round}`, { seq: round, drawStatus: round <= rounds ? "released" : "none" }));
    collections.motions.push(record(`m-${round}`, { roundId: `r-${round}`, text: "This House would..." }));
    if (round > rounds) continue;
    const { debates, ballots, feedback, auditEvents } = roundRecords(round);
    collections.debates.push(...debates);
    collections.ballots.push(...ballots);
    collections.feedback.push(...feedback);
    collections.auditEvents.push(...auditEvents);
  }
  return collections;
}

const tournament = { id: TOURNAMENT_ID, slug: "scale", name: "Scale Open", ownerId: "owner", admins: {} } as unknown as Tournament;

async function measuredUpload(collections: Collections, baseline: SyncBaseline) {
  fakeStore.reads = 0;
  fakeStore.writes = 0;
  fakeStore.commits = 0;
  let saved: SyncBaseline = {};
  const conflicts = await uploadTournamentCommand({
    tournament,
    userId: "owner",
    localCollections: collections,
    baseline,
    repository: createFirestoreTournamentRepository(),
    saveSyncedRecords: (_tournament, _collections, next) => {
      saved = next;
    },
  });
  return { conflicts, reads: fakeStore.reads, writes: fakeStore.writes, commits: fakeStore.commits, baseline: saved };
}

const count = (collections: Collections) => CLOUD_COLLECTIONS.reduce((sum, name) => sum + collections[name].length, 0);

beforeEach(() => {
  resetFakeStore();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("upload cost for a 1000-team tournament", () => {
  it("costs about one write per record initially and only the changed records afterwards", async () => {
    // Eight rounds played and uploaded.
    const collections = tournamentAfterRounds(8);
    const records = count(collections);
    const initial = await measuredUpload(collections, {});
    expect(initial.conflicts).toBe(0);
    // One write per record plus the settings and the participant-index marker; audit events are
    // created without reading them.
    expect(initial.writes).toBeLessThanOrEqual(records + 3);
    expect(initial.reads).toBeLessThanOrEqual(records - collections.auditEvents.length + 10);
    // Many records per commit instead of one transaction per record.
    expect(initial.commits).toBeLessThan(records / 100);

    // Uploading again with nothing changed sends nothing.
    const unchanged = await measuredUpload(collections, initial.baseline);
    expect(unchanged.writes).toBeLessThanOrEqual(2);
    expect(unchanged.reads).toBeLessThanOrEqual(10);

    // A typical round: its draw, ballots, feedback and audit trail, the round itself, and
    // twenty team edits (e.g. check-ins).
    const round = roundRecords(9);
    collections.debates.push(...round.debates);
    collections.ballots.push(...round.ballots);
    collections.feedback.push(...round.feedback);
    collections.auditEvents.push(...round.auditEvents);
    collections.rounds = collections.rounds.map((item) => item.id === "r-9" ? { ...item, drawStatus: "released" } as CloudRecord : item);
    collections.teams = collections.teams.map((team, index) => index < 20 ? { ...team, checkedIn: true } as CloudRecord : team);
    const changed = round.debates.length + round.ballots.length + round.feedback.length + round.auditEvents.length + 1 + 20;
    const roundUpload = await measuredUpload(collections, initial.baseline);
    expect(roundUpload.conflicts).toBe(0);
    // Edited records also archive the version they replace (21 here).
    expect(roundUpload.writes).toBeLessThanOrEqual(changed + 21 + 2);
    expect(roundUpload.reads).toBeLessThanOrEqual(changed - round.auditEvents.length + 10);

    console.info(
      `1000-team BP upload (${records} records): initial ${initial.reads} reads / ${initial.writes} writes / ${initial.commits} commits; ` +
      `unchanged ${unchanged.reads} / ${unchanged.writes}; one round (${changed} changed records) ` +
      `${roundUpload.reads} / ${roundUpload.writes} / ${roundUpload.commits} commits.`
    );
  }, 60_000);
});
