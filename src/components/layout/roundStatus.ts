import type { Round } from "@/types";
import { drawStageOf } from "@/lib/draw/drawStatus";
import type { Tone } from "@/components/ui/Badge";
import { DEFAULT_LOCALE, translate, type MessageKey, type MessageValues } from "@/lib/i18n";

type Translate = (key: MessageKey, values?: MessageValues) => string;

const english: Translate = (key, values) => translate(DEFAULT_LOCALE, key, values);

/**
 * Text + tone for a round's draw state, shared by the shell and overview. Pass `t` from
 * `useI18n()` to get the viewer's language; without it the text is English.
 */
export function describeRoundStatus(
  round: Pick<Round, "drawStatus" | "resultsReleased" | "completed">,
  t: Translate = english
): {
  short: string;
  label: string;
  tone: Tone;
} {
  // By stage: the stored "confirmed" is the public release; "locked" is confirmed-but-unreleased.
  const stage = drawStageOf(round);
  const draw =
    stage === "released"
      ? { short: t("setup.shell.roundStatusReleasedShort"), label: t("setup.shell.roundStatusReleased"), tone: "success" as const }
      : stage === "teams_released"
      ? { short: t("setup.shell.roundStatusTeamsReleasedShort"), label: t("setup.shell.roundStatusTeamsReleased"), tone: "info" as const }
      : stage === "locked"
      ? { short: t("setup.shell.roundStatusConfirmedShort"), label: t("setup.shell.roundStatusConfirmed"), tone: "info" as const }
      : stage === "draft"
      ? { short: t("setup.shell.roundStatusDraftShort"), label: t("setup.shell.roundStatusDraft"), tone: "warning" as const }
      : { short: t("setup.shell.roundStatusNoDrawShort"), label: t("setup.shell.roundStatusNoDraw"), tone: "neutral" as const };
  if (round.completed) return { ...draw, label: t("setup.shell.roundStatusCompleted", { status: draw.label }) };
  if (round.resultsReleased) return { ...draw, label: t("setup.shell.roundStatusResultsPublished", { status: draw.label }) };
  return draw;
}
