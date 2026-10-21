"use client";

import React, { useState } from "react";
import { CircleSlash } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Feedback";

/**
 * Lets a team or adjudicator mark themselves available (or not) for the current round from their
 * private portal. Shown only when the organiser enabled self check-in; the server re-checks that
 * and the round on every request.
 */
export function SelfCheckInPanel({ privateKey, passcode }: { privateKey: string; passcode: string }) {
  const { privateSelfCheckIn, syncPrivatePortal } = useTournament();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!privateSelfCheckIn || !passcode) return null;
  const { roundId, roundName, available } = privateSelfCheckIn;

  const submit = async (nextAvailable: boolean) => {
    setSaving(true);
    setError("");
    try {
      await syncPrivatePortal(privateKey, passcode, { checkIn: { roundId, available: nextAvailable } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("checkIn.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <section aria-labelledby="self-check-in-title" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="self-check-in-title" className="text-[15px] font-semibold text-fg">{t("checkIn.title", { round: roundName })}</h2>
          <p role="status" className="mt-1.5">
            {available ? (
              <StatusPill tone="success">{t("checkIn.available")}</StatusPill>
            ) : (
              <StatusPill tone="neutral" icon={<CircleSlash aria-hidden="true" />}>{t("checkIn.notAvailable")}</StatusPill>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => void submit(true)}
            disabled={saving || available}
            aria-busy={(saving && !available) || undefined}
          >
            {saving && !available ? t("checkIn.saving") : t("checkIn.markAvailable")}
          </Button>
          <Button
            onClick={() => void submit(false)}
            disabled={saving || !available}
            aria-busy={(saving && available) || undefined}
          >
            {saving && available ? t("checkIn.saving") : t("checkIn.markNotAvailable")}
          </Button>
        </div>
      </section>
      {error && <Alert tone="danger" role="alert" className="mx-4 mb-4">{error}</Alert>}
    </Card>
  );
}
