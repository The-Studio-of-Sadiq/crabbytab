"use client";

import React, { useState } from "react";
import Link from "next/link";
import { BarChart3, Settings2 } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { buttonClasses } from "@/components/ui/Button";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { TournamentPreferences } from "@/types";

/**
 * Motion preferences that are not about scoring: ranked motion preferences. (The public motions
 * order is a public-site setting, `publicMotionsOrder`.)
 */
export function MotionSettingsCard() {
  const { t } = useI18n();
  const { tournament, isOwnerOrAdmin, saveTournament } = useTournament();
  const [error, setError] = useState("");
  if (!tournament || !isOwnerOrAdmin) return null;
  const preferences = tournament.preferences;

  const save = async (patch: Partial<TournamentPreferences>) => {
    setError("");
    try {
      await saveTournament({ ...tournament, preferences: { ...preferences, ...patch } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("tabroom.schedule.motionSettings.saveFailed"));
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<Settings2 aria-hidden="true" />}
        title={t("tabroom.schedule.motionSettings.title")}
        actions={
          <Link href="/tournaments/motions" className={buttonClasses({ variant: "ghost", size: "sm" })}>
            <BarChart3 aria-hidden="true" />
            {t("tabroom.schedule.motionSettings.statistics")}
          </Link>
        }
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        {error && <Alert tone="danger" role="alert" className="sm:col-span-2">{error}</Alert>}
        <Switch
          id="motion-preferences"
          checked={preferences.enableMotionPreferences === true}
          onCheckedChange={(checked) => void save({ enableMotionPreferences: checked })}
          label={t("tabroom.schedule.motionSettings.preferences")}
          description={t("tabroom.schedule.motionSettings.preferencesHelp")}
        />
      </CardBody>
    </Card>
  );
}
