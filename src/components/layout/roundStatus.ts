import type { Round } from "@/types";
import type { Tone } from "@/components/ui/Badge";

/** Text + tone for a round's draw state, shared by the shell and overview. */
export function describeRoundStatus(round: Pick<Round, "drawStatus" | "resultsReleased" | "completed">): {
  short: string;
  label: string;
  tone: Tone;
} {
  const draw =
    round.drawStatus === "released"
      ? { short: "Released", label: "Draw released", tone: "success" as const }
      : round.drawStatus === "confirmed"
      ? { short: "Confirmed", label: "Draw confirmed", tone: "success" as const }
      : round.drawStatus === "draft"
      ? { short: "Draft", label: "Draft draw", tone: "warning" as const }
      : { short: "No draw", label: "No draw yet", tone: "neutral" as const };
  if (round.completed) return { ...draw, label: `${draw.label} · completed` };
  if (round.resultsReleased) return { ...draw, label: `${draw.label} · results published` };
  return draw;
}
