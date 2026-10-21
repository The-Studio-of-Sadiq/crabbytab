import React from "react";
import type { Metadata } from "next";
import { publicRobotsMetadata } from "@/lib/publicView/robots";

export async function generateMetadata({ params }: { params: Promise<{ tournamentSlug: string }> }): Promise<Metadata> {
  const { tournamentSlug } = await params;
  return publicRobotsMetadata(tournamentSlug, false);
}

export default function PublicFormLayout({ children }: { children: React.ReactNode }) {
  return children;
}
