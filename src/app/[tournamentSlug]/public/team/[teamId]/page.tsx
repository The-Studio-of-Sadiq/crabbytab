import { TeamRecordPage } from "@/features/tournament/components/public/PublicRecordPages";
import type { Metadata } from "next";
import { publicPageMetadata, publicPagePath } from "@/lib/publicView/robots";

export async function generateMetadata({ params }: { params: Promise<{ tournamentSlug: string; teamId: string }> }): Promise<Metadata> {
  const { tournamentSlug, teamId } = await params;
  return publicPageMetadata(tournamentSlug, { homepage: false, path: publicPagePath(tournamentSlug, "public", "team", teamId), page: "Team record" });
}

export default async function PublicTeamRecord({
  params,
}: {
  params: Promise<{ tournamentSlug: string; teamId: string }>;
}) {
  const { tournamentSlug, teamId } = await params;
  return <TeamRecordPage slug={tournamentSlug} teamId={decodeURIComponent(teamId)} />;
}
