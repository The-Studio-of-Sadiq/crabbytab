import { isYouTubeEmbedUrl } from "./youtube";

/**
 * URL rules for organiser-written Markdown shown on the public site. Every URL attribute the
 * renderer emits passes through `safeMarkdownUrl`; a rejected URL is dropped (empty string), so a
 * `javascript:` or `data:` link renders as plain text and such an image is not rendered.
 */

/** Characters browsers strip or ignore inside a scheme ("java\nscript:"), removed before checking. */
// eslint-disable-next-line no-control-regex
const IGNORED_IN_SCHEME = /[\u0000- \u007f-\u009f]/g;

function scheme(url: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.replace(IGNORED_IN_SCHEME, ""));
  return match ? match[1].toLowerCase() : null;
}

/**
 * A same-site path or fragment ("/open/schedule/public", "#venue"). "//host" and "/\host" are
 * protocol-relative to another host in browsers, so they are not paths.
 */
function isSitePath(url: string): boolean {
  return url.startsWith("#") || (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\"));
}

/** Link targets: http(s), mailto, and paths on this site. */
export function safeLinkUrl(url: string): string | null {
  const value = url.trim();
  if (!value) return null;
  const protocol = scheme(value);
  if (protocol === null) return isSitePath(value) ? value : null;
  return protocol === "http" || protocol === "https" || protocol === "mailto" ? value : null;
}

/** Images: https only (no http mixed content, no data: or blob:). */
export function safeImageUrl(url: string): string | null {
  const value = url.trim();
  return scheme(value) === "https" ? value : null;
}

/** A link that leaves the site (opened in a new tab). */
export function isExternalLink(url: string): boolean {
  const protocol = scheme(url.trim());
  return protocol === "http" || protocol === "https";
}

/** react-markdown `urlTransform`: decides per attribute and element. */
export function safeMarkdownUrl(url: string, key: string, node: { tagName?: string }): string {
  const tag = node.tagName;
  if (tag === "iframe") return key === "src" && isYouTubeEmbedUrl(url) ? url : "";
  if (tag === "img") return key === "src" ? safeImageUrl(url) ?? "" : "";
  if (tag === "a" && key === "href") return safeLinkUrl(url) ?? "";
  // No other element may carry a URL (cite, poster, action, ...).
  return "";
}
