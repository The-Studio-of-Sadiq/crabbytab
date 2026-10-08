"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import { History, ExternalLink, Hash, ShieldAlert } from "lucide-react";

interface AuditReleaseStatus {
  releasedAt: string;
  eventCount: number;
}

export default function AuditPage() {
  const { auditEvents, isOwnerOrAdmin, loading, tournament, releaseAuditLog } = useTournament();
  const [release, setRelease] = useState<AuditReleaseStatus | null>(null);
  const [releaseStatusLoading, setReleaseStatusLoading] = useState(true);
  const [releasing, setReleasing] = useState(false);
  const [releaseMessage, setReleaseMessage] = useState("");
  const orderedAuditEvents = [...auditEvents].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id)
  );

  useEffect(() => {
    if (!tournament?.slug) return;
    let active = true;
    setReleaseStatusLoading(true);
    fetch(`/api/public/tournaments/${encodeURIComponent(tournament.slug)}/audit?status=1`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!active) return;
        if (response.status === 404) {
          setRelease(null);
        } else if (!response.ok) {
          throw new Error(result.error || "Could not check public release status.");
        } else {
          setRelease({
            releasedAt: result.releasedAt,
            eventCount: result.eventCount,
          });
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setReleaseMessage(error instanceof Error ? error.message : "Could not check public release status.");
      })
      .finally(() => {
        if (active) setReleaseStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tournament?.slug]);

  const publishAuditLog = async () => {
    setReleasing(true);
    setReleaseMessage("");
    try {
      const result = await releaseAuditLog();
      setRelease(result);
      setReleaseMessage(`Published ${result.eventCount} audit events.`);
    } catch (error) {
      setReleaseMessage(error instanceof Error ? error.message : "Could not release the audit log.");
    } finally {
      setReleasing(false);
    }
  };

  if (!loading && !isOwnerOrAdmin) {
    return (
      <div className="max-w-xl mx-auto my-12 rounded-lg border border-amber-200 bg-amber-50 p-8 text-center">
        <ShieldAlert className="mx-auto mb-3 h-7 w-7 text-amber-600" />
        <h1 className="font-bold text-gray-900">Audit log unavailable</h1>
        <p className="mt-1 text-sm text-gray-600">Only tournament owners and administrators can view audit events.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between border-b border-[#d0d7de] pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-gray-900">
            <History className="h-6 w-6 text-blue-600" />
            Audit log
          </h1>
          <p className="mt-1 text-xs text-gray-500">
            Recorded tournament actions and the inputs or outcomes captured at the time.
          </p>
        </div>
        <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-600">
          {auditEvents.length} events
        </span>
      </header>

      {!loading && isOwnerOrAdmin && (
        <section className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Public audit log</h2>
            <p className="mt-1 text-xs text-gray-600">
              A release publishes a snapshot of timestamps, actions, summaries, and hashes. Releasing again updates the public snapshot.
            </p>
            {release && (
              <p className="mt-1 text-xs text-gray-600">
                Last released {new Date(release.releasedAt).toLocaleString()} · {release.eventCount} events
              </p>
            )}
            {releaseMessage && (
              <p className="mt-2 text-xs text-gray-700" role="status">{releaseMessage}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {release && (
              <Link
                href={`/${encodeURIComponent(tournament?.slug || "")}/audit/public`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <ExternalLink className="h-4 w-4" />
                View public log
              </Link>
            )}
            <button
              type="button"
              onClick={publishAuditLog}
              disabled={releasing || releaseStatusLoading}
              className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {releasing
                ? "Releasing…"
                : release
                  ? "Update public snapshot"
                  : "Release audit log"}
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-gray-500">Loading audit history…</p>
      ) : orderedAuditEvents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500">
          No audit events have been recorded yet.
        </div>
      ) : (
        <ol className="space-y-3">
          {orderedAuditEvents.map((event) => (
            <li key={event.id} className="rounded-lg border border-[#d0d7de] bg-white p-4 shadow-xs">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{event.summary}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {event.actorName || (event.actorType === "system" ? "System" : "Public user")}
                    {" · "}{event.category} · {event.action}
                  </p>
                </div>
                <time className="shrink-0 text-xs text-gray-500" dateTime={event.timestamp}>
                  {new Date(event.timestamp).toLocaleString()}
                </time>
              </div>
                {event.hash && (
                  <div className="mt-3 flex items-start gap-2 rounded bg-gray-50 p-2">
                    <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
                    <p className="break-all font-mono text-[10px] text-gray-600">
                      {event.hash}
                    </p>
                  </div>
                )}
                {!event.hash && release && (
                  <p className="mt-2 text-[11px] text-amber-700">
                    This event is newer than the public snapshot and will be included when the log is released again.
                  </p>
                )}
                {(event.roundId || event.debateId) && (
                  <p className="mt-2 text-[11px] text-gray-500">
                  {event.roundId && <span>Round: {event.roundId}</span>}
                  {event.roundId && event.debateId && " · "}
                  {event.debateId && <span>Debate: {event.debateId}</span>}
                </p>
              )}
              {event.details && Object.keys(event.details).length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-blue-700">
                    Event details
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-3 text-[11px] text-gray-700">
                    {JSON.stringify(event.details, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
