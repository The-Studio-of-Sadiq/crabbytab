"use client";

import "katex/dist/katex.min.css";
import "./markdown.css";
import { MarkdownRenderer, type MarkdownRendererProps } from "./MarkdownRenderer";

/**
 * The Markdown renderer with its stylesheets. Import it only through LazyMarkdown, so the parser,
 * KaTeX and their CSS are a separate chunk loaded where Markdown is actually shown.
 */
export default function SafeMarkdown(props: MarkdownRendererProps) {
  return <MarkdownRenderer {...props} />;
}
