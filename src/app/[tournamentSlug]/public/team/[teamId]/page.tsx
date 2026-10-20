import { TeamRecordPage } from "@/features/tournament/components/public/PublicRecordPages";
import type { Metadata } from "next";
import { publicRobotsMetadata } from "@/lib/publicView/robots";

export async function generateMetadata({ params }: { params: Promise<{ tournamentSlug: string }> }): Promise<Metadata> {
  const { tournamentSlug } = await params;
  return publicRobotsMetadata(tournamentSlug, false);
}

export default async function PublicTeamRecord({
  params,
}: {
  params: Promise<{ tournamentSlug: string; teamId: string }>;
}) {
  const { tournamentSlug, teamId } = await params;
  return <TeamRecordPage slug={tournamentSlug} teamId={decodeURIComponent(teamId)} />;
}
