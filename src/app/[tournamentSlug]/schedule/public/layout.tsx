import React from "react";
import type { Metadata } from "next";
import { publicPageMetadata, publicPagePath } from "@/lib/publicView/robots";

/** The public schedule follows the tournament's search-engine setting (not its homepage). */
export async function generateMetadata({ params }: { params: Promise<{ tournamentSlug: string }> }): Promise<Metadata> {
  const { tournamentSlug } = await params;
  return publicPageMetadata(tournamentSlug, { homepage: false, path: publicPagePath(tournamentSlug, "schedule", "public"), page: "Schedule" });
}

export default function PublicScheduleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
