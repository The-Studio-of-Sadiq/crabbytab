import { AdjudicatorRecordPage } from "@/features/tournament/components/public/PublicRecordPages";
import type { Metadata } from "next";
import { publicRobotsMetadata } from "@/lib/publicView/robots";

export async function generateMetadata({ params }: { params: Promise<{ tournamentSlug: string }> }): Promise<Metadata> {
  const { tournamentSlug } = await params;
  return publicRobotsMetadata(tournamentSlug, false);
}

export default async function PublicAdjudicatorRecord({
  params,
}: {
  params: Promise<{ tournamentSlug: string; adjudicatorId: string }>;
}) {
  const { tournamentSlug, adjudicatorId } = await params;
  return <AdjudicatorRecordPage slug={tournamentSlug} adjudicatorId={decodeURIComponent(adjudicatorId)} />;
}
