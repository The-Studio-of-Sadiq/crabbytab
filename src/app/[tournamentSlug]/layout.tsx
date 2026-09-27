import React from "react";
import { TournamentProvider } from "@/contexts/TournamentContext";
import { TournamentChrome } from "@/components/layout/TournamentChrome";

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
