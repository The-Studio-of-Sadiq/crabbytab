import type { CloudCollectionName, CloudRecord } from "@/features/tournament/collections";
import {
  PUBLIC_SOURCE_COLLECTIONS,
  type PublicSourceData,
  type SourceRecord,
} from "@/lib/publicView/projection";
import { fingerprintPublicSource } from "@/lib/publicView/snapshot";
import type { Tournament } from "@/types";

export interface PublishPublicViewResponse {
  status: "published" | "unchanged";
  slug: string;
  version: string;
  changedSections: string[];
}

/** Fingerprint of what the public could see if this device's records were published. */
export function fingerprintLocalPublicView(
  tournament: Tournament,
  collections: Record<CloudCollectionName, CloudRecord[]>
): string {
  const source = Object.fromEntries(
    PUBLIC_SOURCE_COLLECTIONS.map((name) => [name, (collections[name] || []) as unknown as SourceRecord[]])
  ) as PublicSourceData;
  return fingerprintPublicSource(tournament as unknown as SourceRecord, source);
}

export async function publishPublicViewCommand(input: {
  tournament: Tournament;
  collections: Record<CloudCollectionName, CloudRecord[]>;
  idToken: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<PublishPublicViewResponse> {
  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl(
    `/api/tournaments/${encodeURIComponent(input.tournament.id)}/public-view`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        clientFingerprint: fingerprintLocalPublicView(input.tournament, input.collections),
        force: input.force === true,
      }),
      cache: "no-store",
    }
  );
  const result = (await response.json().catch(() => ({}))) as Partial<PublishPublicViewResponse> & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(typeof result.error === "string" ? result.error : "Could not publish the public view.");
  }
  return result as PublishPublicViewResponse;
}

export const PUBLIC_VIEW_POLL_MILLISECONDS = 45_000;

export interface PublicProjectionResponse {
  version?: string;
  tournament: Tournament;
  collections: Record<string, unknown[]>;
  /**
   * Content hash of every public round's debates and ballots, by round id. Absent from a response
   * that already holds every round.
   */
  roundSections?: Record<string, string>;
  /** Rounds whose debates and ballots this response includes (the latest public round). */
  loadedRoundIds?: string[];
}

export interface PublicRoundResponse {
  version: string;
  roundId: string;
  hash: string;
  debates: unknown[];
  ballots: unknown[];
}

export async function fetchPublicProjection(
  slug: string,
  fetchImpl: typeof fetch = fetch
): Promise<PublicProjectionResponse> {
  const response = await fetchImpl(`/api/public/tournaments/${encodeURIComponent(slug)}`);
  const result = (await response.json().catch(() => ({}))) as Partial<PublicProjectionResponse> & {
    error?: string;
  };
  if (!response.ok || !result.tournament || !result.collections) {
    throw new Error(typeof result.error === "string" ? result.error : "Could not load public tournament data.");
  }
  return result as PublicProjectionResponse;
}

export async function fetchPublicViewVersion(slug: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const response = await fetchImpl(`/api/public/tournaments/${encodeURIComponent(slug)}/version`);
  if (!response.ok) return null;
  const result = (await response.json().catch(() => ({}))) as { version?: unknown };
  return typeof result.version === "string" ? result.version : null;
}

/** One round's public debates and ballots; the hash makes the URL a cacheable content address. */
export async function fetchPublicRound(
  slug: string,
  roundId: string,
  hash: string,
  fetchImpl: typeof fetch = fetch
): Promise<PublicRoundResponse> {
  const response = await fetchImpl(
    `/api/public/tournaments/${encodeURIComponent(slug)}?round=${encodeURIComponent(roundId)}&h=${encodeURIComponent(hash)}`
  );
  const result = (await response.json().catch(() => ({}))) as Partial<PublicRoundResponse> & { error?: string };
  if (!response.ok || !Array.isArray(result.debates) || !Array.isArray(result.ballots)) {
    throw new Error(typeof result.error === "string" ? result.error : "Could not load this round's public data.");
  }
  return result as PublicRoundResponse;
}

/** Rounds (of `wanted`, or all) whose current section is not loaded yet. */
export function publicRoundsToLoad(
  hashes: Record<string, string>,
  loaded: ReadonlyMap<string, string>,
  wanted: readonly string[] = Object.keys(hashes)
): string[] {
  return wanted.filter((roundId) => hashes[roundId] !== undefined && loaded.get(roundId) !== hashes[roundId]);
}

/** Replaces the records of the given rounds with their freshly loaded versions. */
export function replaceRoundRecords<T extends { roundId: string }>(
  current: readonly T[],
  rounds: ReadonlyArray<{ roundId: string; records: readonly unknown[] }>
): T[] {
  const replaced = new Set(rounds.map((round) => round.roundId));
  return [
    ...current.filter((record) => !replaced.has(record.roundId)),
    ...rounds.flatMap((round) => round.records as T[]),
  ];
}

/** The whole projection: the base response plus every other round, merged (private portals). */
export async function fetchCompletePublicProjection(
  slug: string,
  fetchImpl: typeof fetch = fetch
): Promise<PublicProjectionResponse> {
  const base = await fetchPublicProjection(slug, fetchImpl);
  const hashes = base.roundSections;
  if (!hashes) return base;
  const missing = publicRoundsToLoad(hashes, new Map((base.loadedRoundIds || []).map((id) => [id, hashes[id]])));
  const rounds = await Promise.all(missing.map((roundId) => fetchPublicRound(slug, roundId, hashes[roundId], fetchImpl)));
  const merge = (name: "debates" | "ballots") =>
    replaceRoundRecords(
      (base.collections[name] || []) as Array<{ roundId: string }>,
      rounds.map((round) => ({ roundId: round.roundId, records: round[name] }))
    );
  return {
    ...base,
    collections: { ...base.collections, debates: merge("debates"), ballots: merge("ballots") },
    loadedRoundIds: Object.keys(hashes),
  };
}
