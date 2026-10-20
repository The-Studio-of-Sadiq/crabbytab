import type { Metadata } from "next";
import { PublicBallotFormPage } from "@/features/tournament/components/public/PublicForms";
import { publicRobotsMetadata } from "@/lib/publicView/robots";

export async function generateMetadata({ params }: { params: Promise<{ tournamentSlug: string }> }): Promise<Metadata> {
  const { tournamentSlug } = await params;
  return publicRobotsMetadata(tournamentSlug, false);
}

export default async function PublicBallotForm({ params }: { params: Promise<{ tournamentSlug: string }> }) {
  const { tournamentSlug } = await params;
  return <PublicBallotFormPage slug={tournamentSlug} />;
}
