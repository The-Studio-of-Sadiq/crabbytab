import React from "react";
import type { Metadata } from "next";
import { publicRobotsMetadata } from "@/lib/publicView/robots";

/** The public schedule follows the tournament's search-engine setting (not its homepage). */
export async function generateMetadata({ params }: { params: Promise<{ tournamentSlug: string }> }): Promise<Metadata> {
  const { tournamentSlug } = await params;
  return publicRobotsMetadata(tournamentSlug, false);
}

export default function PublicScheduleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
