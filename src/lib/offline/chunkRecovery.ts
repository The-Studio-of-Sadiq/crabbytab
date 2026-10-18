/**
 * Recovery from stale JavaScript chunks after a deploy: when the page asks for a chunk that the new
 * build no longer serves, reload once so the browser picks up the current build.
 */

export const CHUNK_RELOAD_KEY = "crabbytab:chunk-reload";
export const CHUNK_RELOAD_THROTTLE_MS = 30_000;

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value && typeof value === "object") {
    const { name, message } = value as { name?: unknown; message?: unknown };
    if (typeof name === "string" || typeof message === "string") return `${name ?? ""}: ${message ?? ""}`;
  }
  return String(value ?? "");
}

/**
 * True when any of the given values describes a chunk-load failure. Browsers and bundlers report
 * these inconsistently — sometimes only on the error object, sometimes only in the event message —
 * so every available source is checked.
 */
export function isChunkLoadError(...sources: unknown[]): boolean {
  return sources.some((source) => {
    const text = describe(source);
    return text.includes("ChunkLoadError") || /Loading (CSS )?chunk [\w-]+ failed/i.test(text);
  });
}

export interface ReloadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Decides whether to reload now, recording the attempt. At most one reload per throttle window, so
 * a chunk that is genuinely missing cannot cause a reload loop. Without usable storage the answer
 * is no, for the same reason.
 */
export function claimChunkReload(
  storage: ReloadStorage | undefined,
  now: number,
  throttleMs = CHUNK_RELOAD_THROTTLE_MS
): boolean {
  if (!storage) return false;
  try {
    const previous = Number(storage.getItem(CHUNK_RELOAD_KEY));
    if (previous && now - previous < throttleMs) return false;
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}
