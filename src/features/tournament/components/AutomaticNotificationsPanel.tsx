"use client";

import React, { useState } from "react";
import { BellRing, Send } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import {
  baselineNotificationsCommand,
  hasAutomaticRoundNotifications,
  sendDueNotificationsCommand,
} from "@/features/tournament/application/notifications";
import type { RoundNotificationEvent } from "@/lib/email/notifications";
import type { MessageKey } from "@/lib/i18n/messages";
import type { TournamentPreferences } from "@/types";

type NotificationPreference =
  | "notifyDrawReleased"
  | "notifyTeamPoints"
  | "notifyBallotReceipt"
  | "notifyMotionsReleased"
  | "notifyBallotConfirmed";

const OPTIONS: {
  key: NotificationPreference;
  label: MessageKey;
  description: MessageKey;
  events: Array<RoundNotificationEvent | "ballot_confirmed">;
}[] = [
  {
    key: "notifyDrawReleased",
    label: "setup.email.notifyDrawReleased",
    description: "setup.email.notifyDrawReleasedHelp",
    events: ["draw_teams", "draw_adjudicators"],
  },
  {
    key: "notifyTeamPoints",
    label: "setup.email.notifyTeamPoints",
    description: "setup.email.notifyTeamPointsHelp",
    events: ["team_points"],
  },
  {
    key: "notifyMotionsReleased",
    label: "setup.email.notifyMotionsReleased",
    description: "setup.email.notifyMotionsReleasedHelp",
    events: ["motions_released"],
  },
  {
    key: "notifyBallotConfirmed",
    label: "setup.email.notifyBallotConfirmed",
    description: "setup.email.notifyBallotConfirmedHelp",
    events: ["ballot_confirmed"],
  },
  {
    key: "notifyBallotReceipt",
    label: "setup.email.notifyBallotReceipt",
    description: "setup.email.notifyBallotReceiptAllHelp",
    // Receipts also go out for tab-room confirmations; switching on starts after the current ones.
    events: ["ballot_confirmed"],
  },
];

/**
 * Opt-in automatic notifications. They are sent by the server from the cloud copy, so a release
 * only triggers email after it has been uploaded; uploads run the trigger automatically.
 */
export function AutomaticNotificationsPanel({ onSent }: { onSent?: () => void }) {
  const { tournament, saveTournament, isOwnerOrAdmin } = useTournament();
  const { user } = useAuth();
  const { t, plural } = useI18n();
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
      const label = t(option.label);
      setMessage(
        !enabled
          ? t("setup.email.notificationsOff", { label })
          : skipped > 0
            ? plural("setup.email.notificationsOnSkipped", skipped, { label })
            : t("setup.email.notificationsOn", { label })
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("setup.email.notificationsUpdateFailed"));
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
      // Same cases as describeNotificationSummary, worded through the catalogue.
      setMessage(
        summary.campaigns === 0
          ? t("setup.email.noneDue")
          : summary.failed > 0
            ? t("setup.email.dueSummaryFailed", { sent: summary.sent, failed: summary.failed })
            : t("setup.email.dueSummary", { sent: summary.sent })
      );
      onSent?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("setup.email.sendDueFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<BellRing aria-hidden="true" />}
        title={t("setup.email.autoTitle")}
        description={t("setup.email.autoDescription")}
      />
      <CardBody className="space-y-4">
        <ul className="divide-y divide-border rounded-md border border-border">
          {OPTIONS.map((option) => {
            const enabled = preferences[option.key] === true;
            return (
              <li key={option.key} className="p-3">
                <Checkbox
                  id={`notify-${option.key}`}
                  label={t(option.label)}
                  description={t(option.description)}
                  checked={enabled}
                  disabled={saving !== null}
                  onChange={(event) => void toggle(option, event.target.checked)}
                />
              </li>
            );
          })}
        </ul>
        <Button
          size="sm"
          onClick={() => void sendNow()}
          disabled={!hasAutomaticRoundNotifications(preferences)}
          loading={sending}
          loadingText={t("setup.email.sending")}
        >
          <Send aria-hidden="true" />
          {t("setup.email.sendDueNow")}
        </Button>
        {message && <Alert tone="success" role="status">{message}</Alert>}
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
      </CardBody>
    </Card>
  );
}
