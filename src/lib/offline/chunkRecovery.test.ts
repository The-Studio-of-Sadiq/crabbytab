import { describe, expect, it } from "vitest";
import { CHUNK_RELOAD_KEY, claimChunkReload, isChunkLoadError } from "./chunkRecovery";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe("isChunkLoadError", () => {
  it("recognises chunk failures from errors, plain objects and messages", () => {
    const chunkError = new Error("Loading chunk 123 failed.");
    chunkError.name = "ChunkLoadError";
    expect(isChunkLoadError(chunkError)).toBe(true);
    expect(isChunkLoadError({ name: "ChunkLoadError", message: "x" })).toBe(true);
    expect(isChunkLoadError("Loading chunk app-pages-internals failed")).toBe(true);
    expect(isChunkLoadError("Loading CSS chunk 9 failed")).toBe(true);
  });

  it("checks the event message even when the error object does not mention the chunk", () => {
    const unrelatedLooking = new TypeError("Failed to fetch dynamically imported module");
    expect(isChunkLoadError(unrelatedLooking, "Uncaught ChunkLoadError: Loading chunk 123 failed")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isChunkLoadError(new TypeError("x is undefined"), "Uncaught TypeError: x is undefined")).toBe(false);
    expect(isChunkLoadError(undefined, null)).toBe(false);
  });
});

describe("claimChunkReload", () => {
  it("allows one reload per throttle window and records it", () => {
    const storage = memoryStorage();
    expect(claimChunkReload(storage, 1_000_000)).toBe(true);
    expect(storage.values.get(CHUNK_RELOAD_KEY)).toBe("1000000");
    expect(claimChunkReload(storage, 1_010_000)).toBe(false);
    expect(claimChunkReload(storage, 1_031_000)).toBe(true);
  });

  it("never reloads without usable storage, to avoid reload loops", () => {
    expect(claimChunkReload(undefined, 1)).toBe(false);
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => undefined };
    expect(claimChunkReload(throwing, 1)).toBe(false);
  });
});
