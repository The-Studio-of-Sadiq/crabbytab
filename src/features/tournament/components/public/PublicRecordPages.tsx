"use client";

import React from "react";
import Link from "next/link";

import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PublicShell } from "@/components/public/PublicShell";
import { Card, CardHeader } from "@/components/ui/Card";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { SCORE_DISPLAY_OPTIONS } from "@/lib/scoreDisplay";
import { getPublicSiteSettings } from "@/lib/publicFeatures";
import { adjudicatorRecord, publicRecordPath, teamRecord } from "@/lib/publicRecords";
import { PublicPersonName, PublicTeamName, publicRecordLinkClass } from "@/features/tournament/components/public/PublicSitePanels";

function RecordShell({ slug, title, children }: { slug: string; title: React.ReactNode; children: React.ReactNode }) {
  const { tournament, loading, cloudLoadError, publicRoundsLoading } = useTournament();
  const { t } = useI18n();
  return (
    <PublicShell
      width="narrow"
      title={tournament?.name || t("public.defaultTitle")}
      backHref={`/${encodeURIComponent(slug)}/public`}
      backLabel={t("public.record.back")}
    >
      {loading ? (
        <p role="status" className="text-xs text-fg-muted">{t("public.loading")}</p>
      ) : cloudLoadError ? (
        <Alert role="alert" tone="danger">{cloudLoadError}</Alert>
      ) : (
        <>
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          {publicRoundsLoading && <p role="status" className="text-xs text-fg-muted">{t("public.loadingRounds")}</p>}
          {children}
        </>
      )}
    </PublicShell>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <EmptyState title={children} />;
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
      <Card className="space-y-1 p-4 text-[13px] text-fg-muted">
        <p className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{t("public.record.teamTitle")}</p>
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
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title={t("public.record.debates")} />
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-fg-muted">{t("public.record.noDebates")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-start">
              <THead>
                <TR>
                  <TH scope="col">{t("public.col.round")}</TH>
                  <TH scope="col">{t("public.col.side")}</TH>
                  <TH scope="col">{t("public.col.debate")}</TH>
                  <TH scope="col">{t("public.col.result")}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.debateId}>
                    <TD className="text-xs font-semibold">{row.roundName}</TD>
                    <TD className="text-xs">{t(`side.${row.side}`)}</TD>
                    <TD className="text-xs">
                      {t("public.record.opponents", { teams: formatList(row.opponents.map((opponent) => opponent.name || t("public.noPublicName"))) })}
                      {row.venueName && <span className="block text-[11px] text-fg-muted">{row.venueName}</span>}
                    </TD>
                    <TD className="text-xs font-mono">
                      {row.result
                        ? row.result.rank !== undefined && tournament?.format === "bp"
                          ? t("public.rank", { rank: row.result.rank })
                          : row.result.win ? t("public.win") : t("public.loss")
                        : "—"}
                      {row.speakerScoreTotal !== undefined && (
                        <span className="ms-2 text-fg-muted">{t("public.speaks", { speaks: formatNumber(row.speakerScoreTotal, SCORE_DISPLAY_OPTIONS) })}</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
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
      <Card className="space-y-1 p-4 text-[13px] text-fg-muted">
        <p className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{t("public.record.adjudicatorTitle")}</p>
        {adjudicator.institutionName && <p>{t("public.record.institution", { institution: adjudicator.institutionName })}</p>}
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title={t("public.record.debates")} />
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-fg-muted">{t("public.record.noDebates")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-start">
              <THead>
                <TR>
                  <TH scope="col">{t("public.col.round")}</TH>
                  <TH scope="col">{t("public.col.role")}</TH>
                  <TH scope="col">{t("public.col.debate")}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.debateId}>
                    <TD className="text-xs font-semibold">{row.roundName}</TD>
                    <TD className="text-xs">{t(`public.role.${row.role}`)}</TD>
                    <TD className="text-xs">
                      {row.teams.map((team, index) => (
                        <React.Fragment key={team.side}>
                          {index > 0 && " · "}
                          <Link href={publicRecordPath(slug, "team", team.teamId)} className={publicRecordLinkClass}>
                            {team.name || t("public.noPublicName")}
                          </Link>
                        </React.Fragment>
                      ))}
                      {row.venueName && <span className="block text-[11px] text-fg-muted">{row.venueName}</span>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </RecordShell>
  );
}
