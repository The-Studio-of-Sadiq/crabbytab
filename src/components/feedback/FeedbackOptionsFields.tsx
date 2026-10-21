"use client";

import type { TournamentPreferences } from "@/types";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Checkbox, Input, Textarea } from "@/components/ui/Field";

type FeedbackOptions = Pick<
  TournamentPreferences,
  "feedbackScoreStep" | "feedbackIntroduction" | "showUnexpectedFeedback" | "feedbackImportantThreshold"
>;

/**
 * Tabbycat's adj_score_step, feedback_introduction and show_unexpected_feedback, plus the
 * "important feedback" threshold (docs/adjudicator-allocation.md, "Feedback options").
 */
export function FeedbackOptionsFields({
  value,
  onChange,
}: {
  value: Partial<FeedbackOptions>;
  onChange: (change: Partial<FeedbackOptions>) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={t("results.feedback.options.scoreStep")}
          type="number"
          min={0.01}
          step={0.01}
          value={value.feedbackScoreStep ?? 1}
          help={t("results.feedback.options.scoreStepHelp")}
          onChange={(event) => {
            const step = parseFloat(event.target.value);
            onChange({ feedbackScoreStep: Number.isFinite(step) && step > 0 ? step : 1 });
          }}
        />
        <Input
          label={t("results.feedback.options.importantThreshold")}
          type="number"
          min={0}
          step={0.5}
          value={value.feedbackImportantThreshold ?? 2}
          help={t("results.feedback.options.importantThresholdHelp")}
          onChange={(event) => {
            const threshold = parseFloat(event.target.value);
            onChange({ feedbackImportantThreshold: Number.isFinite(threshold) && threshold >= 0 ? threshold : 2 });
          }}
        />
      </div>
      <Textarea
        label={t("results.feedback.options.introduction")}
        rows={2}
        maxLength={2000}
        value={value.feedbackIntroduction ?? ""}
        help={t("results.feedback.options.introductionHelp")}
        onChange={(event) => onChange({ feedbackIntroduction: event.target.value })}
      />
      <Checkbox
        label={t("results.feedback.options.showUnexpected")}
        description={t("results.feedback.options.showUnexpectedHelp")}
        checked={value.showUnexpectedFeedback !== false}
        onChange={(event) => onChange({ showUnexpectedFeedback: event.target.checked })}
      />
    </div>
  );
}
