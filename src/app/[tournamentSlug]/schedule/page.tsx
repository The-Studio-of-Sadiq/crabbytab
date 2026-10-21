"use client";

import React from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Feedback";
import { useI18n } from "@/components/i18n/I18nProvider";
import { RoundScheduleCard } from "@/features/tournament/components/schedule/RoundScheduleCard";
import { DebateTimesCard } from "@/features/tournament/components/schedule/DebateTimesCard";
import { ScheduleEventsCard } from "@/features/tournament/components/schedule/ScheduleEventsCard";

/** Round slots and start times, debate times and the tournament schedule (Tabbycat's schedule views). */
export default function SchedulePage() {
  const { t } = useI18n();
  const { tournament, isOwnerOrAdmin } = useTournament();
  if (!tournament) return null;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("tabroom.schedule.title")}
        description={t("tabroom.schedule.description")}
      />
      {!isOwnerOrAdmin && <Alert tone="info">{t("tabroom.schedule.adminOnly")}</Alert>}
      <RoundScheduleCard />
      <ScheduleEventsCard />
      <DebateTimesCard />
    </div>
  );
}
