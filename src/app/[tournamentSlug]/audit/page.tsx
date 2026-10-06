"use client";

import React from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { History, ShieldAlert } from "lucide-react";

export default function AuditPage() {
  const { auditEvents, isOwnerOrAdmin, loading } = useTournament();
  const orderedAuditEvents = [...auditEvents].sort(
    (a, b) => b.timestamp.localeCompare(a.timestamp)
  );

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
