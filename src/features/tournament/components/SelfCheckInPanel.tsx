"use client";

import React, { useState } from "react";
import { CheckCircle2, CircleSlash } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";

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
    <section aria-labelledby="self-check-in-title" className="rounded-lg border border-[#d0d7de] bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="self-check-in-title" className="text-sm font-bold text-gray-900">{t("checkIn.title", { round: roundName })}</h2>
          <p role="status" className="mt-1 flex items-center gap-1.5 text-xs text-gray-700">
            {available ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            ) : (
              <CircleSlash className="h-4 w-4 text-gray-500" aria-hidden="true" />
            )}
            {available ? t("checkIn.available") : t("checkIn.notAvailable")}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void submit(true)}
            disabled={saving || available}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving && !available ? t("checkIn.saving") : t("checkIn.markAvailable")}
          </button>
          <button
            type="button"
            onClick={() => void submit(false)}
            disabled={saving || !available}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {saving && available ? t("checkIn.saving") : t("checkIn.markNotAvailable")}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </section>
  );
}
