"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { ComputeKind } from "@/features/tournament/compute/computeJobs";

const LABELS = {
  draw: "tabroom.common.computeDraw",
  allocation: "tabroom.common.computeAllocation",
} as const satisfies Record<ComputeKind, string>;

/**
 * Progress for a draw or allocation running in the background: what is running, for how long, and
 * a way to stop it. The page stays usable meanwhile; a cancelled job saves nothing.
 */
export function ComputeStatus({ kind }: { kind: ComputeKind }) {
  const { computeJob, cancelCompute } = useTournament();
  const { t } = useI18n();
  const running = computeJob?.kind === kind ? computeJob : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!running) return null;
  const seconds = Math.max(0, Math.floor((now - running.startedAt) / 1000));
  return (
    <div className="inline-flex items-center gap-2 text-xs text-fg-muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      <span role="status">{t(LABELS[kind], { seconds })}</span>
      <Button size="sm" variant="secondary" onClick={cancelCompute}>
        {t("common.cancel")}
      </Button>
    </div>
  );
}
