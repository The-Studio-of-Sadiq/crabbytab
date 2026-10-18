"use client";

import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

/**
 * Lists records changed both on this device and in the cloud, with the fields that differ, and
 * lets staff keep either version per record or for all of them.
 */
export function SyncConflictsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { divergedRecordSummaries: summaries, resolveDivergedRecords } = useTournament();
  const [error, setError] = useState("");

  const resolve = (keep: "cloud" | "local", keys?: string[]) => {
    setError("");
    try {
      resolveDivergedRecords(keep, keys);
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "Could not resolve the conflict.");
    }
  };

  const resolveAll = (keep: "cloud" | "local") => {
    const prompt = keep === "cloud"
      ? `Use the cloud version of all ${summaries.length} record(s)? This device's changes to them are discarded. Export a tournament backup first to keep a copy.`
      : `Keep this device's version of all ${summaries.length} record(s)? The next upload replaces the cloud versions, which are archived for recovery.`;
    if (window.confirm(prompt)) resolve(keep);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      icon={<AlertTriangle className="text-warning" aria-hidden="true" />}
      title="Sync conflicts"
      description="These records changed on this device and in the cloud since this device last synced them. This device's version stays in use until you choose."
      footer={
        summaries.length > 0 ? (
          <>
            <Button variant="secondary" onClick={() => resolveAll("local")}>Keep all of mine</Button>
            <Button variant="danger" onClick={() => resolveAll("cloud")}>Use all cloud versions</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>Close</Button>
        )
      }
    >
      {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}
      {summaries.length === 0 ? (
        <p role="status" className="text-[13px] text-fg-muted">
          No conflicts left. Upload to send the versions you kept to the cloud.
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
                    aria-label={`Keep this device's version of ${summary.kind.toLowerCase()} ${summary.name}`}
                  >
                    Keep mine
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => resolve("cloud", [summary.key])}
                    aria-label={`Use the cloud version of ${summary.kind.toLowerCase()} ${summary.name}`}
                  >
                    Use cloud
                  </Button>
                </div>
              </div>
              {summary.missingLocally ? (
                <p className="mt-2 text-xs text-fg-muted">This device no longer has this record.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">Fields that differ for {summary.name}</caption>
                    <thead className="text-fg-muted">
                      <tr>
                        <th scope="col" className="py-1 pr-3 font-medium">Field</th>
                        <th scope="col" className="py-1 pr-3 font-medium">This device</th>
                        <th scope="col" className="py-1 font-medium">Cloud</th>
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
