import type { Metadata } from "next";
import { buildPublicPageMetadata, buildPublicSeoSummary } from "@/lib/publicView/seo";
import { NOINDEX_ROBOTS } from "@/lib/seo/site";
import { getPublicSections, PublicViewError } from "@/lib/publicView/store";

export interface PublicPageOptions {
  /** The public tab itself (the homepage for the "homepage only" indexing setting). */
  homepage: boolean;
  /** The page's path, e.g. `/open/schedule/public`; used as the canonical and Open Graph URL. */
  path: string;
  /** Page name shown before the tournament name in the title, e.g. "Schedule". */
  page?: string;
}

/**
 * Metadata for a public page: title, description, canonical URL, Open Graph / Twitter cards and
 * robots under the tournament's search-engine setting (Tabbycat search_engine_indexing). Reads the
 * cached public projection only (no Firestore read of its own beyond that cache).
 *
 * Robots is always explicit because the tournament layout defaults to `noindex` for the tab room.
 * An unknown tournament is `noindex`; any other read failure keeps the page indexable, like a page
 * with no setting, so a transient error does not drop a tournament from search results.
 */
export async function publicPageMetadata(slug: string, options: PublicPageOptions): Promise<Metadata> {
  try {
    const { sections } = await getPublicSections(slug, ["tournament"]);
    return buildPublicPageMetadata({ seo: buildPublicSeoSummary(sections.tournament), ...options });
  } catch (error) {
    if (error instanceof PublicViewError && error.status === 404) return { robots: NOINDEX_ROBOTS };
    return { robots: { index: true, follow: true } };
  }
}

/** Path of a public page of a tournament (the slug is URL-encoded). */
export function publicPagePath(slug: string, ...segments: string[]): string {
  return `/${[slug, ...segments].map(encodeURIComponent).join("/")}`;
}
