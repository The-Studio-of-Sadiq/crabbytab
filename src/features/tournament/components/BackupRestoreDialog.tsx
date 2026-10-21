"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { CLOUD_COLLECTIONS, type CloudCollectionName } from "@/features/tournament/collections";
import type { BackupDiff, BackupValidation } from "@/features/tournament/application/tournamentBackup";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";

const COLLECTION_LABELS: Record<CloudCollectionName, MessageKey> = {
  rounds: "setup.data.backup.collection.rounds",
  teams: "setup.data.backup.collection.teams",
  adjudicators: "setup.data.backup.collection.adjudicators",
  venues: "setup.data.backup.collection.venues",
  motions: "setup.data.backup.collection.motions",
  breakCategories: "setup.data.backup.collection.breakCategories",
  debates: "setup.data.backup.collection.debates",
  ballots: "setup.data.backup.collection.ballots",
  feedback: "setup.data.backup.collection.feedback",
  institutions: "setup.data.backup.collection.institutions",
  auditEvents: "setup.data.backup.collection.auditEvents",
  ballotIntake: "setup.data.backup.collection.ballotIntake",
};

/** Validates a backup, shows how it differs from this tournament, then merges or replaces. */
export function BackupRestoreDialog({ onClose }: { onClose: () => void }) {
  const { t, plural } = useI18n();
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
      setError(readError instanceof Error ? readError.message : t("setup.data.backup.readFailed"));
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
          ? t("setup.data.backup.merged")
          : t("setup.data.backup.replaced")
      );
      setPreview(null);
      setFile(null);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : t("setup.data.backup.restoreFailed"));
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
            <h2 id={titleId} className="text-sm font-bold">{t("setup.data.backup.title")}</h2>
            <p className="mt-1 text-xs text-gray-600">
              {t("setup.data.backup.intro", { tournament: tournament?.name ?? t("setup.data.backup.thisTournament") })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(busy)}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4 text-xs">
          <div>
            <label htmlFor={fileInputId} className="mb-1 block font-semibold text-gray-700">{t("setup.data.backup.fileLabel")}</label>
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
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("setup.data.backup.checking")}
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
                  <p className="font-bold">{plural("setup.data.backup.cannotRestore", errors.length)}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {errors.map((issue, index) => (
                      <li key={index}>
                        <span className="font-semibold">{t("setup.data.backup.error")}</span>
                        {issue.collection !== "file" && (issue.recordId
                          ? t("setup.data.backup.issueInRecord", { collection: issue.collection, record: issue.recordId })
                          : t("setup.data.backup.issueIn", { collection: issue.collection }))}: {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {warnings.length > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  <p className="font-bold">{t("setup.data.backup.warnings", { count: warnings.length })}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {warnings.map((issue, index) => (
                      <li key={index}>
                        <span className="font-semibold">{t("setup.data.backup.warning")}</span>
                        {issue.collection !== "file" && (issue.recordId
                          ? t("setup.data.backup.issueInRecord", { collection: issue.collection, record: issue.recordId })
                          : t("setup.data.backup.issueIn", { collection: issue.collection }))}: {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {diff && usable && (
                <div className="space-y-2">
                  <p className="font-semibold text-gray-800">
                    {t("setup.data.backup.exportedAt", { time: preview.validation.backup?.exportedAt ?? t("setup.data.backup.unknownTime") })}
                    {diff.hasChanges ? t("setup.data.backup.compared") : t("setup.data.backup.matches")}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left tabby-table">
                      <caption className="sr-only">{t("setup.data.backup.tableCaption")}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{t("setup.data.backup.colRecords")}</th>
                          <th scope="col" className="text-right">{t("setup.data.backup.colOnlyBackup")}</th>
                          <th scope="col" className="text-right">{t("setup.data.backup.colOnlyHere")}</th>
                          <th scope="col" className="text-right">{t("setup.data.backup.colDifferent")}</th>
                          <th scope="col" className="text-right">{t("setup.data.backup.colSame")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {CLOUD_COLLECTIONS.map((name) => {
                          const row = diff.collections[name];
                          return (
                            <tr key={name}>
                              <th scope="row" className="font-medium">{t(COLLECTION_LABELS[name])}</th>
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
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("setup.data.backup.settingsDiffer")}
                    </p>
                  )}

                  <div className="grid gap-3 pt-2 sm:grid-cols-2">
                    <div className="rounded border border-gray-200 p-3">
                      <p className="font-bold">{t("setup.data.backup.mergeTitle")}</p>
                      <p className="mt-1 text-gray-600">{t("setup.data.backup.mergeHelp")}</p>
                      <button
                        type="button"
                        onClick={() => run("merging")}
                        disabled={Boolean(busy)}
                        className="mt-3 inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
                      >
                        {busy === "merging" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {t("setup.data.backup.mergeButton")}
                      </button>
                    </div>
                    <div className="rounded border border-red-200 p-3">
                      <p className="font-bold text-red-800">{t("setup.data.backup.replaceTitle")}</p>
                      <p className="mt-1 text-gray-600">
                        {plural("setup.data.backup.replaceHelp", removedTotal, { changed: changedTotal })}
                      </p>
                      <label className="mt-2 flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={confirmReplace}
                          onChange={(event) => setConfirmReplace(event.target.checked)}
                          disabled={Boolean(busy)}
                          className="mt-0.5"
                        />
                        <span>{t("setup.data.backup.replaceConfirm")}</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => run("replacing")}
                        disabled={Boolean(busy) || !confirmReplace}
                        className="mt-3 inline-flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 font-bold text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"
                      >
                        {busy === "replacing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {t("setup.data.backup.replaceButton")}
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
