"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Alert } from "@/components/ui/Feedback";
import { db } from "@/lib/firebase";
import { planReleaseSync } from "@/features/tournament/application/syncStatus";

type Phase = "confirm" | "saving" | "uploading" | "failed";

/**
 * Confirms a public release (or unrelease) and makes it public in the same step. Public pages are
 * served from the published cloud copy, so the release is saved on this device, uploaded with this
 * device's other pending changes, and published. The dialog stays open with the reason if any step
 * fails, so a release never looks public when it is not. See `planReleaseSync`.
 */
export function ReleaseActionDialog({
  title,
  description,
  confirmLabel,
  apply,
  onClose,
  variant = "primary",
}: {
  title: string;
  /** What the change shows or hides; the dialog adds how it reaches the public. */
  description: string;
  confirmLabel: string;
  /** Saves the release on this device; throws when it cannot be saved. */
  apply: () => Promise<void>;
  onClose: () => void;
  variant?: "primary" | "danger";
}) {
  const { user } = useAuth();
  const { isOwnerOrAdmin, pendingChanges, divergedRecords, uploadIssue, uploadToCloud, cloudSyncMessage } =
    useTournament();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>("confirm");
  const [error, setError] = useState("");
  const [releaseSaved, setReleaseSaved] = useState(false);
  const uploadStarted = useRef(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
  }, []);

  const plan = planReleaseSync({
    cloudConfigured: Boolean(db),
    signedIn: Boolean(user),
    canUpload: isOwnerOrAdmin,
    online,
    pendingTotal: pendingChanges.total,
    divergedCount: divergedRecords.length,
    uploadIssue,
  });

  // The upload runs after the render that contains the saved release: `uploadToCloud` reads the
  // provider's current state, so calling it in the same handler as `apply` would upload the
  // previous state.
  useEffect(() => {
    if (phase !== "uploading" || uploadStarted.current) return;
    uploadStarted.current = true;
    void uploadToCloud()
      .then((outcome) => {
        if (outcome.publish === "published" || outcome.publish === "unchanged") {
          onClose();
          return;
        }
        setError(outcome.publishError || "Public pages were not updated.");
        setPhase("failed");
      })
      .catch((uploadError: unknown) => {
        setError(uploadError instanceof Error ? uploadError.message : "The upload failed.");
        setPhase("failed");
      });
  }, [phase, uploadToCloud, onClose]);

  const confirm = async () => {
    if (plan.kind === "blocked") return;
    setError("");
    if (!releaseSaved) {
      setPhase("saving");
      try {
        await apply();
        setReleaseSaved(true);
      } catch (applyError) {
        setError(applyError instanceof Error ? applyError.message : "The change could not be saved. Please try again.");
        setPhase("confirm");
        return;
      }
    }
    if (plan.kind === "local-only") {
      onClose();
      return;
    }
    uploadStarted.current = false;
    setPhase("uploading");
  };

  const busy = phase === "saving" || phase === "uploading";
  const howItReachesThePublic =
    plan.kind === "upload"
      ? "Confirming saves this change, uploads this device's changes and publishes public pages in one step. Viewers' pages refresh within about a minute."
      : "";

  return (
    <Dialog
      open
      role="alertdialog"
      onClose={onClose}
      dismissible={!busy}
      initialFocusRef={cancelRef}
      title={title}
      description={[description, howItReachesThePublic].filter(Boolean).join(" ")}
      icon={<AlertTriangle className={variant === "danger" ? "text-danger" : "text-warning"} aria-hidden="true" />}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={busy}>
            {releaseSaved ? "Close" : "No, cancel"}
          </Button>
          {plan.kind !== "blocked" && (
            <Button
              variant={variant === "danger" ? "danger" : "primary"}
              onClick={confirm}
              loading={busy}
              loadingText={phase === "saving" ? "Saving…" : "Uploading…"}
            >
              {phase === "failed" ? "Try upload again" : plan.kind === "local-only" ? "Save on this device" : confirmLabel}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {plan.kind === "blocked" && (
          <Alert tone="warning" role="alert" title="This can't be released right now">
            {plan.reason}
          </Alert>
        )}
        {plan.kind === "local-only" && <Alert tone="info">{plan.reason}</Alert>}
        {plan.kind === "upload" && plan.otherPendingTotal > 0 && phase === "confirm" && (
          <Alert tone="info" title={`${plan.otherPendingTotal} other change(s) will be uploaded too`}>
            Changes made on this device since the last upload are published together with this release.
          </Alert>
        )}
        {phase === "uploading" && (
          <p role="status" className="text-xs text-fg-muted">
            {cloudSyncMessage || "Uploading…"}
          </p>
        )}
        {error && (
          <Alert tone="danger" role="alert" title={releaseSaved ? "Saved on this device, but not public yet" : undefined}>
            {error}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
