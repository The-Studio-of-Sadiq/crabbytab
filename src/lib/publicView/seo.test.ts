import { describe, expect, it, vi } from "vitest";
import {
  buildPublicPageMetadata,
  buildPublicSeoSummary,
  publicSitemapEntries,
  shortDescription,
  type PublicSeoSummary,
} from "@/lib/publicView/seo";
import { buildPublicViewRoot, buildPublicViewSections } from "@/lib/publicView/snapshot";

const summary = (overrides: Partial<PublicSeoSummary> = {}): PublicSeoSummary => ({
  name: "Open",
  indexing: "all",
  schedule: false,
  checkins: false,
  description: "Welcome",
  ...overrides,
});

describe("buildPublicSeoSummary", () => {
  it("reads the name, indexing, public sub-pages and welcome message", () => {
    expect(
      buildPublicSeoSummary({
        name: " Winter Open ",
        preferences: {
          searchEngineIndexing: "homepage-only",
          publicSchedule: true,
          publicCheckInStatus: false,
          welcomeMessage: "  Welcome   to the\nWinter Open!  ",
        },
      })
    ).toEqual({
      name: "Winter Open",
      indexing: "homepage-only",
      schedule: true,
      checkins: false,
      description: "Welcome to the Winter Open!",
    });
  });

  it("describes the page with the public homepage's first paragraph, as plain text", () => {
    const preferences = {
      welcomeMessage: "Welcome!",
      publicHomepage: "# The Winter Open\n\n![Logo](https://example.org/logo.png)\n\nThe **Winter Open** is a [BP](https://example.org/bp) tournament.\n\nMore later.",
    };
    expect(buildPublicSeoSummary({ name: "Winter Open", preferences }).description).toBe("The Winter Open is a BP tournament.");
    // A homepage without prose falls back to the welcome message.
    expect(buildPublicSeoSummary({ name: "Winter Open", preferences: { ...preferences, publicHomepage: "## Schedule" } }).description)
      .toBe("Welcome!");
  });

  it("defaults to indexable with a generated description", () => {
    const seo = buildPublicSeoSummary({ name: "Cup" });
    expect(seo.indexing).toBe("all");
    expect(seo.description).toContain("Cup");
    expect(buildPublicSeoSummary(undefined).name).toBe("Tournament");
    expect(buildPublicSeoSummary({ preferences: { searchEngineIndexing: "bogus" } }).indexing).toBe("all");
  });

  it("is stored on the published root", () => {
    const sections = buildPublicViewSections(
      { id: "t1", name: "Open", slug: "open", format: "BP", preferences: { searchEngineIndexing: "none" } },
      {
        rounds: [],
        teams: [],
        adjudicators: [],
        venues: [],
        motions: [],
        breakCategories: [],
        debates: [],
        ballots: [],
        institutions: [],
      } as never
    );
    const { root } = buildPublicViewRoot({ tournamentId: "t1", slug: "open", sections, publishedAt: "now" });
    expect(root.seo).toMatchObject({ name: "Open", indexing: "none" });
    const withHomepage = buildPublicViewSections(
      { id: "t1", name: "Open", slug: "open", format: "BP", preferences: { publicHomepage: "## Hello\n\nThe *Open* returns." } },
      { rounds: [], teams: [], adjudicators: [], venues: [], motions: [], breakCategories: [], debates: [], ballots: [], institutions: [] } as never
    );
    expect(buildPublicViewRoot({ tournamentId: "t1", slug: "open", sections: withHomepage, publishedAt: "now" }).root.seo?.description)
      .toBe("The Open returns.");
  });
});

describe("shortDescription", () => {
  it("keeps short text and cuts long text at a word boundary", () => {
    expect(shortDescription("a  b")).toBe("a b");
    const cut = shortDescription("word ".repeat(60), 40);
    expect(cut.length).toBeLessThanOrEqual(40);
    expect(cut.endsWith("word…")).toBe(true);
  });
});

