import React from "react";
import type { Metadata } from "next";
import { pooledMotionsIndexable, readPublicMotionSummaries } from "@/lib/motions/publicSummaryStore";

/**
 * The pooled motion statistics show tournaments' public data, so they are kept out of search
 * engines whenever any of those tournaments turned indexing off (Tabbycat `search_engine_indexing`).
 * When the summaries cannot be read the page keeps the default.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    return pooledMotionsIndexable(await readPublicMotionSummaries()) ? {} : { robots: { index: false, follow: false } };
  } catch {
    return {};
  }
}

export default function PublicMotionsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
