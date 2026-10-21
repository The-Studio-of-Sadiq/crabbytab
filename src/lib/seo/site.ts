/**
 * Site-wide constants for search engines and link previews (root layout, robots.txt, sitemap and
 * public-page metadata share them).
 */

export const SITE_NAME = "CrabbyTab";
export const SITE_DESCRIPTION =
  "Free, serverless debate tournament tabulation inspired by Tabbycat: draws, adjudicator allocation, results, standings and public tournament pages.";
export const SITE_OG_IMAGE = { url: "/og-image.png", width: 1254, height: 834, alt: SITE_NAME } as const;

/** Staff, sign-in and private pages: never indexed, links not followed. */
export const NOINDEX_ROBOTS = { index: false, follow: false } as const;
export const NOINDEX_METADATA = { robots: NOINDEX_ROBOTS } as const;

/**
 * The deployment's absolute origin, without a trailing slash: `NEXT_PUBLIC_APP_URL`, else the
 * Vercel deployment URL, else the local dev server.
 */
export function resolveSiteUrl(env: Record<string, string | undefined> = process.env): string {
  const url =
    env.NEXT_PUBLIC_APP_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "http://localhost:3000");
  return url.replace(/\/+$/, "");
}
