import React from "react";
import type { Metadata } from "next";
import { publicPageMetadata, publicPagePath } from "@/lib/publicView/robots";

export async function generateMetadata({ params }: { params: Promise<{ tournamentSlug: string }> }): Promise<Metadata> {
  const { tournamentSlug } = await params;
  return publicPageMetadata(tournamentSlug, { homepage: false, path: publicPagePath(tournamentSlug, "public", "feedback"), page: "Feedback" });
}

export default function PublicFormLayout({ children }: { children: React.ReactNode }) {
  return children;
}
