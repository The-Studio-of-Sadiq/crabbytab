"use client";

import type { Institution } from "@/types";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Badge } from "@/components/ui/Badge";
import {
  formatDiversityCounts,
  panelDiversitySummary,
  participantGender,
  participantRegion,
  type DiversityFields,
} from "@/lib/adjudicators/diversity";

interface InstitutionLookup {
  institutionsById: Map<string, Pick<Institution, "region">>;
}

/** Text badges (not colour alone) for a participant's gender and region. */
export function DiversityBadges({ participant, institutionsById }: InstitutionLookup & { participant: DiversityFields }) {
  const { t } = useI18n();
  const gender = participantGender(participant);
  const region = participantRegion(participant, institutionsById);
  return (
    <span className="mt-0.5 inline-flex flex-wrap items-center gap-1">
      <Badge className="h-4 px-1 text-[10px]" title={t("tabroom.allocation.genderLabel")}>
        <span className="sr-only">{t("tabroom.allocation.genderSr")}</span>
        {gender ?? t("tabroom.allocation.genderUnknown")}
      </Badge>
      <Badge tone="info" className="h-4 px-1 text-[10px]" title={t("tabroom.allocation.regionLabel")}>
        <span className="sr-only">{t("tabroom.allocation.regionSr")}</span>
        {region ?? t("tabroom.allocation.regionUnknown")}
      </Badge>
    </span>
  );
}

export function PanelDiversityLine({ members, institutionsById }: InstitutionLookup & { members: DiversityFields[] }) {
  const { t, plural } = useI18n();
  const summary = panelDiversitySummary(members, institutionsById);
  return (
    <div className="border-b border-border bg-background px-3 py-1 text-[11px] text-fg-muted">
      <span className="font-semibold text-fg">{plural("tabroom.allocation.panelOf", summary.size)}</span>{" "}
      <span>{t("tabroom.allocation.panelGenders", { counts: formatDiversityCounts(summary.genders) })}</span>
      <span className="mx-1 text-fg-subtle" aria-hidden="true">·</span>
      <span>{t("tabroom.allocation.panelRegions", { counts: formatDiversityCounts(summary.regions) })}</span>
    </div>
  );
}