describe("publicSitemapEntries", () => {
  const site = "https://tab.example.org";

  it("lists the public tab and switched-on sub-pages under 'all', only the tab under 'homepage-only', nothing under 'none'", () => {
    const entries = publicSitemapEntries(
      [
        { slug: "zeta", publishedAt: "2026-10-01T10:00:00.000Z", seo: summary({ indexing: "none", schedule: true }) },
        { slug: "beta", seo: summary({ indexing: "homepage-only", schedule: true, checkins: true }) },
        { slug: "alpha", publishedAt: "2026-10-02T10:00:00.000Z", seo: summary({ schedule: true, checkins: true }) },
        { slug: "gamma", publishedAt: "not a date", seo: summary() },
      ],
      site
    );
    expect(entries.map((entry) => entry.url)).toEqual([
      `${site}/alpha/public`,
      `${site}/alpha/schedule/public`,
      `${site}/alpha/checkins/public`,
      `${site}/beta/public`,
      `${site}/gamma/public`,
    ]);
    expect(entries[0].lastModified).toEqual(new Date("2026-10-02T10:00:00.000Z"));
    expect(entries[3].lastModified).toBeUndefined();
    expect(entries[4].lastModified).toBeUndefined();
  });

  it("is empty without published tournaments", () => {
    expect(publicSitemapEntries([], site)).toEqual([]);
  });
});

describe("buildPublicPageMetadata", () => {
  it("builds title, description, canonical, Open Graph, Twitter and explicit robots", () => {
    const metadata = buildPublicPageMetadata({ seo: summary(), path: "/open/public", homepage: true });
    expect(metadata.title).toBe("Open | CrabbyTab");
    expect(metadata.description).toBe("Welcome");
    expect(metadata.alternates).toEqual({ canonical: "/open/public" });
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.openGraph).toMatchObject({ title: "Open", url: "/open/public", siteName: "CrabbyTab" });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", title: "Open | CrabbyTab" });
  });

  it("follows the search-engine setting", () => {
    const robots = (indexing: PublicSeoSummary["indexing"], homepage: boolean) =>
      buildPublicPageMetadata({ seo: summary({ indexing }), path: "/open/x", homepage }).robots;
    expect(robots("homepage-only", true)).toEqual({ index: true, follow: true });
    expect(robots("homepage-only", false)).toEqual({ index: false, follow: false });
    expect(robots("none", true)).toEqual({ index: false, follow: false });
    expect(buildPublicPageMetadata({ seo: summary(), path: "/p", homepage: false, page: "Schedule" }).title).toBe(
      "Schedule · Open | CrabbyTab"
    );
  });
});

describe("publicPageMetadata", () => {
  it("reads the cached projection; noindex for an unknown tournament, indexable on other failures", async () => {
    vi.resetModules();
    class PublicViewError extends Error {
      constructor(message: string, readonly status: number) {
        super(message);
      }
    }
    const getPublicSections = vi.fn();
    vi.doMock("@/lib/publicView/store", () => ({ getPublicSections, PublicViewError }));
    const { publicPageMetadata, publicPagePath } = await import("@/lib/publicView/robots");
    const options = { homepage: true, path: publicPagePath("open", "public") };
    expect(options.path).toBe("/open/public");

    getPublicSections.mockResolvedValueOnce({
      version: "v",
      sections: { tournament: { name: "Open", preferences: { searchEngineIndexing: "none" } } },
    });
    const metadata = await publicPageMetadata("open", options);
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toBe("Open | CrabbyTab");
    expect(getPublicSections).toHaveBeenCalledWith("open", ["tournament"]);

    getPublicSections.mockRejectedValueOnce(new PublicViewError("Tournament not found.", 404));
    expect(await publicPageMetadata("missing", options)).toEqual({ robots: { index: false, follow: false } });

    getPublicSections.mockRejectedValueOnce(new PublicViewError("Busy", 503));
    expect(await publicPageMetadata("open", options)).toEqual({ robots: { index: true, follow: true } });
    vi.doUnmock("@/lib/publicView/store");
  });
});
