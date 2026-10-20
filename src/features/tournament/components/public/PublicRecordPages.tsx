"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { SCORE_DISPLAY_OPTIONS } from "@/lib/scoreDisplay";
import { getPublicSiteSettings } from "@/lib/publicFeatures";
import { adjudicatorRecord, publicRecordPath, teamRecord } from "@/lib/publicRecords";
import { PublicPersonName, PublicTeamName } from "@/features/tournament/components/public/PublicSitePanels";

function RecordShell({ slug, title, children }: { slug: string; title: React.ReactNode; children: React.ReactNode }) {
  const { tournament, loading, cloudLoadError, publicRoundsLoading } = useTournament();
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-[#f6f8fa] flex flex-col">
      <header className="bg-[#24292e] text-white py-4 px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/${encodeURIComponent(slug)}/public`} className="inline-flex items-center gap-1 text-[11px] text-gray-300 hover:text-white">
              <ArrowLeft className="w-3 h-3 rtl:-scale-x-100" aria-hidden="true" />
              {t("public.record.back")}
            </Link>
            <p className="text-sm font-bold truncate">{tournament?.name || t("public.defaultTitle")}</p>
          </div>
          <LanguageSwitcher triggerClassName="shrink-0 text-gray-100 hover:bg-white/10 hover:text-white" />
        </div>
      </header>
      <main className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-6 space-y-4 flex-1">
        {loading ? (
          <p role="status" className="text-xs text-gray-500">{t("public.loading")}</p>
        ) : cloudLoadError ? (
          <p role="alert" className="text-xs text-red-700">{cloudLoadError}</p>
        ) : (
          <>
            <h1 className="text-lg font-bold text-gray-900">{title}</h1>
            {publicRoundsLoading && <p role="status" className="text-xs text-gray-500">{t("public.loadingRounds")}</p>}
            {children}
          </>
        )}
      </main>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="bg-white border border-[#d0d7de] rounded-lg p-8 text-center text-xs text-gray-600">{children}</div>;
}

export function TeamRecordPage({ slug, teamId }: { slug: string; teamId: string }) {
  const { tournament, teams, rounds, debates, ballots, breakCategories } = useTournament();
  const { t, formatList, formatNumber } = useI18n();
  const settings = getPublicSiteSettings(tournament?.preferences);
  const team = teams.find((item) => item.id === teamId);
  if (!settings.recordPages) {
    return <RecordShell slug={slug} title={t("public.record.teamTitle")}><Notice>{t("public.record.disabled")}</Notice></RecordShell>;
  }
  if (!team) {
    return <RecordShell slug={slug} title={t("public.record.teamTitle")}><Notice>{t("public.record.notFound")}</Notice></RecordShell>;
  }
  const rows = teamRecord(team.id, rounds, debates, ballots);
  const categoryNames = (team.breakCategories ?? [])
    .map((id) => breakCategories.find((category) => category.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  return (
    <RecordShell slug={slug} title={<PublicTeamName team={team} />}>
      <div className="bg-white border border-[#d0d7de] rounded-lg p-4 space-y-1 text-xs text-gray-700">
        <p className="font-semibold text-gray-500 uppercase text-[10px]">{t("public.record.teamTitle")}</p>
        {team.institutionName && <p>{t("public.record.institution", { institution: team.institutionName })}</p>}
        {categoryNames.length > 0 && <p>{t("public.record.breakCategories", { categories: formatList(categoryNames) })}</p>}
        <p>
          {t("public.col.speakers")}:{" "}
          {team.speakers.length === 0
            ? "—"
            : team.speakers.map((speaker, index) => (
                <React.Fragment key={speaker.id}>
                  {index > 0 && ", "}
                  <PublicPersonName name={speaker.name} anonymous={speaker.anonymous} />
                </React.Fragment>
              ))}
        </p>
      </div>
      <section className="bg-white border border-[#d0d7de] rounded-lg overflow-hidden">
        <h2 className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] font-bold text-xs text-gray-900">{t("public.record.debates")}</h2>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-xs text-gray-500">{t("public.record.noDebates")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start tabby-table">
              <thead>
                <tr>
                  <th scope="col">{t("public.col.round")}</th>
                  <th scope="col">{t("public.col.side")}</th>
                  <th scope="col">{t("public.col.debate")}</th>
                  <th scope="col">{t("public.col.result")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.debateId}>
                    <td className="text-xs font-semibold">{row.roundName}</td>
                    <td className="text-xs">{t(`side.${row.side}`)}</td>
                    <td className="text-xs">
                      {t("public.record.opponents", { teams: formatList(row.opponents.map((opponent) => opponent.name || t("public.noPublicName"))) })}
                      {row.venueName && <span className="block text-[10px] text-gray-500">{row.venueName}</span>}
                    </td>
                    <td className="text-xs font-mono">
                      {row.result
                        ? row.result.rank !== undefined && tournament?.format === "bp"
                          ? t("public.rank", { rank: row.result.rank })
                          : row.result.win ? t("public.win") : t("public.loss")
                        : "—"}
                      {row.speakerScoreTotal !== undefined && (
                        <span className="ms-2 text-gray-500">{t("public.speaks", { speaks: formatNumber(row.speakerScoreTotal, SCORE_DISPLAY_OPTIONS) })}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </RecordShell>
  );
}

export function AdjudicatorRecordPage({ slug, adjudicatorId }: { slug: string; adjudicatorId: string }) {
  const { tournament, adjudicators, rounds, debates } = useTournament();
  const { t } = useI18n();
  const settings = getPublicSiteSettings(tournament?.preferences);
  const adjudicator = adjudicators.find((item) => item.id === adjudicatorId);
  if (!settings.recordPages) {
    return <RecordShell slug={slug} title={t("public.record.adjudicatorTitle")}><Notice>{t("public.record.disabled")}</Notice></RecordShell>;
  }
  // Anonymous adjudicators have no public record: it would tie their debates to one person.
  if (!adjudicator || adjudicator.anonymous) {
    return <RecordShell slug={slug} title={t("public.record.adjudicatorTitle")}><Notice>{t("public.record.notFound")}</Notice></RecordShell>;
  }
  const rows = adjudicatorRecord(adjudicator.id, rounds, debates);
  return (
    <RecordShell slug={slug} title={<PublicPersonName name={adjudicator.name} />}>
      <div className="bg-white border border-[#d0d7de] rounded-lg p-4 space-y-1 text-xs text-gray-700">
        <p className="font-semibold text-gray-500 uppercase text-[10px]">{t("public.record.adjudicatorTitle")}</p>
        {adjudicator.institutionName && <p>{t("public.record.institution", { institution: adjudicator.institutionName })}</p>}
      </div>
      <section className="bg-white border border-[#d0d7de] rounded-lg overflow-hidden">
        <h2 className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] font-bold text-xs text-gray-900">{t("public.record.debates")}</h2>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-xs text-gray-500">{t("public.record.noDebates")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start tabby-table">
              <thead>
                <tr>
                  <th scope="col">{t("public.col.round")}</th>
                  <th scope="col">{t("public.col.role")}</th>
                  <th scope="col">{t("public.col.debate")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.debateId}>
                    <td className="text-xs font-semibold">{row.roundName}</td>
                    <td className="text-xs">{t(`public.role.${row.role}`)}</td>
                    <td className="text-xs">
                      {row.teams.map((team, index) => (
                        <React.Fragment key={team.side}>
                          {index > 0 && " · "}
                          <Link href={publicRecordPath(slug, "team", team.teamId)} className="hover:underline">
                            {team.name || t("public.noPublicName")}
                          </Link>
                        </React.Fragment>
                      ))}
                      {row.venueName && <span className="block text-[10px] text-gray-500">{row.venueName}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </RecordShell>
  );
}
