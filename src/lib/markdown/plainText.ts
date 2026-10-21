import { parseYouTubeVideo } from "./youtube";

/**
 * The first prose paragraph of organiser-written Markdown as plain text, for the page description
 * and link previews. Deliberately small (no Markdown parser on the server path): headings, code,
 * math blocks, tables, rules, images and video lines are skipped, inline markup is reduced to its
 * text. Never rendered as HTML.
 */
export function firstParagraphText(markdown: string): string {
  const blocks = markdown.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  let inFence = false;
  for (const block of blocks) {
    const trimmed = block.trim();
    const fences = (trimmed.match(/^(```|~~~)/gm) ?? []).length;
    if (inFence || /^(```|~~~)/.test(trimmed)) {
      // A fence that opens in this block and does not close carries on into the next blocks.
      if (fences % 2 === 1) inFence = !inFence;
      continue;
    }
    if (!trimmed || !isProse(trimmed)) continue;
    const text = inlineText(
      trimmed
        .split("\n")
        // List and quote markers of the paragraph's own lines.
        .map((line) => line.replace(/^\s{0,3}(?:>\s?)+/, "").replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/, ""))
        .join(" ")
    );
    if (text) return text;
  }
  return "";
}

function isProse(block: string): boolean {
  if (/^#{1,6}(\s|$)/.test(block)) return false; // heading
  if (/^\$\$/.test(block)) return false; // display math
  if (/^ {4}|^\t/.test(block)) return false; // indented code
  if (/^\s*(?:[-*_]\s*){3,}$/.test(block)) return false; // thematic break
  if (/^\|.*\|\s*\n\s*\|?\s*:?-{1,}/.test(block)) return false; // table
  if (/^<[a-z!/]/i.test(block)) return false; // raw HTML (never rendered)
  const lines = block.split("\n").map((line) => line.trim());
  // Only images, video links or shortcodes: nothing to read.
  return !lines.every((line) => /^!\[[^\]]*\]\([^)]*\)$/.test(line) || /^@\[youtube\]\([^)]*\)$/i.test(line) || parseYouTubeVideo(line.replace(/^<|>$/g, "")) !== null);
}

/** Emphasis, strong and strikethrough markers; underscores only at word edges (not in snake_case). */
function stripEmphasis(text: string): string {
  return text
    .replace(/(\*\*|~~|\*)(?=\S)([^]*?\S)\1/g, "$2")
    .replace(/(^|\W)(__|_)(?=\S)([^]*?\S)\2(?!\w)/g, "$1$3");
}

function inlineText(text: string): string {
  const withoutLinks = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → their text
    .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/gi, "$1") // autolinks
    .replace(/<[^>]*>/g, "") // stray HTML tags
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/\$\$?([^$]+)\$\$?/g, "$1"); // inline math (its TeX source)
  // Twice, for nested markers such as ***both***.
  return stripEmphasis(stripEmphasis(withoutLinks))
    .replace(/\\([\\`*_{}[\]()#+\-.!|~$>])/g, "$1") // escapes
    .replace(/\s+/g, " ")
    .trim();
}
