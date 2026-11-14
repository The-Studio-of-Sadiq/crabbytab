import type { InfoSlideMedia, Motion } from "@/types";
import { safeImageUrl } from "@/lib/markdown/safeUrls";
import { parseYouTubeVideo, youtubeEmbedUrl } from "@/lib/markdown/youtube";

/**
 * A motion's info slide can carry one picture or video next to (or instead of) its text.
 * CrabbyTab has no file storage, so the media is a link the organiser hosts elsewhere:
 * - image: any https URL (the same rule as images on the public homepage);
 * - video: a YouTube link (shown as a privacy-enhanced youtube-nocookie embed, the only iframe
 *   host the CSP allows) or an https link straight to a video file (.mp4, .webm, .ogg/.ogv,
 *   .mov, .m4v) played in a <video> element.
 * Links are validated when saved (`normalizeInfoSlideMedia`) and again when rendered
 * (`resolveInfoSlideMedia`), since older records, imports and the API can all carry them.
 */

export const INFO_SLIDE_MEDIA_KINDS = ["image", "video"] as const;
export const INFO_SLIDE_MEDIA_URL_MAX_LENGTH = 2000;
export const INFO_SLIDE_MEDIA_ALT_MAX_LENGTH = 300;

const VIDEO_FILE = /\.(mp4|webm|ogg|ogv|mov|m4v)$/i;

export type InfoSlideMediaSource =
  | { type: "image"; src: string; alt: string }
  | { type: "youtube"; src: string; title: string }
  | { type: "video"; src: string; title: string };

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/** An https link to a video file the browser can play (by extension; query strings are fine). */
export function isVideoFileUrl(value: string): boolean {
  const url = httpsUrl(value.trim());
  return url !== null && VIDEO_FILE.test(url.pathname);
}

/** What to render for the media, or null when the link is not one CrabbyTab will show. */
export function resolveInfoSlideMedia(media: InfoSlideMedia | undefined | null): InfoSlideMediaSource | null {
  if (!media || typeof media.url !== "string") return null;
  const url = media.url.trim();
  if (!url || url.length > INFO_SLIDE_MEDIA_URL_MAX_LENGTH) return null;
  const label = media.alt?.trim() ?? "";
  if (media.kind === "image") {
    const src = safeImageUrl(url) && httpsUrl(url) ? url : null;
    return src ? { type: "image", src, alt: label } : null;
  }
  if (media.kind === "video") {
    const youtube = parseYouTubeVideo(url);
    // A bare 11-character id is accepted by the Markdown helper; here only real links are.
    if (youtube && httpsUrl(url)) return { type: "youtube", src: youtubeEmbedUrl(youtube), title: label };
    if (isVideoFileUrl(url)) return { type: "video", src: url, title: label };
  }
  return null;
}

export type InfoSlideMediaResult =
  | { ok: true; media: InfoSlideMedia | undefined }
  | { ok: false; error: string };

/**
 * Checks and tidies media before it is saved. An empty URL means "no media" (undefined). The
 * error messages are English, like the other validation errors of the import and API paths.
 */
export function normalizeInfoSlideMedia(input: unknown): InfoSlideMediaResult {
  if (input === undefined || input === null) return { ok: true, media: undefined };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Info slide media must be an object with a kind and a url." };
  const { kind, url, alt } = input as Record<string, unknown>;
  if (url === undefined || url === null || (typeof url === "string" && !url.trim())) return { ok: true, media: undefined };
  if (kind !== "image" && kind !== "video") return { ok: false, error: "Info slide media kind must be \"image\" or \"video\"." };
  if (typeof url !== "string") return { ok: false, error: "Info slide media url must be text." };
  if (alt !== undefined && alt !== null && typeof alt !== "string") return { ok: false, error: "Info slide media description must be text." };
  const trimmedUrl = url.trim();
  if (trimmedUrl.length > INFO_SLIDE_MEDIA_URL_MAX_LENGTH) {
    return { ok: false, error: `Info slide media links can be at most ${INFO_SLIDE_MEDIA_URL_MAX_LENGTH} characters.` };
  }
  const trimmedAlt = typeof alt === "string" ? alt.trim().slice(0, INFO_SLIDE_MEDIA_ALT_MAX_LENGTH) : "";
  const media: InfoSlideMedia = { kind, url: trimmedUrl, ...(trimmedAlt ? { alt: trimmedAlt } : {}) };
  if (resolveInfoSlideMedia(media)) return { ok: true, media };
  return {
    ok: false,
    error:
      kind === "image"
        ? "Info slide images must be an https link."
        : "Info slide videos must be a YouTube link or an https link to a video file (.mp4, .webm, .ogg, .mov or .m4v).",
  };
}

/** Like normalizeInfoSlideMedia, but throws the error (for the entity commands). */
export function requireValidInfoSlideMedia(input: unknown): InfoSlideMedia | undefined {
  const result = normalizeInfoSlideMedia(input);
  if (!result.ok) throw new Error(result.error);
  return result.media;
}

/** The motion with its media validated: invalid media throws, empty media is removed. */
export function withValidInfoSlideMedia<T extends Pick<Motion, "infoSlideMedia">>(motion: T): T {
  const media = requireValidInfoSlideMedia(motion.infoSlideMedia);
  const { infoSlideMedia: _omit, ...rest } = motion;
  void _omit;
  return (media ? { ...rest, infoSlideMedia: media } : rest) as T;
}

/** True when the motion has an info slide to show: text, media, or both. */
export function hasInfoSlide(motion: Pick<Motion, "infoSlide" | "infoSlideMedia">): boolean {
  return Boolean(motion.infoSlide?.trim()) || Boolean(motion.infoSlideMedia?.url?.trim());
}
