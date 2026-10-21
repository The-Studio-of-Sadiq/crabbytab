import React from "react";
import type { Metadata } from "next";
import { TournamentProvider } from "@/contexts/TournamentContext";
import { TournamentChrome } from "@/components/layout/TournamentChrome";
import { NOINDEX_METADATA } from "@/lib/seo/site";

/**
 * The tab room, projector and private URLs are never indexed. Public pages below override this
 * with the tournament's search-engine setting (lib/publicView/robots.ts).
 */
export const metadata: Metadata = NOINDEX_METADATA;

export default async function TournamentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tournamentSlug: string }>;
}) {
  const resolvedParams = await params;
  const tournamentSlug = resolvedParams.tournamentSlug;

  return (
    <TournamentProvider tournamentSlug={tournamentSlug}>
      <TournamentChrome tournamentSlug={tournamentSlug}>{children}</TournamentChrome>
    </TournamentProvider>
  );
}
