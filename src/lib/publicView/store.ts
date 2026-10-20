import { AggregateField, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { revalidateTag, unstable_cache } from "next/cache";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import type { Tournament } from "@/types";
import {
  needsPublicFeedback,
  PUBLIC_SOURCE_COLLECTIONS,
  type PublicSourceData,
  type SourceRecord,
} from "@/lib/publicView/projection";
import {
  buildPublicViewRoot,
  buildPublicViewSections,
  canSkipPublish,
  changedSections,
  chunkDocumentId,
  parseSectionChunks,
  hasRoundSections,
  publicSourceToken,
  roundSectionName,
  sectionRoundIds,
  splitByRound,
  type PublicBaseSection,
  type PublicRoundContent,
  type PublicSourceStats,
  type PublicViewRoot,
  type PublicViewSections,
} from "@/lib/publicView/snapshot";
import { hashValue } from "@/lib/publicView/hash";

/**
 * Server-side storage and caching for published public views.
 *
 * Layout: `publicViews/{slug}` holds a PublicViewRoot; `publicViews/{slug}/chunks/{section}-{hash}-{i}`
 * holds section JSON (base sections, plus one `round-{roundId}` section per public round). Readers
 * go through the Vercel Data Cache: the root is tagged and invalidated on publish, while section
 * chunks are content-addressed and cached by hash, one cache entry per section, so each entry stays
 * far below the 2 MB entry limit and a cache miss costs one read per section.
 */

export const PUBLIC_VIEWS_COLLECTION = "publicViews";
const CHUNKS_COLLECTION = "chunks";
const SLUG_PATTERN = /^[a-z0-9-]{1,40}$/;
const ROOT_REVALIDATE_SECONDS = 3600;
const SECTION_REVALIDATE_SECONDS = 86_400;
const LIVE_FALLBACK_REVALIDATE_SECONDS = 300;

export function publicViewTag(slug: string): string {
  return `public-view:${slug}`;
}

export function isValidPublicSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export class PublicViewError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Source collections a publish reads: feedback only when a public feature aggregates it. */
function sourceCollectionsFor(tournamentData: Record<string, unknown>): string[] {
  const preferences = tournamentData.preferences as Partial<Tournament["preferences"]> | undefined;
  return needsPublicFeedback(preferences) ? [...PUBLIC_SOURCE_COLLECTIONS, "feedback"] : [...PUBLIC_SOURCE_COLLECTIONS];
}

export async function readPublicSourceData(
  tournamentRef: DocumentReference,
  tournamentData: Record<string, unknown> = {}
): Promise<PublicSourceData> {
  const collections = sourceCollectionsFor(tournamentData);
  const snapshots = await Promise.all(
    collections.map((name) => tournamentRef.collection(name).get())
  );
  return Object.fromEntries(
    collections.map((name, index) => [
      name,
      snapshots[index].docs
        .filter((document) => typeof document.data().deletedAt !== "string")
        .map((document) => ({ ...document.data(), id: document.id }) as SourceRecord),
    ])
  ) as PublicSourceData;
}

/** Aggregates of every source collection; see `PublicSourceCollectionStats`. */
export async function readPublicSourceStats(
  tournamentRef: DocumentReference,
  tournamentData: Record<string, unknown> = {}
): Promise<PublicSourceStats> {
  const collections = sourceCollectionsFor(tournamentData);
  const results = await Promise.all(
    collections.map((name) =>
      tournamentRef
        .collection(name)
        .aggregate({
          count: AggregateField.count(),
          versionSum: AggregateField.sum("syncVersion"),
          ...(name === "ballots" ? { ballotVersionSum: AggregateField.sum("version") } : {}),
        })
        .get()
    )
  );
  return Object.fromEntries(
    collections.map((name, index) => {
      const data = results[index].data() as { count: number; versionSum: number; ballotVersionSum?: number };
      return [
        name,
        {
          count: data.count,
          versionSum: Number(data.versionSum) || 0,
          ...(name === "ballots" ? { ballotVersionSum: Number(data.ballotVersionSum) || 0 } : {}),
        },
      ];
    })
  );
}

export interface PublishResult {
  status: "published" | "unchanged";
  slug: string;
  version: string;
  changedSections: string[];
}

/**
 * Rebuilds the public view of a tournament from Firestore and stores it. The rebuild (a full read
 * of every source collection) is skipped only when nothing public changed on the publishing device
 * (its fingerprint matches the last publish) and nothing changed in the cloud either (the source
 * token, from aggregation queries, matches); see `canSkipPublish`.
 */
export async function publishPublicView(input: {
  tournamentId: string;
  clientFingerprint?: string;
  force?: boolean;
  firestore?: Firestore;
}): Promise<PublishResult> {
  const firestore = input.firestore || getAdminFirestore();
  const tournamentRef = firestore.collection("tournaments").doc(input.tournamentId);
  const tournamentSnapshot = await tournamentRef.get();
  if (!tournamentSnapshot.exists) throw new PublicViewError("Tournament not found.", 404);
  const tournamentData = tournamentSnapshot.data() as Record<string, unknown>;
  const slug = tournamentData.slug;
  if (typeof slug !== "string" || !isValidPublicSlug(slug)) {
    throw new PublicViewError("This tournament needs a valid slug before it can be published.", 400);
  }

  const rootRef = firestore.collection(PUBLIC_VIEWS_COLLECTION).doc(slug);
  const [slugReservation, rootSnapshot] = await Promise.all([
    firestore.collection("tournamentSlugs").doc(slug).get(),
    rootRef.get(),
  ]);
  const reservedFor = slugReservation.exists ? slugReservation.data()?.tournamentId : undefined;
  if (reservedFor && reservedFor !== input.tournamentId) {
    throw new PublicViewError("This tournament slug is reserved by another tournament.", 409);
  }
  const previousRoot = rootSnapshot.exists ? (rootSnapshot.data() as PublicViewRoot) : null;
  if (previousRoot && previousRoot.tournamentId !== input.tournamentId && reservedFor !== input.tournamentId) {
    throw new PublicViewError("Another tournament has already published under this slug.", 409);
  }
  const ownPreviousRoot = previousRoot?.tournamentId === input.tournamentId ? previousRoot : null;

  const sourceToken = publicSourceToken(tournamentData, await readPublicSourceStats(tournamentRef, tournamentData));
  if (ownPreviousRoot && canSkipPublish(ownPreviousRoot, { ...input, sourceToken })) {
    return { status: "unchanged", slug, version: ownPreviousRoot.version, changedSections: [] };
  }

  const source = await readPublicSourceData(tournamentRef, tournamentData);
  const sections = buildPublicViewSections({ ...tournamentData, id: input.tournamentId }, source);
  const { root, chunks } = buildPublicViewRoot({
    tournamentId: input.tournamentId,
    slug,
    sections,
    clientFingerprint: input.clientFingerprint,
    sourceToken,
    publishedAt: new Date().toISOString(),
  });
  const changed = changedSections(ownPreviousRoot, root);
  const chunksRef = rootRef.collection(CHUNKS_COLLECTION);

  // 1. Write new content-addressed chunks. One batch per section keeps each request well below
  //    Firestore's 10 MiB batch limit.
  for (const section of changed) {
    const batch = firestore.batch();
    chunks[section].forEach((json, index) => {
      batch.set(chunksRef.doc(chunkDocumentId(section, root.sections[section].hash, index)), {
        section,
        index,
        json,
      });
    });
    await batch.commit();
  }

  // 2. Point the root at them. Readers switch over atomically.
  await rootRef.set(root);

  // 3. Remove chunks the new root no longer references (including a previous owner's, if the slug
  //    moved to this tournament).
  const staleRoot = ownPreviousRoot || previousRoot;
  if (staleRoot) {
    const cleanup = firestore.batch();
    let deletions = 0;
    for (const [section, before] of Object.entries(staleRoot.sections || {})) {
      const after = root.sections[section];
      if (after && before.hash === after.hash && before.chunks === after.chunks) continue;
      for (let index = 0; index < before.chunks; index += 1) {
        cleanup.delete(chunksRef.doc(chunkDocumentId(section, before.hash, index)));
        deletions += 1;
      }
    }
    if (deletions > 0) await cleanup.commit();
  }

  // 4. If the tournament was published under an older slug, retire that view.
  const formerViews = await firestore
    .collection(PUBLIC_VIEWS_COLLECTION)
    .where("tournamentId", "==", input.tournamentId)
    .get();
  for (const document of formerViews.docs) {
    if (document.id === slug) continue;
    await firestore.recursiveDelete(document.ref);
    revalidateTag(publicViewTag(document.id));
  }

  revalidateTag(publicViewTag(slug));
  return { status: "published", slug, version: root.version, changedSections: changed };
}

const readRootCached = (slug: string) =>
  unstable_cache(
    async (): Promise<PublicViewRoot | null> => {
      const snapshot = await getAdminFirestore().collection(PUBLIC_VIEWS_COLLECTION).doc(slug).get();
      return snapshot.exists ? (snapshot.data() as PublicViewRoot) : null;
    },
    ["public-view-root", slug],
    { tags: [publicViewTag(slug)], revalidate: ROOT_REVALIDATE_SECONDS }
  )();

const readSectionCached = (slug: string, section: string, hash: string, chunkCount: number) =>
  unstable_cache(
    async (): Promise<unknown> => {
      const firestore = getAdminFirestore();
      const chunksRef = firestore.collection(PUBLIC_VIEWS_COLLECTION).doc(slug).collection(CHUNKS_COLLECTION);
      const refs = Array.from({ length: chunkCount }, (_, index) =>
        chunksRef.doc(chunkDocumentId(section, hash, index))
      );
      const documents = await firestore.getAll(...refs);
      const parts = documents.map((document) => document.data()?.json);
      if (parts.some((part) => typeof part !== "string")) {
        throw new PublicViewError("Published data is being updated. Try again shortly.", 503);
      }
      return parseSectionChunks(parts as string[]);
    },
    ["public-view-section", slug, section, hash, String(chunkCount)],
    { revalidate: SECTION_REVALIDATE_SECONDS }
  )();

type LiveFallback =
  | { ok: true; sections: PublicViewSections }
  | { ok: false; status: number; error: string };

/**
 * Tournaments that have not been published since public views were introduced are built straight
 * from their collections. The result is cached and invalidated by the first publish.
 */
const readLiveFallbackCached = (slug: string) =>
  unstable_cache(
    async (): Promise<LiveFallback> => {
      const firestore = getAdminFirestore();
      const matches = await firestore.collection("tournaments").where("slug", "==", slug).limit(2).get();
      if (matches.docs.length > 1) {
        return {
          ok: false,
          status: 409,
          error: "This tournament slug is ambiguous. Contact a tournament administrator.",
        };
      }
      const tournamentDocument = matches.docs[0];
      if (!tournamentDocument) return { ok: false, status: 404, error: "Tournament not found." };
      const source = await readPublicSourceData(tournamentDocument.ref, tournamentDocument.data());
      return {
        ok: true,
        sections: buildPublicViewSections({ ...tournamentDocument.data(), id: tournamentDocument.id }, source),
      };
    },
    ["public-view-live", slug],
    { tags: [publicViewTag(slug)], revalidate: LIVE_FALLBACK_REVALIDATE_SECONDS }
  )();

/**
 * One published view, however it is stored: a current root (sections read on demand, each from its
 * own cache entry), a root published before rounds had their own sections (its whole-tournament
 * debates and ballots are split per round when read), or a tournament never published (built live).
 */
export interface PublicViewReader {
  version: string;
  /** Hash of each public round's section, by round id (also a content address for CDN caching). */
  roundHashes: Record<string, string>;
  readBase(section: PublicBaseSection): Promise<unknown>;
  /** Undefined when the round has no public section. */
  readRound(roundId: string): Promise<PublicRoundContent | undefined>;
}

function readerFromSections(version: string, sections: PublicViewSections): PublicViewReader {
  return {
    version,
    roundHashes: Object.fromEntries(
      sectionRoundIds(sections).map((roundId) => [roundId, hashValue(sections[roundSectionName(roundId)])])
    ),
    readBase: async (section) => sections[section],
    readRound: async (roundId) => sections[roundSectionName(roundId)],
  };
}

export async function getPublicViewReader(slug: string): Promise<PublicViewReader> {
  if (!isValidPublicSlug(slug)) throw new PublicViewError("Tournament not found.", 404);
  const root = await readRootCached(slug);
  if (!root) {
    const fallback = await readLiveFallbackCached(slug);
    if (!fallback.ok) throw new PublicViewError(fallback.error, fallback.status);
    return readerFromSections(hashValue(fallback.sections), fallback.sections);
  }
  const readSection = (section: string) => {
    const meta = root.sections[section];
    return meta ? readSectionCached(slug, section, meta.hash, meta.chunks) : Promise.resolve(undefined);
  };
  if (hasRoundSections(root)) {
    return {
      version: root.version,
      roundHashes: Object.fromEntries(
        (root.roundIds || []).flatMap((roundId) => {
          const meta = root.sections[roundSectionName(roundId)];
          return meta ? [[roundId, meta.hash]] : [];
        })
      ),
      readBase: (section) => readSection(section),
      readRound: async (roundId) => (await readSection(roundSectionName(roundId))) as PublicRoundContent | undefined,
    };
  }
  // Published before per-round sections: republishing converts it.
  const [rounds, debates, ballots] = await Promise.all([readSection("rounds"), readSection("debates"), readSection("ballots")]);
  const roundIds = ((rounds as Array<{ id?: unknown }> | undefined) || []).map((round) => String(round.id));
  const byRound = splitByRound(
    roundIds,
    (debates as Record<string, unknown>[] | undefined) || [],
    (ballots as Record<string, unknown>[] | undefined) || []
  );
  return {
    version: root.version,
    roundHashes: Object.fromEntries([...byRound].map(([roundId, content]) => [roundId, hashValue(content)])),
    readBase: (section) => readSection(section),
    readRound: async (roundId) => byRound.get(roundId),
  };
}

export async function getPublicSections(
  slug: string,
  wanted: readonly PublicBaseSection[]
): Promise<{ version: string; sections: Partial<Record<PublicBaseSection, unknown>> }> {
  const reader = await getPublicViewReader(slug);
  const values = await Promise.all(wanted.map((section) => reader.readBase(section)));
  return {
    version: reader.version,
    sections: Object.fromEntries(wanted.map((section, index) => [section, values[index]])),
  };
}

export async function getPublicViewVersion(slug: string): Promise<string> {
  if (!isValidPublicSlug(slug)) throw new PublicViewError("Tournament not found.", 404);
  const root = await readRootCached(slug);
  if (root) return root.version;
  const fallback = await readLiveFallbackCached(slug);
  if (!fallback.ok) throw new PublicViewError(fallback.error, fallback.status);
  return hashValue(fallback.sections);
}

/** Shared-cache headers: the CDN absorbs refresh storms; browsers always revalidate. */
export function publicCacheHeaders(sMaxAge: number, staleWhileRevalidate: number): Record<string, string> {
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
  };
}
