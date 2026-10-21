import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRobotsRules, robotsAllows } from "@/lib/seo/robotsRules";
import { TOURNAMENT_STAFF_SECTIONS } from "@/lib/tournamentRoutes";
import { resolveSiteUrl } from "@/lib/seo/site";

const robots = buildRobotsRules("https://tab.example.org");
const rule = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;
const lists = {
  allow: ([] as string[]).concat(rule.allow ?? []),
  disallow: ([] as string[]).concat(rule.disallow ?? []),
};
const allows = (url: string) => robotsAllows(lists, url);

describe("buildRobotsRules", () => {
  it("points to the sitemap and applies to every crawler", () => {
    expect(robots.sitemap).toBe("https://tab.example.org/sitemap.xml");
    expect(rule.userAgent).toBe("*");
  });

  it("allows the public site", () => {
    for (const url of [
      "/",
      "/tournaments",
      "/tournaments/motions/public",
      "/open/public",
      "/open/public?tab=draw",
      "/open/public/team/t1",
      "/open/public/adjudicator/a1",
      "/open/public/feedback",
      "/open/public/ballots",
      "/open/schedule/public",
      "/open/checkins/public",
      "/open/audit/public",
      "/register/open",
      // Tournament slugs that collide with section names.
      "/draw/public",
      "/schedule/public",
      "/public/public",
    ]) {
      expect(allows(url), url).toBe(true);
    }
  });

  it("disallows the API, sign-in, staff tools, private URLs and every tab-room section", () => {
    for (const url of [
      "/api/v1/tournaments",
      "/api/public/tournaments/open",
      "/api/public/tournaments/open/schedule/ical",
      "/api/public/tournaments/open/audit",
      "/login",
      "/invite?token=x",
      "/account/password",
      "/forgot-password",
      "/tournaments/new",
      "/tournaments/import",
      "/tournaments/demo",
      "/open/private/team/key123",
      "/open/display",
      "/open/schedule",
      "/open/checkins",
      "/open/audit",
      "/public/draw",
      ...TOURNAMENT_STAFF_SECTIONS.map((section) => `/open/${section}`),
      "/open/imports/teams",
      "/open/allocation/panels",
    ]) {
      expect(allows(url), url).toBe(false);
    }
  });

  it("covers every staff route folder under [tournamentSlug]", () => {
    const folder = path.join(process.cwd(), "src", "app", "[tournamentSlug]");
    const sections = readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !["public", "private", "display"].includes(name))
      .sort();
    expect([...TOURNAMENT_STAFF_SECTIONS].sort()).toEqual(sections);
  });
});

describe("robotsAllows", () => {
  it("prefers the longest rule and Allow on a tie, and honours $", () => {
    expect(robotsAllows({ allow: ["/a/b"], disallow: ["/a"] }, "/a/b/c")).toBe(true);
    expect(robotsAllows({ allow: ["/a"], disallow: ["/a/b"] }, "/a/b/c")).toBe(false);
    expect(robotsAllows({ allow: ["/a"], disallow: ["/a"] }, "/a")).toBe(true);
    expect(robotsAllows({ allow: ["/*/x$"], disallow: ["/"] }, "/q/x")).toBe(true);
    expect(robotsAllows({ allow: ["/*/x$"], disallow: ["/"] }, "/q/x/y")).toBe(false);
    expect(robotsAllows({ allow: [], disallow: [] }, "/anything")).toBe(true);
  });
});

describe("resolveSiteUrl", () => {
  it("prefers NEXT_PUBLIC_APP_URL, then the Vercel URL, then localhost, without a trailing slash", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_APP_URL: "https://tab.example.org/", VERCEL_URL: "x.vercel.app" })).toBe(
      "https://tab.example.org"
    );
    expect(resolveSiteUrl({ VERCEL_URL: "x.vercel.app" })).toBe("https://x.vercel.app");
    expect(resolveSiteUrl({})).toBe("http://localhost:3000");
  });
});
