import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Runs the real public/sw.js against fake service-worker globals: an in-memory Cache Storage and a
 * scripted network.
 */
const ORIGIN = "https://crabbytab.example";
const source = readFileSync(path.resolve(__dirname, "../../../public/sw.js"), "utf-8");

type Listener = (event: unknown) => void;
type FakeRequest = { url: string; method: string; mode?: string };

let listeners: Record<string, Listener>;
let stores: Map<string, Map<string, Response>>;
let network: (request: FakeRequest) => Promise<Response>;

function loadWorker() {
  listeners = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => void (listeners[type] = listener),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (request: FakeRequest, response: Response) => void store.set(request.url, response),
        match: async (request: FakeRequest | string) =>
          store.get(typeof request === "string" ? new URL(request, ORIGIN).href : request.url)?.clone(),
        addAll: async () => undefined,
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const fetchFake = (request: FakeRequest) => network(request);
  new Function("self", "caches", "fetch", source)(self, caches, fetchFake);
}

async function dispatchFetch(request: FakeRequest): Promise<Response | undefined> {
  let responded: Promise<Response> | undefined;
  listeners.fetch({ request, respondWith: (value: Promise<Response>) => (responded = value) });
  return responded ? await responded : undefined;
}

async function seedCache(url: string, body: string) {
  const name = source.match(/CACHE_NAME = "([^"]+)"/)![1];
  if (!stores.has(name)) stores.set(name, new Map());
  stores.get(name)!.set(`${ORIGIN}${url}`, new Response(body, { status: 200 }));
}

const chunk = (file = "app.js"): FakeRequest => ({ url: `${ORIGIN}/_next/static/chunks/${file}`, method: "GET" });

beforeEach(() => {
  stores = new Map();
  network = async () => new Response("network", { status: 200 });
  loadWorker();
});

describe("service worker: static chunks", () => {
  it("serves and caches a fresh chunk from the network", async () => {
    const response = await dispatchFetch(chunk());
    expect(await response!.text()).toBe("network");
    const cached = await dispatchFetch({ ...chunk(), url: chunk().url });
    expect(cached!.status).toBe(200);
  });

  it("uses the cached chunk when offline", async () => {
    await seedCache("/_next/static/chunks/app.js", "cached");
    network = async () => { throw new TypeError("Failed to fetch"); };
    expect(await (await dispatchFetch(chunk()))!.text()).toBe("cached");
  });

  it("uses the cached chunk when the server returns an HTTP error (e.g. 404 after a deploy)", async () => {
    await seedCache("/_next/static/chunks/app.js", "cached");
    network = async () => new Response("gone", { status: 404 });
    const response = await dispatchFetch(chunk());
    expect(response!.status).toBe(200);
    expect(await response!.text()).toBe("cached");
  });

  it("passes the HTTP error through when nothing is cached", async () => {
    network = async () => new Response("gone", { status: 404 });
    expect((await dispatchFetch(chunk("missing.js")))!.status).toBe(404);
  });

  it("propagates an offline failure when nothing is cached", async () => {
    network = async () => { throw new TypeError("Failed to fetch"); };
    await expect(dispatchFetch(chunk("missing.js"))).rejects.toThrow("Failed to fetch");
  });
});

describe("service worker: other requests", () => {
  it("falls back to the cached page, then the app shell, for offline navigations", async () => {
    network = async () => { throw new TypeError("Failed to fetch"); };
    await seedCache("/", "shell");
    const page = await dispatchFetch({ url: `${ORIGIN}/my-open/public`, method: "GET", mode: "navigate" });
    expect(await page!.text()).toBe("shell");
  });

  it("never intercepts API calls, writes or other origins", async () => {
    expect(await dispatchFetch({ url: `${ORIGIN}/api/public/tournaments/x`, method: "GET" })).toBeUndefined();
    expect(await dispatchFetch({ url: `${ORIGIN}/_next/static/chunks/a.js`, method: "POST" })).toBeUndefined();
    expect(await dispatchFetch({ url: "https://cdn.example/_next/static/a.js", method: "GET" })).toBeUndefined();
  });
});
