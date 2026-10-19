import { AggregateField, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { revalidateTag, unstable_cache } from "next/cache";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
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
  PUBLIC_VIEW_SECTIONS,
  publicSourceToken,
  type PublicSourceStats,
  type PublicViewRoot,
  type PublicViewSection,
  type PublicViewSections,
} from "@/lib/publicView/snapshot";
import { hashValue } from "@/lib/publicView/hash";

/**
 * Server-side storage and caching for published public views.
 *
 * Layout: `publicViews/{slug}` holds a PublicViewRoot; `publicViews/{slug}/chunks/{section}-{hash}-{i}`
 * holds section JSON. Readers go through the Vercel Data Cache: the root is tagged and invalidated
 * on publish, while section chunks are content-addressed and cached by hash, so a cache miss on a
 * published tournament costs one read per section rather than a scan of every collection.
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

export async function readPublicSourceData(tournamentRef: DocumentReference): Promise<PublicSourceData> {
  const snapshots = await Promise.all(
    PUBLIC_SOURCE_COLLECTIONS.map((name) => tournamentRef.collection(name).get())
  );
  return Object.fromEntries(
    PUBLIC_SOURCE_COLLECTIONS.map((name, index) => [
      name,
      snapshots[index].docs
        .filter((document) => typeof document.data().deletedAt !== "string")
        .map((document) => ({ ...document.data(), id: document.id }) as SourceRecord),
    ])
  ) as PublicSourceData;
}

/** Aggregates of every source collection; see `PublicSourceCollectionStats`. */
export async function readPublicSourceStats(tournamentRef: DocumentReference): Promise<PublicSourceStats> {
  const results = await Promise.all(
    PUBLIC_SOURCE_COLLECTIONS.map((name) =>
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
    PUBLIC_SOURCE_COLLECTIONS.map((name, index) => {
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
  changedSections: PublicViewSection[];
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

  const sourceToken = publicSourceToken(tournamentData, await readPublicSourceStats(tournamentRef));
  if (ownPreviousRoot && canSkipPublish(ownPreviousRoot, { ...input, sourceToken })) {
    return { status: "unchanged", slug, version: ownPreviousRoot.version, changedSections: [] };
  }

  const source = await readPublicSourceData(tournamentRef);
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
    for (const section of PUBLIC_VIEW_SECTIONS) {
      const before = staleRoot.sections?.[section];
      if (!before) continue;
      const after = root.sections[section];
      if (before.hash === after.hash && before.chunks === after.chunks) continue;
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

const readSectionCached = (slug: string, section: PublicViewSection, hash: string, chunkCount: number) =>
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
      const source = await readPublicSourceData(tournamentDocument.ref);
      return {
        ok: true,
        sections: buildPublicViewSections({ ...tournamentDocument.data(), id: tournamentDocument.id }, source),
      };
    },
    ["public-view-live", slug],
    { tags: [publicViewTag(slug)], revalidate: LIVE_FALLBACK_REVALIDATE_SECONDS }
  )();

export interface PublicSectionsResult {
  version: string;
  sections: Partial<PublicViewSections>;
}

export async function getPublicSections(
  slug: string,
  wanted: readonly PublicViewSection[]
): Promise<PublicSectionsResult> {
  if (!isValidPublicSlug(slug)) throw new PublicViewError("Tournament not found.", 404);
  const root = await readRootCached(slug);
  if (root) {
    const values = await Promise.all(
      wanted.map((section) => {
        const meta = root.sections[section];
        return meta ? readSectionCached(slug, section, meta.hash, meta.chunks) : Promise.resolve(undefined);
      })
    );
    return {
      version: root.version,
      sections: Object.fromEntries(wanted.map((section, index) => [section, values[index]])),
    };
  }
  const fallback = await readLiveFallbackCached(slug);
  if (!fallback.ok) throw new PublicViewError(fallback.error, fallback.status);
  return {
    version: hashValue(fallback.sections),
    sections: Object.fromEntries(wanted.map((section) => [section, fallback.sections[section]])),
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
