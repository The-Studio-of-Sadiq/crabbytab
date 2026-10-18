"use client";

import React, { useState } from "react";
import { BellRing, Send } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";
import {
  baselineNotificationsCommand,
  describeNotificationSummary,
  sendDueNotificationsCommand,
} from "@/features/tournament/application/notifications";
import type { RoundNotificationEvent } from "@/lib/email/notifications";
import type { TournamentPreferences } from "@/types";

type NotificationPreference = "notifyDrawReleased" | "notifyTeamPoints" | "notifyBallotReceipt";

const OPTIONS: { key: NotificationPreference; label: string; description: string; events: RoundNotificationEvent[] }[] = [
  {
    key: "notifyDrawReleased",
    label: "Draw released",
    description:
      "Each team's speakers get their side, room and opponents once the draw is confirmed. Adjudicators get their allocation once panels are revealed.",
    events: ["draw_teams", "draw_adjudicators"],
  },
  {
    key: "notifyTeamPoints",
    label: "Team results",
    description:
      "Each team's speakers get their result and running team points once a round's results are released (never for silent rounds).",
    events: ["team_points"],
  },
  {
    key: "notifyBallotReceipt",
    label: "Ballot receipts",
    description: "Adjudicators who submit a ballot from their private URL get a copy of what they submitted.",
    events: [],
  },
];

/**
 * Opt-in automatic notifications. They are sent by the server from the cloud copy, so a release
 * only triggers email after it has been uploaded; uploads run the trigger automatically.
 */
export function AutomaticNotificationsPanel({ onSent }: { onSent?: () => void }) {
  const { tournament, saveTournament, isOwnerOrAdmin } = useTournament();
  const { user } = useAuth();
  const [saving, setSaving] = useState<NotificationPreference | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (!tournament || !isOwnerOrAdmin) return null;
  const preferences = tournament.preferences;

  const toggle = async (option: (typeof OPTIONS)[number], enabled: boolean) => {
    if (!user) return;
    setSaving(option.key);
    setMessage("");
    setError("");
    try {
      let skipped = 0;
      if (enabled && option.events.length > 0) {
        // Rounds already released in the cloud copy are marked as notified, so switching this on
        // never emails past rounds.
        skipped = await baselineNotificationsCommand({
          tournamentId: tournament.id,
          idToken: await user.getIdToken(),
          events: option.events,
        });
      }
      await saveTournament({
        ...tournament,
        preferences: { ...preferences, [option.key]: enabled } as TournamentPreferences,
      });
      setMessage(
        enabled
          ? `${option.label} notifications are on. They take effect after the next cloud upload${
              skipped > 0 ? `; ${skipped} already-released item(s) will not be emailed` : ""
            }.`
          : `${option.label} notifications are off after the next cloud upload.`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update notifications.");
    } finally {
      setSaving(null);
    }
  };

  const sendNow = async () => {
    if (!user) return;
    setSending(true);
    setMessage("");
    setError("");
    try {
      const summary = await sendDueNotificationsCommand({ tournamentId: tournament.id, idToken: await user.getIdToken() });
      setMessage(describeNotificationSummary(summary).trim() || "No notifications were due.");
      onSent?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send notifications.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section aria-labelledby="automatic-notifications-title" className="space-y-4 rounded-lg border border-[#d0d7de] bg-white p-5 shadow-xs">
      <div>
        <h2 id="automatic-notifications-title" className="flex items-center gap-2 text-sm font-bold text-gray-900">
          <BellRing className="h-4 w-4 text-blue-600" aria-hidden="true" />
          Automatic notifications
        </h2>
        <p className="mt-1 text-xs text-gray-600">
          Sent from the cloud copy only after you upload, and only for data that is released there. Each
          notification is sent once and recorded in campaign history, where failures can be retried.
        </p>
      </div>
      <ul className="divide-y divide-gray-100 rounded border border-gray-200">
        {OPTIONS.map((option) => {
          const enabled = preferences[option.key] === true;
          return (
            <li key={option.key} className="flex items-start gap-3 p-3">
              <input
                id={`notify-${option.key}`}
                type="checkbox"
                checked={enabled}
                disabled={saving !== null}
                onChange={(event) => void toggle(option, event.target.checked)}
                className="mt-0.5"
              />
              <label htmlFor={`notify-${option.key}`} className="text-sm text-gray-800">
                <span className="font-semibold">{option.label}</span>
                <span className="block text-xs text-gray-600">{option.description}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => void sendNow()}
        disabled={sending || (!preferences.notifyDrawReleased && !preferences.notifyTeamPoints)}
        className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        <Send className="h-3.5 w-3.5" aria-hidden="true" />
        {sending ? "Sending…" : "Send due notifications now"}
      </button>
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section>
  );
}
