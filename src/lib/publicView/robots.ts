import type { Metadata } from "next";
import { getPublicSiteSettings, robotsForPublicPage } from "@/lib/publicFeatures";
import { getPublicSections } from "@/lib/publicView/store";
import type { Tournament } from "@/types";

/**
 * Robots metadata for a public page under the tournament's search-engine setting (Tabbycat
 * search_engine_indexing). Reads the cached public projection only. When the tournament cannot
 * be read the page keeps the default (indexable), like a page with no setting.
 */
export async function publicRobotsMetadata(slug: string, homepage: boolean): Promise<Metadata> {
  try {
    const { sections } = await getPublicSections(slug, ["tournament"]);
    const preferences = (sections.tournament as Partial<Tournament> | undefined)?.preferences;
    const robots = robotsForPublicPage(getPublicSiteSettings(preferences).searchEngineIndexing, homepage);
    return robots.index ? {} : { robots: { index: false, follow: false } };
  } catch {
    return {};
  }
}
