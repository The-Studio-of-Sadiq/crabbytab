import { useState } from "react";
import type { FeedbackSubmission } from "@/types";
import type { FeedbackReviewChange } from "@/features/tournament/application/feedback";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = submission.ignored ? "Ignored" : submission.confirmed ? "Confirmed" : "Unconfirmed";
  const statusClass = submission.ignored
    ? "bg-gray-100 text-gray-700 border-gray-300"
    : submission.confirmed
    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
    : "bg-amber-50 text-amber-800 border-amber-200";

  const review = async (change: FeedbackReviewChange) => {
    setBusy(true);
    setError("");
    try {
      await onReview(submission.id, change);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the feedback.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusClass}`}>{status}</span>
      {canEdit && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => review({ confirmed: !submission.confirmed })}
            className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {submission.confirmed ? "Unconfirm" : "Confirm"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => review({ ignored: !submission.ignored })}
            className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {submission.ignored ? "Count again" : "Ignore"}
          </button>
        </>
      )}
      {error && <span role="alert" className="text-[10px] text-red-700">{error}</span>}
    </span>
  );
}
