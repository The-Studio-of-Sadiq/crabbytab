"use client";

import React from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Feedback";
import { RoundScheduleCard } from "@/features/tournament/components/schedule/RoundScheduleCard";
import { DebateTimesCard } from "@/features/tournament/components/schedule/DebateTimesCard";
import { ScheduleEventsCard } from "@/features/tournament/components/schedule/ScheduleEventsCard";

/** Round slots and start times, debate times and the tournament schedule (Tabbycat's schedule views). */
export default function SchedulePage() {
  const { tournament, isOwnerOrAdmin } = useTournament();
  if (!tournament) return null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule"
        description="When each round and debate starts, which rounds run at the same time, and the tournament schedule participants see."
      />
      {!isOwnerOrAdmin && <Alert tone="info">Only tournament administrators can change the schedule.</Alert>}
      <RoundScheduleCard />
      <ScheduleEventsCard />
      <DebateTimesCard />
    </div>
  );
}
