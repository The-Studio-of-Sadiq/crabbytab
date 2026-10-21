import type { MetadataRoute } from "next";
import { PUBLIC_SUBPAGE_SECTION_NAMES, TOURNAMENT_STAFF_SECTIONS } from "@/lib/tournamentRoutes";

/** Signed-in and staff-only pages outside a tournament. */
export const PRIVATE_SITE_PATHS = [
  "/api/",
  // Longer than the `/*/public/` Allow, which would otherwise reopen the public JSON API.
  "/api/public/",
  "/login",
  "/invite",
  "/account",
  "/forgot-password",
  "/tournaments/new",
  "/tournaments/import",
  "/tournaments/demo",
] as const;

/**
 * robots.txt rules. Crawlers resolve conflicts by the most specific (longest) matching rule
 * (RFC 9309 §2.2.2, Google, Bing), and `*` also matches `/`, so `/*\/feedback` would block the
 * public `/{slug}/public/feedback` as well. Each disallowed staff section therefore gets a longer
 * Allow for its public twin (`/*\/public/feedback`), and the sections with a public sub-page
 * (`/{slug}/schedule/public`) get an Allow for it. robots.txt only steers crawling: staff pages
 * also carry `noindex, nofollow` metadata (`[tournamentSlug]/layout.tsx`).
 *
 * The bare tab-room home `/{slug}` cannot be expressed without blocking every page, so it relies
 * on that metadata alone. `/*\/api` also matches the API reference page `/tournaments/api`.
 */
export function buildRobotsRules(siteUrl: string): MetadataRoute.Robots {
  const allow = [
    "/",
    "/*/public$",
    "/*/public/",
    ...TOURNAMENT_STAFF_SECTIONS.map((section) => `/*/public/${section}`),
    ...PUBLIC_SUBPAGE_SECTION_NAMES.map((section) => `/*/${section}/public`),
  ];
  const disallow = [
    ...PRIVATE_SITE_PATHS,
    "/*/private/",
    "/*/display",
    ...TOURNAMENT_STAFF_SECTIONS.map((section) => `/*/${section}`),
  ];
  return {
    rules: [{ userAgent: "*", allow, disallow }],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

/**
 * Whether `path` may be crawled under `rules`, by RFC 9309 matching: the longest matching rule
 * wins and Allow wins a tie. Used by tests to check the generated rules against real routes.
 */
export function robotsAllows(rules: { allow: readonly string[]; disallow: readonly string[] }, path: string): boolean {
  let best: { length: number; allow: boolean } | null = null;
  const consider = (patterns: readonly string[], allow: boolean) => {
    for (const pattern of patterns) {
      if (!robotsPatternMatches(pattern, path)) continue;
      if (!best || pattern.length > best.length || (pattern.length === best.length && allow)) {
        best = { length: pattern.length, allow };
      }
    }
  };
  consider(rules.allow, true);
  consider(rules.disallow, false);
  return best === null ? true : (best as { allow: boolean }).allow;
}

function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}
