"use client";

import dynamic from "next/dynamic";
import type { MarkdownRendererProps } from "./MarkdownRenderer";

/**
 * Organiser Markdown, loaded on demand: react-markdown, KaTeX and their CSS are fetched only when
 * this renders, so pages (and tabs) without Markdown keep their first-load JavaScript.
 */
export const LazyMarkdown = dynamic<MarkdownRendererProps>(() => import("./SafeMarkdown"), {
  ssr: false,
  loading: () => <div className="h-24 animate-pulse rounded-md bg-muted motion-reduce:animate-none" aria-hidden="true" />,
});
