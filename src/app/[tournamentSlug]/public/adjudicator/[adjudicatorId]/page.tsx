import { AdjudicatorRecordPage } from "@/features/tournament/components/public/PublicRecordPages";
import type { Metadata } from "next";
import { publicPageMetadata, publicPagePath } from "@/lib/publicView/robots";

export async function generateMetadata({ params }: { params: Promise<{ tournamentSlug: string; adjudicatorId: string }> }): Promise<Metadata> {
  const { tournamentSlug, adjudicatorId } = await params;
  return publicPageMetadata(tournamentSlug, { homepage: false, path: publicPagePath(tournamentSlug, "public", "adjudicator", adjudicatorId), page: "Adjudicator record" });
}

export default async function PublicAdjudicatorRecord({
  params,
}: {
  params: Promise<{ tournamentSlug: string; adjudicatorId: string }>;
}) {
  const { tournamentSlug, adjudicatorId } = await params;
  return <AdjudicatorRecordPage slug={tournamentSlug} adjudicatorId={decodeURIComponent(adjudicatorId)} />;
}
