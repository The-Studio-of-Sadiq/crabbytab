"use client";

import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { useI18n } from "@/components/i18n/I18nProvider";

/**
 * Lists records changed both on this device and in the cloud, with the fields that differ, and
 * lets staff keep either version per record or for all of them.
 */
export function SyncConflictsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, plural } = useI18n();
  const { divergedRecordSummaries: summaries, resolveDivergedRecords } = useTournament();
  const [error, setError] = useState("");

  const resolve = (keep: "cloud" | "local", keys?: string[]) => {
    setError("");
    try {
      resolveDivergedRecords(keep, keys);
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : t("setup.data.sync.resolveFailed"));
    }
  };

  // Asked in an in-page dialog, not window.confirm: a native dialog blocks the page's script
  // (and browser automation) until answered, and cannot be translated or styled.
  const [confirmingAll, setConfirmingAll] = useState<"cloud" | "local" | null>(null);

  const confirmAll = () => {
    if (!confirmingAll) return;
    const keep = confirmingAll;
    setConfirmingAll(null);
    resolve(keep);
  };

  if (confirmingAll && open) {
    return (
      <ConfirmActionDialog
        title={confirmingAll === "cloud" ? t("setup.data.sync.useAllCloud") : t("setup.data.sync.keepAllMine")}
        description={confirmingAll === "cloud"
          ? plural("setup.data.sync.useAllCloudConfirm", summaries.length)
          : plural("setup.data.sync.keepAllMineConfirm", summaries.length)}
        confirmLabel={confirmingAll === "cloud" ? t("setup.data.sync.useAllCloud") : t("setup.data.sync.keepAllMine")}
        variant={confirmingAll === "cloud" ? "danger" : "primary"}
        onConfirm={confirmAll}
        onCancel={() => setConfirmingAll(null)}
      />
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      icon={<AlertTriangle className="text-warning" aria-hidden="true" />}
      title={t("setup.data.sync.title")}
      description={t("setup.data.sync.description")}
      footer={
        summaries.length > 0 ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmingAll("local")}>{t("setup.data.sync.keepAllMine")}</Button>
            <Button variant="danger" onClick={() => setConfirmingAll("cloud")}>{t("setup.data.sync.useAllCloud")}</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>{t("common.close")}</Button>
        )
      }
    >
      {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}
      {summaries.length === 0 ? (
        <p role="status" className="text-[13px] text-fg-muted">
          {t("setup.data.sync.noneLeft")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {summaries.map((summary) => (
            <li key={summary.key} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-fg-muted">{summary.kind}</p>
                  <p className="truncate text-[13px] font-medium text-fg">{summary.name}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => resolve("local", [summary.key])}
                    aria-label={t("setup.data.sync.keepMineLabel", { kind: summary.kind.toLowerCase(), name: summary.name })}
                  >
                    {t("setup.data.sync.keepMine")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => resolve("cloud", [summary.key])}
                    aria-label={t("setup.data.sync.useCloudLabel", { kind: summary.kind.toLowerCase(), name: summary.name })}
                  >
                    {t("setup.data.sync.useCloud")}
                  </Button>
                </div>
              </div>
              {summary.missingLocally ? (
                <p className="mt-2 text-xs text-fg-muted">{t("setup.data.sync.missingLocally")}</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">{t("setup.data.sync.fieldsCaption", { name: summary.name })}</caption>
                    <thead className="text-fg-muted">
                      <tr>
                        <th scope="col" className="py-1 pr-3 font-medium">{t("setup.data.sync.colField")}</th>
                        <th scope="col" className="py-1 pr-3 font-medium">{t("setup.data.sync.colThisDevice")}</th>
                        <th scope="col" className="py-1 font-medium">{t("setup.data.sync.colCloud")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.differences.map((difference) => (
                        <tr key={difference.field} className="border-t border-border align-top">
                          <th scope="row" className="py-1 pr-3 font-mono font-normal text-fg-muted">{difference.field}</th>
                          <td className="break-all py-1 pr-3 font-mono">{difference.local}</td>
                          <td className="break-all py-1 font-mono">{difference.cloud}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
