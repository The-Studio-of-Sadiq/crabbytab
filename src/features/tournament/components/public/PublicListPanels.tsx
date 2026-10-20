"use client";

import React from "react";
import Link from "next/link";

import { useI18n } from "@/components/i18n/I18nProvider";
import { SideBadge } from "@/components/ui/SideBadge";
import type { PublicAdjudicatorLists, PublicInstitutionRow, PublicParticipants } from "@/lib/publicLists";
import type { MotionStatistic } from "@/lib/motionStatistics";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
      <h2 className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] font-bold text-xs text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-center text-xs text-gray-500">{children}</p>;
}

export function ParticipantsPanel({
  participants,
  showBreakCategories = false,
  teamHref,
  adjudicatorHref,
}: {
  participants: PublicParticipants;
  showBreakCategories?: boolean;
  teamHref?: (teamId: string) => string | undefined;
  adjudicatorHref?: (adjudicatorId: string) => string | undefined;
}) {
  const { t, formatList } = useI18n();
  const nameOrPlaceholder = (name: string) => name || t("public.noPublicName");
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title={t("lists.teams", { count: participants.teams.length })}>
        {participants.teams.length === 0 ? (
          <Empty>{t("lists.noTeams")}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start tabby-table">
              <thead>
                <tr>
                  <th scope="col">{t("lists.col.team")}</th>
                  <th scope="col">{t("lists.col.institution")}</th>
                  <th scope="col">{t("lists.col.speakers")}</th>
                  {showBreakCategories && <th scope="col">{t("lists.col.breakCategories")}</th>}
                </tr>
              </thead>
              <tbody>
                {participants.teams.map((team) => (
                  <tr key={team.id}>
                    <td className="text-xs font-bold text-gray-900">
                      {teamHref?.(team.id) ? (
                        <Link href={teamHref(team.id)!} className="hover:underline">{nameOrPlaceholder(team.name)}</Link>
                      ) : (
                        nameOrPlaceholder(team.name)
                      )}
                    </td>
                    <td className="text-xs text-gray-600">{team.institutionName || "—"}</td>
                    <td className="text-xs text-gray-700">
                      {formatList([
                        ...team.speakers,
                        ...Array.from({ length: team.anonymousSpeakers ?? 0 }, () => t("public.redacted")),
                      ]) || "—"}
                    </td>
                    {showBreakCategories && <td className="text-xs text-gray-600">{formatList(team.breakCategories ?? []) || "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title={t("lists.adjudicators", { count: participants.adjudicators.length })}>
        {participants.adjudicators.length === 0 ? (
          <Empty>{t("lists.noAdjudicators")}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start tabby-table">
              <thead>
                <tr>
                  <th scope="col">{t("lists.col.adjudicator")}</th>
                  <th scope="col">{t("lists.col.institution")}</th>
                </tr>
              </thead>
              <tbody>
                {participants.adjudicators.map((adjudicator) => (
                  <tr key={adjudicator.id}>
                    <td className="text-xs font-bold text-gray-900">
                      {adjudicator.anonymous ? (
                        <span className="italic text-gray-500">{t("public.redacted")}</span>
                      ) : adjudicatorHref?.(adjudicator.id) ? (
                        <Link href={adjudicatorHref(adjudicator.id)!} className="hover:underline">{nameOrPlaceholder(adjudicator.name)}</Link>
                      ) : (
                        nameOrPlaceholder(adjudicator.name)
                      )}
                    </td>
                    <td className="text-xs text-gray-600">{adjudicator.institutionName || t("common.independent")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

export function InstitutionsPanel({ institutions }: { institutions: PublicInstitutionRow[] }) {
  const showCounts = institutions.some((row) => row.teams !== undefined);
  const showRegions = institutions.some((row) => row.region);
  const { t } = useI18n();
  return (
    <Panel title={t("lists.institutions", { count: institutions.length })}>
      {institutions.length === 0 ? (
        <Empty>{t("lists.noInstitutions")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start tabby-table">
            <thead>
              <tr>
                <th scope="col">{t("lists.col.institution")}</th>
                <th scope="col">{t("lists.col.code")}</th>
                {showRegions && <th scope="col">{t("lists.col.region")}</th>}
                {showCounts && <th scope="col" className="text-end">{t("lists.col.teams")}</th>}
                {showCounts && <th scope="col" className="text-end">{t("lists.col.adjudicators")}</th>}
              </tr>
            </thead>
            <tbody>
              {institutions.map((row) => (
                <tr key={row.id}>
                  <td className="text-xs font-bold text-gray-900">{row.name}</td>
                  <td className="text-xs font-mono text-gray-600">{row.code}</td>
                  {showRegions && <td className="text-xs text-gray-600">{row.region || "—"}</td>}
                  {showCounts && <td className="text-end text-xs font-mono">{row.teams}</td>}
                  {showCounts && <td className="text-end text-xs font-mono">{row.adjudicators}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AdjudicatorList({ title, rows, empty }: { title: string; rows: PublicAdjudicatorLists["core"]; empty: string }) {
  const { t } = useI18n();
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
              <span className="font-bold text-gray-900">
                {row.anonymous ? <span className="italic text-gray-500">{t("public.redacted")}</span> : row.name || t("public.noPublicName")}
              </span>
              <span className="text-gray-600">{row.institutionName || t("common.independent")}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function AdjudicatorListsPanel({
  lists,
  showCore,
  showBreaking,
}: {
  lists: PublicAdjudicatorLists;
  showCore: boolean;
  showBreaking: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {showCore && (
        <AdjudicatorList title={t("lists.core")} rows={lists.core} empty={t("lists.coreEmpty")} />
      )}
      {showBreaking && (
        <AdjudicatorList
          title={t("lists.breaking")}
          rows={lists.breaking}
          empty={t("lists.breakingEmpty")}
        />
      )}
    </div>
  );
}

/** Side results for one motion; only rendered from released (public) ballots. */
export function MotionStatisticsSummary({ statistic, isBP }: { statistic: MotionStatistic; isBP: boolean }) {
  const { plural, richPlural, rich, t, formatDecimal } = useI18n();
  if (statistic.debatesCounted === 0) return null;
  const { balance } = statistic;
  const number = { n: (text: string) => <span className="font-mono font-bold">{text}</span> };
  const formatAverage = (value: number | null) => (value === null ? "—" : formatDecimal(value, 2));
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-[11px] font-bold uppercase text-gray-500">
        {plural("motionStats.resultsFrom", statistic.debatesCounted)}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {statistic.positions.map((position) => (
          <div key={position.side} className="rounded border border-gray-200 bg-gray-50 p-2">
            <dt>
              <SideBadge side={position.side} />
            </dt>
            <dd className="mt-1 text-xs text-gray-800">
              {richPlural(isBP ? "motionStats.firsts" : "motionStats.wins", position.wins, number)}
              {isBP && (
                <span className="block text-[11px] text-gray-500">
                  {rich(
                    "motionStats.averagePoints",
                    { n: (text) => <span className="font-mono">{text}</span> },
                    { value: formatAverage(position.averagePoints) }
                  )}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {balance.pValue !== null && (
        <p className="mt-2 text-[11px] text-gray-500">
          {t("motionStats.sideBalance", {
            chiSquared: balance.chiSquared === null || balance.chiSquared === undefined ? "—" : formatDecimal(balance.chiSquared, 2),
            pValue: formatDecimal(balance.pValue, 3),
          })}
          {balance.lowExpectedCount ? ` ${t("motionStats.lowCount")}` : ""}
        </p>
      )}
    </div>
  );
}
