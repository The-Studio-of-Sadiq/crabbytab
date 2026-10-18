import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ db: { fake: true }, auth: null }));
vi.mock("firebase/firestore", () => import("@/test/fakeFirestore"));

import type { BallotSubmission, BreakCategory, Round, Team, Tournament } from "@/types";
import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "@/features/tournament/collections";
import {
  downloadTournamentCommand,
  uploadTournamentCommand,
  type CloudDeletionMap,
} from "@/features/tournament/application/cloudSync";
import { DrawCloudSyncIncompleteError } from "@/features/tournament/application/draws";
import {
  createTournamentBackup,
  mergeTournamentBackup,
  parseTournamentBackup,
  planTournamentBackupReplace,
} from "@/features/tournament/application/tournamentBackup";
import { planPrivateBallotWrites, supersededBallotUpdate } from "@/lib/privateSync";
import { createSeededRng } from "@/lib/draw/rng";
import { collectionRecords, fakeStore, resetFakeStore } from "@/test/fakeFirestore";
import { TournamentHarness } from "@/test/lifecycleHarness";
import {
  makeAdjudicators,
  makeTeams,
  makeTournament,
  makeVenues,
  simulateBallot,
} from "@/test/tournamentFixtures";
import { createFirestoreDrawRepository } from "./drawRepository";
import { createFirestoreTournamentRepository } from "./tournamentRepository";

/**
 * Cloud sync and restore against an in-memory Firestore that runs the real repository code:
 * interrupted uploads, two devices editing one record, tombstoned deletions (including the debates
 * of a regenerated draw), private-URL ballots, and backups restored by replacing or merging.
 */

const USER = "owner";
const TOURNAMENT_PATH = (tournament: Tournament) => `tournaments/${tournament.id}`;

