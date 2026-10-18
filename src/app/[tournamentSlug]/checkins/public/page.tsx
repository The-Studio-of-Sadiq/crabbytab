"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";

// Sentinel for "no server message": translated at render time so a language switch applies to it.
const LOAD_ERROR = "__load_error__";

interface PublicRoundStatus {
  id: string;
  name: string;
  teamsPresent: number;
  teamsTotal: number;
  adjudicatorsPresent: number;
  adjudicatorsTotal: number;
}

interface PublicCheckInStatus {
  tournamentName: string;
  updatedAt: string;
  rounds: PublicRoundStatus[];
}

export default function PublicCheckinsPage() {
  const params = useParams<{ tournamentSlug: string }>();
  const [status, setStatus] = useState<PublicCheckInStatus | null>(null);
  const [error, setError] = useState("");
  const { t, formatTime, formatNumber } = useI18n();

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/public/tournaments/${encodeURIComponent(params.tournamentSlug)}/checkins`,
          { cache: "no-store" }
        );
        const result = await response.json() as PublicCheckInStatus & { error?: string };
        if (!response.ok) throw new Error(result.error || LOAD_ERROR);
        if (active) {
          setStatus(result);
          setError("");
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : LOAD_ERROR);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [params.tournamentSlug]);

  const errorMessage = error === LOAD_ERROR ? t("publicCheckins.loadError") : error;

  if (error && !status) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold text-gray-900">{t("publicCheckins.title")}</h1>
          <LanguageSwitcher />
        </div>
        <p role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{errorMessage}</p>
        <Link href={`/${params.tournamentSlug}/public`} className="text-sm font-semibold text-blue-700 hover:underline">
          {t("publicCheckins.back")}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t("publicCheckins.heading", { tournament: status?.tournamentName || t("common.tournament") })}
          </h1>
          <p className="mt-1 text-sm text-gray-600">{t("publicCheckins.description")}</p>
        </div>
        <LanguageSwitcher />
      </header>
      {error && <p role="alert" className="text-sm text-amber-800">{errorMessage}</p>}
      {!status ? <p role="status" className="text-sm text-gray-600">{t("publicCheckins.loading")}</p> : (
        <>
          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table className="w-full text-start text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="px-4 py-3">{t("publicCheckins.col.round")}</th>
                  <th className="px-4 py-3">{t("publicCheckins.col.teams")}</th>
                  <th className="px-4 py-3">{t("publicCheckins.col.adjudicators")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {status.rounds.map((round) => (
                  <tr key={round.id}>
                    <th scope="row" className="px-4 py-3 font-semibold text-gray-900">{round.name}</th>
                    <td className="px-4 py-3">
                      {t("publicCheckins.ratio", { present: formatNumber(round.teamsPresent), total: formatNumber(round.teamsTotal) })}
                    </td>
                    <td className="px-4 py-3">
                      {t("publicCheckins.ratio", {
                        present: formatNumber(round.adjudicatorsPresent),
                        total: formatNumber(round.adjudicatorsTotal),
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">{t("publicCheckins.updated", { time: formatTime(status.updatedAt) })}</p>
        </>
      )}
    </main>
  );
}
