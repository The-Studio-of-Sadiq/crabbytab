"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";

export function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  variant = "primary",
  isBusy = false,
  error,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "primary" | "danger";
  isBusy?: boolean;
  error?: string;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-action-title"
        aria-describedby="confirm-action-description"
        className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 text-gray-900 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 rounded-full p-2 ${variant === "danger" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <h2 id="confirm-action-title" className="text-sm font-bold">
              {title}
            </h2>
            <p id="confirm-action-description" className="mt-2 text-xs leading-relaxed text-gray-600">
              {description}
            </p>
            {error && <p role="alert" className="mt-2 text-xs font-medium text-red-700">{error}</p>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            No, cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className={`rounded px-3 py-2 text-xs font-bold text-white disabled:opacity-50 ${
              variant === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {isBusy ? "Saving..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}