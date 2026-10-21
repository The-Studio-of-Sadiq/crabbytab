import type { MetadataRoute } from "next";
import { publicSitemapEntries } from "@/lib/publicView/seo";
import { getSitemapSources } from "@/lib/publicView/sitemapStore";
import { resolveSiteUrl } from "@/lib/seo/site";

/**
 * Rendered per request so a build without admin credentials does not bake in an empty sitemap;
 * the Firestore data comes from a six-hour cache (lib/publicView/sitemapStore.ts).
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = resolveSiteUrl();
  return [
    { url: `${siteUrl}/`, changeFrequency: "weekly", priority: 1 },
    ...publicSitemapEntries(await getSitemapSources(), siteUrl),
  ];
}
