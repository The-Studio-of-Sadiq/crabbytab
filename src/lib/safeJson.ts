export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }

  const text = value.trim();
  if (!text || text === "undefined" || text === "null") {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text);
    return parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}
