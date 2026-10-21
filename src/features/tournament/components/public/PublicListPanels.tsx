"use client";

import React from "react";
import Link from "next/link";

import { useI18n } from "@/components/i18n/I18nProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { publicRecordLinkClass } from "@/features/tournament/components/public/PublicSitePanels";
import { SideBadge } from "@/components/ui/SideBadge";
import type { PublicAdjudicatorLists, PublicInstitutionRow, PublicParticipants } from "@/lib/publicLists";
import type { MotionStatistic } from "@/lib/motionStatistics";

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} description={description} />
      {children}
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-[13px] text-fg-muted">{children}</p>;
}

export function ParticipantsPanel({
  participants,
  showBreakCategories = false,
  showUnaccredited = false,
  teamHref,
  adjudicatorHref,
}: {
  participants: PublicParticipants;
  showBreakCategories?: boolean;
  /** Tabbycat `show_unaccredited`: an "Always trainee" column. */
  showUnaccredited?: boolean;
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
            <Table className="text-start">
              <THead>
                <TR>
                  <TH scope="col">{t("lists.col.team")}</TH>
                  <TH scope="col">{t("lists.col.institution")}</TH>
                  <TH scope="col">{t("lists.col.speakers")}</TH>
                  {showBreakCategories && <TH scope="col">{t("lists.col.breakCategories")}</TH>}
                </TR>
              </THead>
              <TBody>
                {participants.teams.map((team) => (
                  <TR key={team.id}>
                    <TD className="text-xs font-semibold text-fg">
                      {teamHref?.(team.id) ? (
                        <Link href={teamHref(team.id)!} className={publicRecordLinkClass}>{nameOrPlaceholder(team.name)}</Link>
                      ) : (
                        nameOrPlaceholder(team.name)
                      )}
                    </TD>
                    <TD className="text-xs text-fg-muted">{team.institutionName || "—"}</TD>
                    <TD className="text-xs text-fg-muted">
                      {formatList([
                        ...team.speakers,
                        ...Array.from({ length: team.anonymousSpeakers ?? 0 }, () => t("public.redacted")),
                      ]) || "—"}
                    </TD>
                    {showBreakCategories && <TD className="text-xs text-fg-muted">{formatList(team.breakCategories ?? []) || "—"}</TD>}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Panel>
      <Panel title={t("lists.adjudicators", { count: participants.adjudicators.length })}>
        {participants.adjudicators.length === 0 ? (
          <Empty>{t("lists.noAdjudicators")}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-start">
              <THead>
                <TR>
                  <TH scope="col">{t("lists.col.adjudicator")}</TH>
                  <TH scope="col">{t("lists.col.institution")}</TH>
                  {showUnaccredited && <TH scope="col">{t("lists.col.alwaysTrainee")}</TH>}
                </TR>
              </THead>
              <TBody>
                {participants.adjudicators.map((adjudicator) => (
                  <TR key={adjudicator.id}>
                    <TD className="text-xs font-semibold text-fg">
                      {adjudicator.anonymous ? (
                        <span className="italic text-fg-muted">{t("public.redacted")}</span>
                      ) : adjudicatorHref?.(adjudicator.id) ? (
                        <Link href={adjudicatorHref(adjudicator.id)!} className={publicRecordLinkClass}>{nameOrPlaceholder(adjudicator.name)}</Link>
                      ) : (
                        nameOrPlaceholder(adjudicator.name)
                      )}
                    </TD>
                    <TD className="text-xs text-fg-muted">{adjudicator.institutionName || t("common.independent")}</TD>
                    {showUnaccredited && <TD className="text-xs text-fg-muted">{adjudicator.trainee ? t("lists.alwaysTraineeYes") : "—"}</TD>}
                  </TR>
                ))}
              </TBody>
            </Table>
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
          <Table className="text-start">
            <THead>
              <TR>
                <TH scope="col">{t("lists.col.institution")}</TH>
                <TH scope="col">{t("lists.col.code")}</TH>
                {showRegions && <TH scope="col">{t("lists.col.region")}</TH>}
                {showCounts && <TH scope="col" className="text-end">{t("lists.col.teams")}</TH>}
                {showCounts && <TH scope="col" className="text-end">{t("lists.col.adjudicators")}</TH>}
              </TR>
            </THead>
            <TBody>
              {institutions.map((row) => (
                <TR key={row.id}>
                  <TD className="text-xs font-semibold text-fg">{row.name}</TD>
                  <TD className="text-xs font-mono text-fg-muted">{row.code}</TD>
                  {showRegions && <TD className="text-xs text-fg-muted">{row.region || "—"}</TD>}
                  {showCounts && <TD className="text-end text-xs font-mono">{row.teams}</TD>}
                  {showCounts && <TD className="text-end text-xs font-mono">{row.adjudicators}</TD>}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

function AdjudicatorList({ title, rows, empty, showUnaccredited }: { title: string; rows: PublicAdjudicatorLists["core"]; empty: string; showUnaccredited: boolean }) {
  const { t } = useI18n();
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
              <span className="font-semibold text-fg">
                {row.anonymous ? <span className="italic text-fg-muted">{t("public.redacted")}</span> : row.name || t("public.noPublicName")}
              </span>
              <span className="text-fg-muted">
                {row.institutionName || t("common.independent")}
                {showUnaccredited && row.trainee ? ` · ${t("lists.col.alwaysTrainee")}` : ""}
              </span>
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
  showUnaccredited = false,
}: {
  lists: PublicAdjudicatorLists;
  showCore: boolean;
  showBreaking: boolean;
  showUnaccredited?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {showCore && (
        <AdjudicatorList title={t("lists.core")} rows={lists.core} empty={t("lists.coreEmpty")} showUnaccredited={showUnaccredited} />
      )}
      {showBreaking && (
        <AdjudicatorList
          title={t("lists.breaking")}
          rows={lists.breaking}
          empty={t("lists.breakingEmpty")}
          showUnaccredited={showUnaccredited}
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
  const number = { n: (text: string) => <span className="font-mono font-semibold">{text}</span> };
  const formatAverage = (value: number | null) => (value === null ? "—" : formatDecimal(value, 2));
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-[11px] font-semibold uppercase text-fg-muted">
        {plural("motionStats.resultsFrom", statistic.debatesCounted)}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {statistic.positions.map((position) => (
          <div key={position.side} className="rounded border border-border bg-muted p-2">
            <dt>
              <SideBadge side={position.side} />
            </dt>
            <dd className="mt-1 text-xs text-fg">
              {richPlural(isBP ? "motionStats.firsts" : "motionStats.wins", position.wins, number)}
              {isBP && (
                <span className="block text-[11px] text-fg-muted">
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
        <p className="mt-2 text-[11px] text-fg-muted">
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
