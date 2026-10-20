"use client";

import React, { useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";

/**
 * Confirmation for consequential actions. Focus starts on "No, cancel" so an
 * accidental Enter does not confirm. Escape cancels unless the action is busy.
 */
export function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  variant = "primary",
  isBusy = false,
  error,
  cancelLabel = "No, cancel",
  busyLabel = "Saving...",
  closeLabel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "primary" | "danger";
  isBusy?: boolean;
  error?: string;
  /** Translated button labels; English defaults. */
  cancelLabel?: string;
  busyLabel?: string;
  closeLabel?: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      role="alertdialog"
      onClose={onCancel}
      dismissible={!isBusy}
      initialFocusRef={cancelRef}
      title={title}
      closeLabel={closeLabel}
      description={description}
      icon={<AlertTriangle className={variant === "danger" ? "text-danger" : "text-warning"} aria-hidden="true" />}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={isBusy}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            loading={isBusy}
            loadingText={busyLabel}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
