import React from "react";
import { DebateSide, TournamentPreferences } from "@/types";
import { cn } from "@/components/ui/cn";
import { sideLabel } from "@/lib/sideNames";

/**
 * Debate position label. The abbreviation is the text; colour only aids scanning. Pass the
 * tournament's preferences so two-team sides use its side names (Gov/Opp, Prop/Opp, ...).
 */
export function SideBadge({
  side,
  className,
  preferences,
}: {
  side: DebateSide;
  className?: string;
  preferences?: Partial<Pick<TournamentPreferences, "sideNames">>;
}) {
  return (
    <span
      title={sideLabel(side, preferences, "full")}
      className={cn(
        "inline-flex h-5 items-center rounded-sm px-1.5 text-[11px] font-semibold uppercase tracking-wide",
        `side-badge-${String(side).toLowerCase()}`,
        className
      )}
    >
      {sideLabel(side, preferences)}
    </span>
  );
}