function stripSync(records: CloudRecord[]): Record<string, unknown>[] {
  return records
    .map((record) => {
      const { syncVersion: _syncVersion, ...rest } = record as CloudRecord & Record<string, unknown>;
      return JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
    })
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

/** A small two-team tournament with two resulted rounds and a generated break. */
async function playedTournament(deviceId = "device-a"): Promise<TournamentHarness> {
  const tournament = makeTournament("wsdc", { byeTeamSelectionMethod: "random", byeTeamResults: "win" }, "t-sync");
  const harness = new TournamentHarness(tournament, (round: Round) => 900 + round.seq);
  harness.deviceId = deviceId;
  harness.teams = makeTeams(9, { tournamentId: tournament.id, institutionCount: 3 });
  harness.adjudicators = makeAdjudicators(8, { tournamentId: tournament.id });
  harness.venues = makeVenues(6, tournament.id);
  const rng = createSeededRng(77);
  for (const seq of [1, 2]) {
    const round = await harness.createRound({ roundSeq: seq, name: `Round ${seq}`, abbr: `R${seq}`, stage: "preliminary" });
    await harness.generateDraw(round.id);
    await harness.allocate(round.id, 1);
    await harness.patchRound(round.id, { drawStatus: "released", adjudicatorsRevealed: true });
    for (const debate of harness.roundDebates(round.id)) {
      if (!debate.byeTeamId) await harness.submitBallot(simulateBallot(debate, harness.teams, tournament, rng));
    }
    await harness.completeRound(round.id);
  }
  const open: BreakCategory = {
    id: "open", tournamentId: tournament.id, name: "Open", slug: "open", seq: 1,
    breakSize: 4, reserveSize: 1, isGeneral: true, priority: 1, qualificationRule: "standard",
  };
  await harness.saveBreakCategories([open]);
  for (const [seq, name] of [[3, "Semifinals"], [4, "Grand Final"]] as const) {
    await harness.createRound({ roundSeq: seq, name, abbr: `E${seq}`, stage: "elimination", customDrawType: "elimination" });
  }
  await harness.generateBreak("open");
  return harness;
}

/** Another device: an empty tab room for the same tournament. */
function blankDevice(source: TournamentHarness, deviceId: string): TournamentHarness {
  const device = new TournamentHarness({ ...source.tournament, syncVersion: undefined }, (round) => 900 + round.seq);
  device.deviceId = deviceId;
  return device;
}

/**
 * The tab room's "Upload to cloud", as TournamentContext.uploadToCloud runs it: the repository
 * stamps each record it writes with the cloud's syncVersion, the device saves the records once
 * they have been sent (even if the upload stopped part-way), and the deletion queue is cleared
 * only after a complete upload.
 */
async function upload(device: TournamentHarness): Promise<number> {
  const deletions: CloudDeletionMap = device.tombstones;
  const conflicts = await uploadTournamentCommand({
    tournament: { ...device.tournament },
    userId: USER,
    localCollections: device.collections(),
    deletions,
    overwrites: device.overwrites,
    repository: createFirestoreTournamentRepository(),
    saveSyncedRecords: (tournament, collections) => device.load(tournament, collections),
  });
  device.tombstones = {};
  device.overwrites = {};
  return conflicts;
}

async function download(device: TournamentHarness): Promise<void> {
  const { tournament, collections } = await downloadTournamentCommand({
    tournamentId: device.tournament.id,
    slug: device.tournament.slug,
    userId: USER,
    localTournament: device.tournament,
    localCollections: device.collections(),
    deletions: device.tombstones,
    overwrites: device.overwrites,
    repository: createFirestoreTournamentRepository(),
  });
  device.load(tournament, collections);
}

function cloud(tournament: Tournament, name: CloudCollectionName): Array<Record<string, unknown> & { id: string }> {
  return collectionRecords(`${TOURNAMENT_PATH(tournament)}/${name}`);
}

function liveCloud(tournament: Tournament, name: CloudCollectionName) {
  return cloud(tournament, name).filter((record) => typeof record.deletedAt !== "string");
}

function conflicts(tournament: Tournament) {
  return collectionRecords(`${TOURNAMENT_PATH(tournament)}/syncConflicts`);
}

beforeEach(() => {
  resetFakeStore();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T09:00:00.000Z"));
  vi.spyOn(Math, "random").mockImplementation(createSeededRng(3));
});

describe("upload and download", () => {
  it("round-trips a played tournament to a second device with identical standings and break", async () => {
    const a = await playedTournament();
    expect(await upload(a)).toBe(0);
    for (const name of CLOUD_COLLECTIONS) {
      expect(stripSync(liveCloud(a.tournament, name) as unknown as CloudRecord[]), name)
        .toEqual(stripSync(a.collections()[name]));
    }
    const b = blankDevice(a, "device-b");
    await download(b);
    expect(b.standings()).toEqual(a.standings());
    expect(b.breakResults().map((result) => result.breakingTeams.map((entry) => entry.team.id)))
      .toEqual(a.breakResults().map((result) => result.breakingTeams.map((entry) => entry.team.id)));
    expect(b.breakCategories[0].generatedBreak).toEqual(a.breakCategories[0].generatedBreak);
    expect(conflicts(a.tournament)).toEqual([]);
  });

  it("resumes an interrupted upload with a second upload, without conflicts or duplicates", async () => {
    const a = await playedTournament();
    const before = a.collections();
    fakeStore.failAfterCommits = 12;
    await expect(upload(a)).rejects.toThrow("connection was lost");
    const partial = CLOUD_COLLECTIONS.reduce((count, name) => count + cloud(a.tournament, name).length, 0);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(CLOUD_COLLECTIONS.reduce((count, name) => count + before[name].length, 0));

    // Only the sync versions of the records that reached the cloud changed on the device.
    expect(stripSync(a.collections().teams)).toEqual(stripSync(before.teams));
    fakeStore.failAfterCommits = undefined;
    expect(await upload(a)).toBe(0);
    for (const name of CLOUD_COLLECTIONS) {
      expect(stripSync(cloud(a.tournament, name) as unknown as CloudRecord[]), name).toEqual(stripSync(before[name]));
    }
    expect(conflicts(a.tournament)).toEqual([]);
    // Every record now carries the cloud's version, so a later edit uploads cleanly.
    a.teams = a.teams.map((team, index) => index === 0 ? { ...team, name: "Renamed" } : team);
    expect(await upload(a)).toBe(0);
    expect(cloud(a.tournament, "teams").find((team) => team.id === a.teams[0].id)).toMatchObject({ name: "Renamed", syncVersion: 2 });
  });

  it("uploads an edit to a record that was written before an upload was interrupted", async () => {
    const a = await playedTournament();
    fakeStore.failAfterCommits = 40;
    await expect(upload(a)).rejects.toThrow();
    fakeStore.failAfterCommits = undefined;
    // The first round was written before the failure, and the device kept its cloud version.
    const round = a.rounds[0];
    expect(cloud(a.tournament, "rounds").find((item) => item.id === round.id)).toMatchObject({ syncVersion: 1 });
    expect((a.round(round.id) as Round & CloudRecord).syncVersion).toBe(1);
    await a.patchRound(round.id, { motionsReleased: true });
    expect(await upload(a)).toBe(0);
    expect(cloud(a.tournament, "rounds").find((item) => item.id === round.id)).toMatchObject({ motionsReleased: true, syncVersion: 2 });
    // Only the replaced version is archived (as every overwrite is); nothing is left unresolved.
    expect(conflicts(a.tournament).map((item) => item.resolution)).toEqual(["superseded"]);
  });
});

describe("two devices editing the same record", () => {
  it("keeps the first upload, archives the other version and never silently drops it", async () => {
    const a = await playedTournament();
    await upload(a);
    const b = blankDevice(a, "device-b");
    await download(b);
    const teamId = a.teams[0].id;

    a.teams = a.teams.map((team) => team.id === teamId ? { ...team, name: "Name from A" } : team);
    b.teams = b.teams.map((team) => team.id === teamId ? { ...team, name: "Name from B" } : team);
    expect(await upload(a)).toBe(0);
    expect(await upload(b)).toBe(1);

    expect(cloud(a.tournament, "teams").find((team) => team.id === teamId)).toMatchObject({ name: "Name from A", syncVersion: 2 });
    // A's upload archived the version it replaced; B's stale edit is archived beside it.
    expect(conflicts(a.tournament).map((item) => item.resolution).sort()).toEqual(["superseded", "unresolved"]);
    const conflict = conflicts(a.tournament).find((item) => item.resolution === "unresolved");
    expect(conflict).toMatchObject({
      collectionName: "teams",
      recordId: teamId,
      resolution: "unresolved",
      record: { name: "Name from A" },
      incomingRecord: { name: "Name from B" },
    });
    // B keeps its own edit locally after downloading; nothing was overwritten without a trace.
    await download(b);
    expect(b.teams.find((team) => team.id === teamId)?.name).toBe("Name from B");
  });

  it("lets a device that downloaded the latest version edit and upload without a conflict", async () => {
    const a = await playedTournament();
    await upload(a);
    const b = blankDevice(a, "device-b");
    await download(b);
    a.venues = a.venues.map((venue, index) => index === 0 ? { ...venue, name: "Main Hall" } : venue);
    await upload(a);
    const fresh = blankDevice(a, "device-c");
    await download(fresh);
    fresh.venues = fresh.venues.map((venue, index) => index === 0 ? { ...venue, priority: 99 } : venue);
    expect(await upload(fresh)).toBe(0);
    expect(cloud(a.tournament, "venues").find((venue) => venue.id === a.venues[0].id)).toMatchObject({ name: "Main Hall", priority: 99, syncVersion: 3 });
  });
});

describe("tombstoned deletions", () => {
  it("deletes records in the cloud, keeps them recoverable, and never resurrects them from another device", async () => {
    const a = await playedTournament();
    await upload(a);
    const b = blankDevice(a, "device-b");
    await download(b);

    const removedVenue = a.venues[a.venues.length - 1].id;
    a.venues = a.venues.filter((venue) => venue.id !== removedVenue);
    a.tombstones = { venues: [removedVenue] };
    expect(await upload(a)).toBe(0);
    expect(cloud(a.tournament, "venues").find((venue) => venue.id === removedVenue)).toMatchObject({ deletedAt: expect.any(String) });
    expect(conflicts(a.tournament)).toEqual([
      expect.objectContaining({ collectionName: "venues", recordId: removedVenue, resolution: "recoverable-delete" }),
    ]);

    // B still holds the venue. Uploading does not bring it back, and downloading removes it.
    expect(await upload(b)).toBe(1);
    expect(cloud(a.tournament, "venues").find((venue) => venue.id === removedVenue)?.deletedAt).toEqual(expect.any(String));
    await download(b);
    expect(b.venues.map((venue) => venue.id)).not.toContain(removedVenue);
  });

  it("removes a regenerated draw's old debates and syncs its discarded ballots, even after an interrupted cloud write", async () => {
    const a = await playedTournament();
    await upload(a);
    const b = blankDevice(a, "device-b");
    await download(b);

    const round = a.rounds[1];
    const oldDebateIds = a.roundDebates(round.id).map((debate) => debate.id);
    const oldBallotIds = a.ballots.filter((ballot) => oldDebateIds.includes(ballot.debateId)).map((ballot) => ballot.id);
    expect(oldBallotIds.length).toBeGreaterThan(0);
    await a.patchRound(round.id, { completed: false });
    a.drawCloudRepository = createFirestoreDrawRepository(a.tournament.id);
    fakeStore.failAfterCommits = fakeStore.commits; // the immediate cloud replacement fails
    await expect(a.generateDraw(round.id, { discardExistingResults: true })).rejects.toBeInstanceOf(DrawCloudSyncIncompleteError);
    fakeStore.failAfterCommits = undefined;
    expect(a.tombstones.debates).toEqual(oldDebateIds);

    // The cloud still has the old draw and live ballots until the device uploads.
    expect(liveCloud(a.tournament, "debates").filter((debate) => debate.roundId === round.id).map((debate) => debate.id).sort())
      .toEqual([...oldDebateIds].sort());
    await upload(a);
    const cloudRoundDebates = liveCloud(a.tournament, "debates").filter((debate) => debate.roundId === round.id);
    expect(cloudRoundDebates.map((debate) => debate.id).sort()).toEqual(a.roundDebates(round.id).map((debate) => debate.id).sort());
    expect(cloudRoundDebates.some((debate) => oldDebateIds.includes(debate.id))).toBe(false);
    for (const id of oldBallotIds) {
      expect(cloud(a.tournament, "ballots").find((ballot) => ballot.id === id)).toMatchObject({ discarded: true, confirmed: false });
    }

    // A device with the old draw neither resurrects it by uploading nor keeps it after downloading.
    await upload(b);
    expect(liveCloud(a.tournament, "debates").some((debate) => oldDebateIds.includes(debate.id))).toBe(false);
    await download(b);
    expect(b.debates.some((debate) => oldDebateIds.includes(debate.id))).toBe(false);
    expect(b.roundDebates(round.id).map((debate) => debate.id).sort()).toEqual(a.roundDebates(round.id).map((debate) => debate.id).sort());
  });
});

describe("private-URL ballots", () => {
  /** What /api/private/sync stores for a chair's ballots (the same plan and updates as the route). */
  function portalSubmit(tournament: Tournament, submissions: BallotSubmission[]): BallotSubmission[] {
    const path = `${TOURNAMENT_PATH(tournament)}/ballots`;
    const existing = new Map(
      [...new Set(submissions.map((ballot) => ballot.debateId))].map((debateId) => [
        debateId,
        collectionRecords(path)
          .filter((record) => record.debateId === debateId)
          .map(({ id, ...data }) => ({ id, data: data as Partial<BallotSubmission> })),
      ])
    );
    const plan = planPrivateBallotWrites(submissions, existing);
    for (const id of plan.discardExistingIds) {
      const current = fakeStore.documents.get(`${path}/${id}`)!;
      fakeStore.documents.set(`${path}/${id}`, { ...current, ...supersededBallotUpdate(current) });
    }
    for (const ballot of plan.writes) fakeStore.documents.set(`${path}/${ballot.id}`, JSON.parse(JSON.stringify(ballot)));
    return plan.writes;
  }

  it("are never overwritten or resurrected by an admin upload", async () => {
    const a = await playedTournament();
    // A third round, drawn and released, awaiting results.
    const round = await a.createRound({ roundSeq: 5, name: "Round 3", abbr: "R3", stage: "preliminary" });
    a.rounds = a.rounds.map((item) => item.id === round.id ? { ...item, seq: 3 } : item.stage === "elimination" ? { ...item, seq: item.seq + 1 } : item);
    await a.generateDraw(round.id);
    await a.allocate(round.id, 1);
    await a.patchRound(round.id, { drawStatus: "released" });
    await upload(a);
    const debate = a.roundDebates(round.id).find((item) => !item.byeTeamId)!;
    const chair = debate.adjudicators.chairId!;
    const rng = createSeededRng(5);

    // The chair submits a final ballot from their private page.
    const [first] = portalSubmit(a.tournament, [
      simulateBallot(debate, a.teams, a.tournament, rng, { id: "portal-1", submitterType: "judge", submitterId: chair }),
    ]);
    expect(first.confirmed).toBe(true);
    // The admin's upload (without the ballot) keeps it; a download brings it in.
    expect(await upload(a)).toBe(0);
    expect(cloud(a.tournament, "ballots").find((ballot) => ballot.id === "portal-1")).toMatchObject({ confirmed: true });
    await download(a);
    expect(a.ballots.find((ballot) => ballot.id === "portal-1")).toMatchObject({ confirmed: true, discarded: false });

    // The chair corrects the ballot; the portal discards the first version in the cloud.
    portalSubmit(a.tournament, [
      simulateBallot(debate, a.teams, a.tournament, rng, { id: "portal-2", submitterType: "judge", submitterId: chair, version: 2 }),
    ]);
    expect(cloud(a.tournament, "ballots").find((ballot) => ballot.id === "portal-1")).toMatchObject({ discarded: true });

    // The admin still holds the first version as confirmed. Uploading must not revive it.
    await upload(a);
    const cloudBallots = cloud(a.tournament, "ballots").filter((ballot) => ballot.debateId === debate.id);
    expect(cloudBallots.find((ballot) => ballot.id === "portal-1")).toMatchObject({ discarded: true, confirmed: false });
    expect(cloudBallots.filter((ballot) => ballot.confirmed === true && ballot.discarded !== true).map((ballot) => ballot.id))
      .toEqual(["portal-2"]);
    // The admin's stale copy is archived, not lost.
    expect(conflicts(a.tournament)).toEqual([
      expect.objectContaining({ collectionName: "ballots", recordId: "portal-1", incomingRecord: expect.objectContaining({ confirmed: true }) }),
    ]);
  });
});

describe("backup and restore", () => {
  function summary(harness: TournamentHarness) {
    return {
      standings: harness.standings(),
      breaks: harness.breakResults().map((result) => ({
        breaking: result.breakingTeams.map((entry) => entry.team.id),
        reserves: result.reserveTeams.map((entry) => entry.team.id),
      })),
      generated: harness.breakCategories.map((category) => category.generatedBreak),
      teams: harness.teams.map((team: Team) => [team.id, team.breakStatus, team.breakCategoryIds]),
    };
  }

  it("replacing with a backup restores identical standings and break after later changes", async () => {
    const a = await playedTournament();
    const original = summary(a);
    const backup = parseTournamentBackup(
      JSON.parse(JSON.stringify(createTournamentBackup({ tournament: a.tournament, collections: a.collections() }))),
      a.tournament.id
    );

    // Later changes: a result discarded, a team renamed, a venue deleted, the break overridden.
    const confirmed = a.ballots.find((ballot) => ballot.confirmed)!;
    await a.discardBallot(confirmed.id);
    a.teams = a.teams.map((team, index) => index === 0 ? { ...team, name: "Changed" } : team);
    a.venues = a.venues.slice(1);
    expect(summary(a)).not.toEqual(original);

    const plan = planTournamentBackupReplace({ currentTournament: a.tournament, current: a.collections(), backup });
    a.load(plan.tournament, plan.collections);
    expect(summary(a)).toEqual(original);
    expect(plan.removedIds).toEqual({});
  });

  it("merging a backup into an empty device restores identical standings and break", async () => {
    const a = await playedTournament();
    const backup = createTournamentBackup({ tournament: a.tournament, collections: a.collections() });
    const b = blankDevice(a, "device-b");
    b.load({ ...backup.tournament, id: b.tournament.id, slug: b.tournament.slug }, mergeTournamentBackup({ current: b.collections(), backup: backup.collections }));
    expect(summary(b)).toEqual(summary(a));
  });

  it("merging keeps this device's version of records that exist on both sides", async () => {
    const a = await playedTournament();
    const backup = createTournamentBackup({ tournament: a.tournament, collections: a.collections() });
    a.teams = a.teams.map((team, index) => index === 0 ? { ...team, name: "Local edit" } : team);
    const merged = mergeTournamentBackup({ current: a.collections(), backup: backup.collections });
    expect((merged.teams as unknown as Team[]).find((team) => team.id === a.teams[0].id)?.name).toBe("Local edit");
    expect(merged.teams).toHaveLength(a.teams.length);
  });

  it("a replaced tournament uploads its restored records over newer and deleted cloud versions", async () => {
    const a = await playedTournament();
    await upload(a);
    const backup = createTournamentBackup({ tournament: a.tournament, collections: a.collections() });
    const original = summary(a);
    const venueCount = a.venues.length;

    // After the backup, a result is discarded and a venue deleted, and both are uploaded.
    const confirmed = a.ballots.find((ballot) => ballot.confirmed)!;
    await a.discardBallot(confirmed.id);
    const removedVenue = a.venues[0].id;
    a.venues = a.venues.slice(1);
    a.tombstones = { venues: [removedVenue] };
    await upload(a);
    expect(cloud(a.tournament, "ballots").find((ballot) => ballot.id === confirmed.id)).toMatchObject({ discarded: true });
    expect(cloud(a.tournament, "venues").find((venue) => venue.id === removedVenue)?.deletedAt).toEqual(expect.any(String));

    // Restore the backup, as replaceTournamentWithBackup does.
    const plan = planTournamentBackupReplace({ currentTournament: a.tournament, current: a.collections(), backup });
    a.load(plan.tournament, plan.collections);
    a.tombstones = plan.removedIds;
    a.overwrites = plan.restoredIds;
    expect(summary(a)).toEqual(original);

    // Downloading before uploading keeps the restored records, even ones the cloud deleted.
    await download(a);
    expect(summary(a)).toEqual(original);
    expect(a.venues).toHaveLength(venueCount);

    // The upload writes the restored records over the cloud's newer and deleted versions.
    expect(await upload(a)).toBe(0);
    expect(cloud(a.tournament, "ballots").find((ballot) => ballot.id === confirmed.id)).toMatchObject({ discarded: false, confirmed: true });
    expect(cloud(a.tournament, "venues").find((venue) => venue.id === removedVenue)).not.toHaveProperty("deletedAt");
    expect(conflicts(a.tournament).filter((item) => item.resolution === "restored").map((item) => item.recordId).sort())
      .toEqual([confirmed.id, removedVenue, ...a.debates.filter((debate) => debate.id === confirmed.debateId).map((debate) => debate.id)].sort());
    const c = blankDevice(a, "device-c");
    await download(c);
    expect(summary(c)).toEqual(original);

    // Once uploaded, the restore is done: later edits sync normally and conflicts work again.
    a.teams = a.teams.map((team, index) => index === 0 ? { ...team, name: "After restore" } : team);
    expect(await upload(a)).toBe(0);
  });
});
