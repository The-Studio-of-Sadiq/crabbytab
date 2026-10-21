import React from "react";
import type { Metadata } from "next";
import { publicPageMetadata, publicPagePath } from "@/lib/publicView/robots";

export async function generateMetadata({ params }: { params: Promise<{ tournamentSlug: string }> }): Promise<Metadata> {
  const { tournamentSlug } = await params;
  return publicPageMetadata(tournamentSlug, { homepage: false, path: publicPagePath(tournamentSlug, "checkins", "public"), page: "Check-ins" });
}

export default function PublicSubpageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
