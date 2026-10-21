import React from "react";
import type { Metadata } from "next";
import { publicPageMetadata, publicPagePath } from "@/lib/publicView/robots";

/** The public tab is the tournament's homepage for the "homepage only" indexing setting. */
export async function generateMetadata({ params }: { params: Promise<{ tournamentSlug: string }> }): Promise<Metadata> {
  const { tournamentSlug } = await params;
  return publicPageMetadata(tournamentSlug, { homepage: true, path: publicPagePath(tournamentSlug, "public") });
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return children;
}
