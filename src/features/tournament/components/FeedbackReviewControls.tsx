"use client";

import { useState } from "react";
import type { FeedbackSubmission } from "@/types";
import type { FeedbackReviewChange } from "@/features/tournament/application/feedback";
import { useI18n } from "@/components/i18n/I18nProvider";
import { StatusPill, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

/** Status in words (not colour alone), and confirm/ignore toggles for administrators. */
export function FeedbackReviewControls({
  submission,
  canEdit,
  onReview,
}: {
  submission: FeedbackSubmission;
  canEdit: boolean;
  onReview(feedbackId: string, change: FeedbackReviewChange): Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status: { tone: Tone; label: string } = submission.ignored
    ? { tone: "neutral", label: t("results.feedback.review.ignored") }
    : submission.confirmed
    ? { tone: "success", label: t("results.feedback.review.confirmed") }
    : { tone: "warning", label: t("results.feedback.review.unconfirmed") };

  const review = async (change: FeedbackReviewChange) => {
    setBusy(true);
    setError("");
    try {
      await onReview(submission.id, change);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("results.feedback.review.updateFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusPill tone={status.tone}>{status.label}</StatusPill>
      {canEdit && (
        <>
          <Button size="sm" disabled={busy} onClick={() => review({ confirmed: !submission.confirmed })}>
            {submission.confirmed ? t("results.feedback.review.unconfirm") : t("results.feedback.review.confirm")}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => review({ ignored: !submission.ignored })}>
            {submission.ignored ? t("results.feedback.review.countAgain") : t("results.feedback.review.ignore")}
          </Button>
        </>
      )}
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
