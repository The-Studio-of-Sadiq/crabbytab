import React from "react";
import { DebateSide } from "@/types";
import { cn } from "@/components/ui/cn";

const SIDE_LABELS: Record<DebateSide, string> = {
  OG: "Opening Government",
  OO: "Opening Opposition",
  CG: "Closing Government",
  CO: "Closing Opposition",
  AFF: "Affirmative",
  NEG: "Negative",
};

/** Debate position label. The abbreviation is the text; colour only aids scanning. */
export function SideBadge({ side, className }: { side: DebateSide; className?: string }) {
  const label = SIDE_LABELS[side] ?? side;
  return (
    <span
      title={label}
      className={cn(
        "inline-flex h-5 items-center rounded-sm px-1.5 text-[11px] font-semibold uppercase tracking-wide",
        `side-badge-${String(side).toLowerCase()}`,
        className
      )}
    >
      {side}
    </span>
  );
}
