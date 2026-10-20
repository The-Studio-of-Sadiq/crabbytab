import type { Round } from "@/types";
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
  const draw =
    round.drawStatus === "released"
      ? { short: t("setup.shell.roundStatusReleasedShort"), label: t("setup.shell.roundStatusReleased"), tone: "success" as const }
      : round.drawStatus === "confirmed"
      ? { short: t("setup.shell.roundStatusConfirmedShort"), label: t("setup.shell.roundStatusConfirmed"), tone: "success" as const }
      : round.drawStatus === "draft"
      ? { short: t("setup.shell.roundStatusDraftShort"), label: t("setup.shell.roundStatusDraft"), tone: "warning" as const }
      : { short: t("setup.shell.roundStatusNoDrawShort"), label: t("setup.shell.roundStatusNoDraw"), tone: "neutral" as const };
  if (round.completed) return { ...draw, label: t("setup.shell.roundStatusCompleted", { status: draw.label }) };
  if (round.resultsReleased) return { ...draw, label: t("setup.shell.roundStatusResultsPublished", { status: draw.label }) };
  return draw;
}
