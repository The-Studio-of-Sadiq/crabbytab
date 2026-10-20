import React from "react";
import type { Metadata } from "next";
import { publicRobotsMetadata } from "@/lib/publicView/robots";

/** The public tab is the tournament's homepage for the "homepage only" indexing setting. */
export async function generateMetadata({ params }: { params: Promise<{ tournamentSlug: string }> }): Promise<Metadata> {
  const { tournamentSlug } = await params;
  return publicRobotsMetadata(tournamentSlug, true);
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return children;
}
