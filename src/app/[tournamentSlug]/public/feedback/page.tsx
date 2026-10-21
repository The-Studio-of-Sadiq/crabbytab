"use client";

import React from "react";
import { useParams } from "next/navigation";
import { PublicFeedbackFormPage } from "@/features/tournament/components/public/forms/PublicFeedbackForm";

/** Public feedback form (Tabbycat `participant_feedback = public`); see docs/public-pages-and-notifications.md. */
export default function PublicFeedbackPage() {
  const params = useParams<{ tournamentSlug: string }>();
  return <PublicFeedbackFormPage slug={params.tournamentSlug} />;
}
