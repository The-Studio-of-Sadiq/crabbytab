"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { CLOUD_COLLECTIONS, type CloudCollectionName } from "@/features/tournament/collections";
import type { BackupDiff, BackupValidation } from "@/features/tournament/application/tournamentBackup";

const COLLECTION_LABELS: Record<CloudCollectionName, string> = {
  rounds: "Rounds",
  teams: "Teams",
  adjudicators: "Adjudicators",
  venues: "Venues",
  motions: "Motions",
  breakCategories: "Break categories",
  debates: "Debates",
  ballots: "Ballots",
  feedback: "Feedback",
  institutions: "Institutions",
  auditEvents: "Audit log (always merged)",
  ballotIntake: "Ballot intake",
};

/** Validates a backup, shows how it differs from this tournament, then merges or replaces. */
export function BackupRestoreDialog({ onClose }: { onClose: () => void }) {
  const { tournament, previewTournamentBackup, importTournamentBackup, replaceTournamentWithBackup } = useTournament();
  const titleId = useId();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ validation: BackupValidation; diff?: BackupDiff } | null>(null);
  const [busy, setBusy] = useState<"" | "reading" | "merging" | "replacing">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);

  useEffect(() => {
    fileInputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setPreview(null);
    setError("");
    setDone("");
    setConfirmReplace(false);
    if (!chosen) return;
    setBusy("reading");
    try {
      setPreview(await previewTournamentBackup(chosen));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Could not read the backup.");
    } finally {
      setBusy("");
    }
  };

  const run = async (mode: "merging" | "replacing") => {
    if (!file) return;
    setBusy(mode);
    setError("");
    try {
      if (mode === "merging") await importTournamentBackup(file);
      else await replaceTournamentWithBackup(file);
      setDone(
        mode === "merging"
          ? "Backup merged. Records that were missing here were added; existing records were kept."
          : "Tournament data replaced with the backup. Your previous data was downloaded as a pre-restore backup."
      );
      setPreview(null);
      setFile(null);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "The restore failed. Nothing was changed.");
    } finally {
      setBusy("");
    }
  };

  const errors = preview?.validation.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = preview?.validation.issues.filter((issue) => issue.severity === "warning") ?? [];
  const usable = Boolean(preview?.validation.backup) && errors.length === 0;
  const diff = preview?.diff;
  const removedTotal = diff
    ? CLOUD_COLLECTIONS.filter((name) => name !== "auditEvents").reduce((sum, name) => sum + diff.collections[name].removed, 0)
    : 0;
  const changedTotal = diff
    ? CLOUD_COLLECTIONS.filter((name) => name !== "auditEvents").reduce((sum, name) => sum + diff.collections[name].changed, 0)
    : 0;

  return (
    <div className="fixed inset-0 z-[70] flex select-text items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-gray-200 bg-white text-gray-900 shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-sm font-bold">Restore tournament backup</h2>
            <p className="mt-1 text-xs text-gray-600">
              Choose a backup of {tournament?.name ?? "this tournament"}. It is checked and compared with the data on
              this device before anything changes.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(busy)}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4 text-xs">
          <div>
            <label htmlFor={fileInputId} className="mb-1 block font-semibold text-gray-700">Backup file (.json)</label>
            <input
              id={fileInputId}
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFile}
              disabled={Boolean(busy)}
              className="block w-full text-xs file:mr-3 file:rounded file:border file:border-gray-300 file:bg-gray-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold"
            />
          </div>

          {busy === "reading" && (
            <p className="flex items-center gap-2 text-gray-600" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the backup…
            </p>
          )}
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}
          {done && (
            <p role="status" className="flex items-start gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {done}
            </p>
          )}

          {preview && (
            <>
              {errors.length > 0 && (
                <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                  <p className="font-bold">This backup cannot be restored ({errors.length} problem{errors.length === 1 ? "" : "s"}):</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {errors.map((issue, index) => (
                      <li key={index}>
                        <span className="font-semibold">Error</span>
                        {issue.collection !== "file" && ` in ${issue.collection}${issue.recordId ? ` (${issue.recordId})` : ""}`}: {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {warnings.length > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  <p className="font-bold">Warnings ({warnings.length}): these records can still be restored.</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {warnings.map((issue, index) => (
                      <li key={index}>
                        <span className="font-semibold">Warning</span>
                        {issue.collection !== "file" && ` in ${issue.collection}${issue.recordId ? ` (${issue.recordId})` : ""}`}: {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {diff && usable && (
                <div className="space-y-2">
                  <p className="font-semibold text-gray-800">
                    Backup exported {preview.validation.backup?.exportedAt ?? "at an unknown time"}.
                    {diff.hasChanges ? " Compared with this device:" : " It matches the data on this device."}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left tabby-table">
                      <caption className="sr-only">Differences between the backup and this device</caption>
                      <thead>
                        <tr>
                          <th scope="col">Records</th>
                          <th scope="col" className="text-right">Only in backup</th>
                          <th scope="col" className="text-right">Only here</th>
                          <th scope="col" className="text-right">Different</th>
                          <th scope="col" className="text-right">Same</th>
                        </tr>
                      </thead>
                      <tbody>
                        {CLOUD_COLLECTIONS.map((name) => {
                          const row = diff.collections[name];
                          return (
                            <tr key={name}>
                              <th scope="row" className="font-medium">{COLLECTION_LABELS[name]}</th>
                              <td className="text-right font-mono">{row.added}</td>
                              <td className="text-right font-mono">{row.removed}</td>
                              <td className="text-right font-mono">{row.changed}</td>
                              <td className="text-right font-mono">{row.unchanged}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {diff.tournamentSettingsChanged && (
                    <p className="flex items-start gap-2 text-gray-700">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Tournament settings differ. Replace uses the backup&apos;s
                      settings; the URL, owner and administrators never change.
                    </p>
                  )}

                  <div className="grid gap-3 pt-2 sm:grid-cols-2">
                    <div className="rounded border border-gray-200 p-3">
                      <p className="font-bold">Merge</p>
                      <p className="mt-1 text-gray-600">Adds the records that are only in the backup. Records on this device are kept as they are.</p>
                      <button
                        type="button"
                        onClick={() => run("merging")}
                        disabled={Boolean(busy)}
                        className="mt-3 inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
                      >
                        {busy === "merging" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Merge backup
                      </button>
                    </div>
                    <div className="rounded border border-red-200 p-3">
                      <p className="font-bold text-red-800">Replace</p>
                      <p className="mt-1 text-gray-600">
                        Makes this tournament exactly match the backup: {removedTotal} record{removedTotal === 1 ? "" : "s"} only on
                        this device will be deleted and {changedTotal} will be overwritten. A pre-restore backup downloads first.
                      </p>
                      <label className="mt-2 flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={confirmReplace}
                          onChange={(event) => setConfirmReplace(event.target.checked)}
                          disabled={Boolean(busy)}
                          className="mt-0.5"
                        />
                        <span>I understand that this replaces the tournament&apos;s data on this device.</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => run("replacing")}
                        disabled={Boolean(busy) || !confirmReplace}
                        className="mt-3 inline-flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 font-bold text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"
                      >
                        {busy === "replacing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Replace this tournament&apos;s data
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
