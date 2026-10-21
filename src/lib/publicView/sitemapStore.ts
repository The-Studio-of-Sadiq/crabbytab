import { unstable_cache } from "next/cache";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore, hasAdminCredentials } from "@/lib/firebaseAdmin";
import { buildPublicSeoSummary, type PublicSitemapSource } from "@/lib/publicView/seo";
import type { PublicViewRoot } from "@/lib/publicView/snapshot";
import { isValidPublicSlug, PUBLIC_VIEWS_COLLECTION, readPublishedTournamentSection } from "@/lib/publicView/store";

/**
 * Six hours: a crawler fetching the sitemap repeatedly costs at most one read per published
 * tournament per six hours (four per day), well inside the Spark plan's 50k reads per day. Publishes
 * deliberately do not invalidate it, since busy tournaments publish every few minutes and each
 * invalidation would re-read every root. The tag allows a manual refresh.
 */
const SITEMAP_REVALIDATE_SECONDS = 6 * 60 * 60;
export const PUBLIC_SITEMAP_TAG = "public-sitemap";
/** A sitemap holds at most 50,000 URLs; each tournament contributes up to three. */
const MAX_TOURNAMENTS = 15_000;

type RootFields = Partial<Pick<PublicViewRoot, "slug" | "publishedAt" | "seo" | "sections">>;

/**
 * Sitemap sources from public view roots. Roots published before `seo` was stored fall back to
 * their (cached) tournament section; roots without either are left out.
 */
export async function sitemapSourcesFromRoots(
  roots: ReadonlyArray<{ id: string; data: RootFields }>,
  readTournamentSection: (root: Pick<PublicViewRoot, "slug" | "sections">) => Promise<unknown>
): Promise<PublicSitemapSource[]> {
  const sources = await Promise.all(
    roots.map(async ({ id, data }): Promise<PublicSitemapSource | null> => {
      const slug = typeof data.slug === "string" ? data.slug : id;
      if (!isValidPublicSlug(slug)) return null;
      const publishedAt = typeof data.publishedAt === "string" ? data.publishedAt : undefined;
      if (data.seo) return { slug, publishedAt, seo: data.seo };
      if (!data.sections?.tournament) return null;
      const tournament = await readTournamentSection({ slug, sections: data.sections });
      return tournament ? { slug, publishedAt, seo: buildPublicSeoSummary(tournament) } : null;
    })
  );
  return sources.filter((source): source is PublicSitemapSource => source !== null);
}

export async function readSitemapSources(firestore: Firestore): Promise<PublicSitemapSource[]> {
  // Only the fields the sitemap needs leave Firestore (reads are billed per document either way).
  const snapshot = await firestore
    .collection(PUBLIC_VIEWS_COLLECTION)
    .select("slug", "publishedAt", "seo", "sections.tournament")
    .limit(MAX_TOURNAMENTS)
    .get();
  return sitemapSourcesFromRoots(
    snapshot.docs.map((document) => ({ id: document.id, data: document.data() as RootFields })),
    readPublishedTournamentSection
  );
}

const readSitemapSourcesCached = unstable_cache(
  () => readSitemapSources(getAdminFirestore()),
  ["public-sitemap-sources"],
  { tags: [PUBLIC_SITEMAP_TAG], revalidate: SITEMAP_REVALIDATE_SECONDS }
);

/**
 * Published tournaments for the sitemap; empty (never an error) without admin credentials or when
 * Firestore cannot be read, so a crawler always gets a valid sitemap.
 */
export async function getSitemapSources(): Promise<PublicSitemapSource[]> {
  if (!hasAdminCredentials()) return [];
  try {
    return await readSitemapSourcesCached();
  } catch (error) {
    console.error("Sitemap: published tournaments could not be read.", error instanceof Error ? error.message : error);
    return [];
  }
}
