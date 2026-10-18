"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useTournament } from "@/contexts/TournamentContext";
import type { ComputeKind } from "@/features/tournament/compute/computeJobs";

const LABELS: Record<ComputeKind, string> = {
  draw: "Generating the draw",
  allocation: "Allocating adjudicators",
};

/**
 * Progress for a draw or allocation running in the background: what is running, for how long, and
 * a way to stop it. The page stays usable meanwhile; a cancelled job saves nothing.
 */
export function ComputeStatus({ kind }: { kind: ComputeKind }) {
  const { computeJob, cancelCompute } = useTournament();
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
    <div className="inline-flex items-center gap-2 text-xs text-gray-600">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      <span role="status">{`${LABELS[kind]}… ${seconds} s`}</span>
      <Button size="sm" variant="secondary" onClick={cancelCompute}>
        Cancel
      </Button>
    </div>
  );
}
