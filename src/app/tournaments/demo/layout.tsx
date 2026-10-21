import React from "react";
import type { Metadata } from "next";
import { NOINDEX_METADATA } from "@/lib/seo/site";

/** Staff tools are not indexed. */
export const metadata: Metadata = NOINDEX_METADATA;

export default function DemoTournamentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
