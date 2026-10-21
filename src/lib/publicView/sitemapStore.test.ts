import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

const getAdminFirestore = vi.fn();
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: () => unknown) => fn,
}));
vi.mock("@/lib/firebaseAdmin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/firebaseAdmin")>()),
  getAdminFirestore: () => getAdminFirestore(),
}));

import { getSitemapSources, readSitemapSources, sitemapSourcesFromRoots } from "@/lib/publicView/sitemapStore";
import type { PublicSeoSummary } from "@/lib/publicView/seo";

const seo: PublicSeoSummary = { name: "Open", indexing: "all", schedule: false, checkins: false, description: "d" };

function fakeFirestore(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  const calls: { select?: string[]; limit?: number } = {};
  const query = {
    select: (...fields: string[]) => {
      calls.select = fields;
      return query;
    },
    limit: (count: number) => {
      calls.limit = count;
      return query;
    },
    get: async () => ({ docs: docs.map((document) => ({ id: document.id, data: () => document.data })) }),
  };
  const firestore = {
    collection: (name: string) => {
      expect(name).toBe("publicViews");
      return query;
    },
  };
  return { firestore: firestore as unknown as Firestore, calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
  getAdminFirestore.mockReset();
});

describe("sitemapSourcesFromRoots", () => {
  it("uses the stored summary, falls back to the tournament section of older roots, and skips invalid ones", async () => {
    const readSection = vi.fn(async () => ({ name: "Legacy", preferences: { searchEngineIndexing: "none" } }));
    const sources = await sitemapSourcesFromRoots(
      [
        { id: "open", data: { slug: "open", publishedAt: "2026-10-01T00:00:00.000Z", seo } },
        { id: "legacy", data: { slug: "legacy", sections: { tournament: { hash: "h", chunks: 1 } } } },
        { id: "empty", data: { slug: "empty", sections: {} } },
        { id: "Bad Slug", data: { seo } },
      ],
      readSection
    );
    expect(sources).toEqual([
      { slug: "open", publishedAt: "2026-10-01T00:00:00.000Z", seo },
      { slug: "legacy", publishedAt: undefined, seo: expect.objectContaining({ name: "Legacy", indexing: "none" }) },
    ]);
    expect(readSection).toHaveBeenCalledTimes(1);
  });
});

describe("readSitemapSources", () => {
  it("reads only the root fields it needs, with a cap", async () => {
    const { firestore, calls } = fakeFirestore([{ id: "open", data: { slug: "open", seo } }]);
    expect(await readSitemapSources(firestore)).toEqual([{ slug: "open", publishedAt: undefined, seo }]);
    expect(calls.select).toEqual(["slug", "publishedAt", "seo", "sections.tournament"]);
    expect(calls.limit).toBeGreaterThan(0);
  });
});

describe("getSitemapSources", () => {
  it("is empty without admin credentials and never touches Firestore", async () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    expect(await getSitemapSources()).toEqual([]);
    expect(getAdminFirestore).not.toHaveBeenCalled();
  });

  it("is empty when Firestore fails", async () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "{}");
    getAdminFirestore.mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await getSitemapSources()).toEqual([]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("returns the published tournaments", async () => {
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "{}");
    getAdminFirestore.mockReturnValue(fakeFirestore([{ id: "open", data: { slug: "open", seo } }]).firestore);
    expect(await getSitemapSources()).toEqual([{ slug: "open", publishedAt: undefined, seo }]);
  });
});
