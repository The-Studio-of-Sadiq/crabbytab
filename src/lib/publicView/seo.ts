import type { Metadata, MetadataRoute } from "next";
import { getPublicSiteSettings, robotsForPublicPage } from "@/lib/publicFeatures";
import { firstParagraphText } from "@/lib/markdown/plainText";
import { SITE_NAME, SITE_OG_IMAGE } from "@/lib/seo/site";
import type { SearchEngineIndexing, Tournament } from "@/types";

/**
 * Search-engine and link-preview data of a published tournament. Pure: built from the public
 * `tournament` section only, so it never needs a Firestore read of its own.
 */
export interface PublicSeoSummary {
  name: string;
  indexing: SearchEngineIndexing;
  /** The public schedule page is on (`preferences.publicSchedule`). */
  schedule: boolean;
  /** The public check-in status page is on (`preferences.publicCheckInStatus`). */
  checkins: boolean;
  /** Plain-text summary for `description` / `og:description`. */
  description: string;
}

const DESCRIPTION_MAX_LENGTH = 160;

/** Collapses whitespace and shortens to a word boundary, ending in an ellipsis when cut. */
export function shortDescription(text: string, maxLength = DESCRIPTION_MAX_LENGTH): string {
  const plain = text.replace(/\s+/g, " ").trim();
  if (plain.length <= maxLength) return plain;
  const cut = plain.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

export function buildPublicSeoSummary(tournamentSection: unknown): PublicSeoSummary {
  const tournament = (tournamentSection && typeof tournamentSection === "object" ? tournamentSection : {}) as Partial<Tournament>;
  const preferences = tournament.preferences;
  const settings = getPublicSiteSettings(preferences);
  const name = typeof tournament.name === "string" && tournament.name.trim() ? tournament.name.trim() : "Tournament";
  return {
    name,
    indexing: settings.searchEngineIndexing,
    schedule: preferences?.publicSchedule === true,
    checkins: preferences?.publicCheckInStatus === true,
    // What the Home tab shows first: the homepage's first paragraph (as plain text), else the
    // welcome message (plain text already, see getPublicSiteSettings).
    description:
      shortDescription(firstParagraphText(settings.homepage)) ||
      shortDescription(settings.welcomeMessage) ||
      `Public draws, motions and results of ${name}, published with ${SITE_NAME}.`,
  };
}

/** A published root as the sitemap needs it. */
export interface PublicSitemapSource {
  slug: string;
  publishedAt?: string;
  seo: PublicSeoSummary;
}

/**
 * Sitemap entries of published tournaments: none under "none", the public tab under
 * "homepage-only", and the public tab plus the switched-on public sub-pages under "all".
 * Sorted by slug so the output is stable.
 */
export function publicSitemapEntries(sources: readonly PublicSitemapSource[], siteUrl: string): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];
  for (const source of [...sources].sort((a, b) => a.slug.localeCompare(b.slug))) {
    if (source.seo.indexing === "none") continue;
    const base = `${siteUrl}/${encodeURIComponent(source.slug)}`;
    const published = source.publishedAt ? new Date(source.publishedAt) : undefined;
    const lastModified = published && !Number.isNaN(published.getTime()) ? published : undefined;
    const entry = (url: string, priority: number): MetadataRoute.Sitemap[number] => ({
      url,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: "hourly",
      priority,
    });
    entries.push(entry(`${base}/public`, 0.8));
    if (source.seo.indexing !== "all") continue;
    if (source.seo.schedule) entries.push(entry(`${base}/schedule/public`, 0.5));
    if (source.seo.checkins) entries.push(entry(`${base}/checkins/public`, 0.3));
  }
  return entries;
}

/**
 * Metadata of one public page: title, description, canonical URL, Open Graph and Twitter cards,
 * and robots under the tournament's search-engine setting. Robots is always explicit, because the
 * tournament layout above public pages defaults to `noindex` for the tab room.
 */
export function buildPublicPageMetadata(input: {
  seo: PublicSeoSummary;
  /** Path of the page, e.g. `/open/public` (resolved against `metadataBase`). */
  path: string;
  /** The public tab itself (the homepage for "homepage-only"). */
  homepage: boolean;
  /** Page name shown before the tournament name, e.g. "Schedule". */
  page?: string;
}): Metadata {
  const title = input.page ? `${input.page} · ${input.seo.name}` : input.seo.name;
  const fullTitle = `${title} | ${SITE_NAME}`;
  const robots = robotsForPublicPage(input.seo.indexing, input.homepage);
  return {
    title: fullTitle,
    description: input.seo.description,
    alternates: { canonical: input.path },
    robots: { index: robots.index, follow: robots.follow },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description: input.seo.description,
      url: input.path,
      images: [SITE_OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: input.seo.description,
      images: [SITE_OG_IMAGE.url],
    },
  };
}
