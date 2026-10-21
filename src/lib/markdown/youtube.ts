/**
 * YouTube links in organiser-written Markdown. Only the embed URLs built here (on the privacy
 * enhanced youtube-nocookie.com host) are ever rendered as iframes; see safeUrls.ts.
 */

export interface YouTubeVideo {
  id: string;
  /** Start time in whole seconds. */
  start?: number;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
/** The longest start time accepted (a day); anything else is ignored. */
const MAX_START_SECONDS = 86_400;

export const YOUTUBE_EMBED_PATTERN = /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}(?:\?start=\d{1,5})?$/;

/** "90", "90s", "1m30s", "1h2m3s" → seconds; anything else → undefined. */
export function parseStartTime(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value.trim());
  if (!match || match[0] === "") return undefined;
  const [, hours, minutes, seconds] = match;
  const total = Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
  return Number.isFinite(total) && total > 0 && total <= MAX_START_SECONDS ? total : undefined;
}

/**
 * The video in a YouTube URL (youtube.com/watch?v=, youtu.be/, /shorts/, /embed/, /live/) or a
 * bare 11-character video id, with an optional start time (`t=` or `start=`).
 */
export function parseYouTubeVideo(input: string): YouTubeVideo | null {
  const value = input.trim();
  if (VIDEO_ID.test(value)) return { id: value };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || (url.port && url.port !== "443" && url.port !== "80")) return null;
  const host = url.hostname.toLowerCase();
  let id: string | undefined;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "watch" && segments.length === 1) id = url.searchParams.get("v") ?? undefined;
    else if (["shorts", "embed", "live", "v"].includes(segments[0] ?? "") && segments.length === 2) id = segments[1];
  }
  if (!id || !VIDEO_ID.test(id)) return null;
  const start = parseStartTime(url.searchParams.get("t") ?? url.searchParams.get("start"));
  return start ? { id, start } : { id };
}

export function youtubeEmbedUrl(video: YouTubeVideo): string {
  return `https://www.youtube-nocookie.com/embed/${video.id}${video.start ? `?start=${video.start}` : ""}`;
}

export function isYouTubeEmbedUrl(url: string): boolean {
  return YOUTUBE_EMBED_PATTERN.test(url);
}
