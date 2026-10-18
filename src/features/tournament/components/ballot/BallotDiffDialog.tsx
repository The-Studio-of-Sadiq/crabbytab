"use client";

import React, { useEffect, useRef } from "react";
import { GitCompare } from "lucide-react";
import type { BallotDifference } from "@/lib/ballots/result";

interface BallotDiffDialogProps {
  differences: BallotDifference[];
  firstLabel: string;
  secondLabel: string;
  busy?: boolean;
  onKeepFirst: () => void;
  onKeepSecond: () => void;
  onClose: () => void;
}

/** Shown when a blind check does not match the entry it checks; the checker picks which to record. */
export function BallotDiffDialog({
  differences,
  firstLabel,
  secondLabel,
  busy,
  onKeepFirst,
  onKeepSecond,
  onClose,
}: BallotDiffDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ballot-diff-title"
        className="w-full max-w-2xl space-y-4 rounded-lg bg-white p-6 shadow-xl"
      >
        <h3 id="ballot-diff-title" className="flex items-center gap-2 text-base font-bold text-gray-900">
          <GitCompare className="h-5 w-5 text-amber-600" />
          The two entries do not match
        </h3>
        <p className="text-xs text-gray-600">
          Check the paper ballot, then record the correct entry. The other one is kept as a discarded version.
        </p>
        <div className="max-h-80 overflow-auto rounded border border-gray-200 text-xs">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-gray-100 text-gray-700">
              <tr>
                <th className="p-2 font-bold">Field</th>
                <th className="p-2 font-bold">{firstLabel}</th>
                <th className="p-2 font-bold">{secondLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-mono">
              {differences.map((difference) => (
                <tr key={difference.field}>
                  <td className="p-2 font-sans font-semibold text-gray-900">{difference.field}</td>
                  <td className="p-2 text-gray-800">{difference.first}</td>
                  <td className="p-2 text-gray-800">{difference.second}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-3">
          <button ref={closeRef} type="button" onClick={onClose} className="rounded bg-gray-100 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200">
            Go back and correct
          </button>
          <button type="button" disabled={busy} onClick={onKeepFirst} className="rounded border border-blue-600 px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
            Record {firstLabel.toLowerCase()}
          </button>
          <button type="button" disabled={busy} onClick={onKeepSecond} className="rounded bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            Record {secondLabel.toLowerCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
