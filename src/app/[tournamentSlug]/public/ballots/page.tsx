"use client";

import React from "react";
import { useParams } from "next/navigation";
import { PublicBallotFormPage } from "@/features/tournament/components/public/forms/PublicBallotForm";

/** Public ballot form (Tabbycat `participant_ballots = public`); see docs/public-pages-and-notifications.md. */
export default function PublicBallotsPage() {
  const params = useParams<{ tournamentSlug: string }>();
  return <PublicBallotFormPage slug={params.tournamentSlug} />;
}
