"use client";

import type { TournamentPreferences } from "@/types";
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
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Feedback score step"
          type="number"
          min={0.01}
          step={0.01}
          value={value.feedbackScoreStep ?? 1}
          help="e.g. 1 for whole points, 0.5 for half points"
          onChange={(event) => {
            const step = parseFloat(event.target.value);
            onChange({ feedbackScoreStep: Number.isFinite(step) && step > 0 ? step : 1 });
          }}
        />
        <Input
          label="Important feedback threshold"
          type="number"
          min={0}
          step={0.5}
          value={value.feedbackImportantThreshold ?? 2}
          help="Feedback this far from the base score is listed as important"
          onChange={(event) => {
            const threshold = parseFloat(event.target.value);
            onChange({ feedbackImportantThreshold: Number.isFinite(threshold) && threshold >= 0 ? threshold : 2 });
          }}
        />
      </div>
      <Textarea
        label="Feedback introduction"
        rows={2}
        maxLength={2000}
        value={value.feedbackIntroduction ?? ""}
        help="Shown above every feedback form in the private portals."
        onChange={(event) => onChange({ feedbackIntroduction: event.target.value })}
      />
      <Checkbox
        label="Show unexpected feedback"
        description="List submissions that no feedback path expected (marked ?) in feedback progress."
        checked={value.showUnexpectedFeedback !== false}
        onChange={(event) => onChange({ showUnexpectedFeedback: event.target.checked })}
      />
    </div>
  );
}
