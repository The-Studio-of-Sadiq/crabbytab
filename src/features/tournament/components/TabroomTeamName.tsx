"use client";

import React from "react";

import { useI18n } from "@/components/i18n/I18nProvider";
import { useTournament } from "@/contexts/TournamentContext";
import { tabroomTeamName } from "@/lib/codeNames";
import { getPublicSiteSettings } from "@/lib/publicFeatures";
import type { Team, TeamCodeNameMode } from "@/types";

/**
 * A team name on a tab-room page under the team code-name setting (see `tabroomTeamName`): the
 * other name, when the mode adds one, is in a tooltip and in the accessible name.
 */
export function TabroomTeamName({
  team,
  name,
  mode,
  fallback = "—",
}: {
  team?: Pick<Team, "name" | "codeName">;
  name?: string;
  /** Defaults to the current tournament's setting. */
  mode?: TeamCodeNameMode;
  fallback?: string;
}) {
  const { t } = useI18n();
  const { tournament } = useTournament();
  const display = tabroomTeamName(team, name, mode ?? getPublicSiteSettings(tournament?.preferences).teamCodeNames);
  const shown = display.name || fallback;
  if (!display.tooltip) return <>{shown}</>;
  const tooltip =
    display.tooltip.kind === "code"
      ? t("public.codeNameTooltip", { code: display.tooltip.name })
      : t("tabroom.common.realNameTooltip", { name: display.tooltip.name });
  return (
    <abbr title={tooltip} className="no-underline">
      {shown}
      <span className="sr-only"> ({tooltip})</span>
    </abbr>
  );
}
