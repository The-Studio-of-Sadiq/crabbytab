"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PublicShell } from "@/components/public/PublicShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { CrossTournamentMotionTable } from "@/features/tournament/components/CrossTournamentMotionTable";
import type { CrossTournamentMotionStatistic } from "@/lib/motions/crossTournament";

interface PublicMotionStatisticsResponse {
  tournaments: Array<{ id: string; name: string; slug: string; isBP: boolean; motions: number }>;
  statistics: CrossTournamentMotionStatistic[];
  error?: string;
}

/**
 * Motion statistics pooled across every published tournament that released its own motion
 * statistics (Tabbycat's public motion statistics, across tournaments). Built only from the
 * tournaments' public views, so nothing here is more public than their own pages.
 */
export default function PublicCrossTournamentMotionsPage() {
  const { t } = useI18n();
  const [data, setData] = useState<PublicMotionStatisticsResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/public/motions");
        const result = (await response.json()) as PublicMotionStatisticsResponse;
        if (!response.ok) throw new Error(result.error || "load failed");
        if (active) setData(result);
      } catch (loadError) {
        console.warn("Could not load public motion statistics:", loadError);
        if (active) setError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <PublicShell title={t("publicMotions.shellTitle")} backHref="/" backLabel={t("publicMotions.back")}>
      <div className="space-y-6">
        <PageHeader title={t("publicMotions.title")} description={t("publicMotions.intro")} />
        {error && <Alert tone="warning" role="alert">{t("publicMotions.loadError")}</Alert>}
        {!data && !error && (
          <div className="space-y-3">
            <p role="status" className="text-[13px] text-fg-muted">{t("publicMotions.loading")}</p>
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {data && data.statistics.length === 0 && (
          <EmptyState title={t("publicMotions.emptyTitle")} description={t("publicMotions.emptyBody")} />
        )}
        {data && data.tournaments.length > 0 && (
          <p className="text-[13px] text-fg-muted">
            {t("publicMotions.included")}{" "}
            {data.tournaments.map((tournament, index) => (
              <React.Fragment key={tournament.id}>
                {index > 0 && " · "}
                <Link
                  href={`/${tournament.slug}/public`}
                  className={cn("rounded-sm text-accent-text hover:underline", focusRing)}
                >
                  {tournament.name}
                </Link>
              </React.Fragment>
            ))}
          </p>
        )}
        {data && data.statistics.length > 0 && <CrossTournamentMotionTable statistics={data.statistics} />}
        <p className="text-xs text-fg-muted">{t("publicMotions.freshness")}</p>
      </div>
    </PublicShell>
  );
}
