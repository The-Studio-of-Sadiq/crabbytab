"use client";

import React from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonClasses } from "@/components/ui/Button";
import { Badge, StatusPill, type Tone } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ProgressBar } from "@/components/ui/Feedback";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { describeRoundStatus } from "@/components/layout/roundStatus";
import type { Debate, DebateSide, Round } from "@/types";
import { sideLabel, translatedSideName } from "@/lib/sideNames";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey, MessageValues } from "@/lib/i18n";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarPlus,
  FileCheck2,
  MapPin,
  Shuffle,
  Trophy,
  Users,
  Users2,
} from "lucide-react";

type Translate = (key: MessageKey, values?: MessageValues) => string;

function debateStatus(debate: Debate, t: Translate): { tone: Tone; label: string } {
  if (debate.byeTeamId) {
    return { tone: "info", label: t(debate.byeResult === "win" ? "results.home.status.byeWin" : "results.home.status.byeAbsent") };
  }
  if (debate.resultStatus === "confirmed") return { tone: "success", label: t("results.home.status.confirmed") };
  if (debate.resultStatus === "draft") return { tone: "warning", label: t("results.home.status.draft") };
  return { tone: "neutral", label: t("results.home.status.noResult") };
}

const DRAW_STATUS_KEYS: Partial<Record<string, MessageKey>> = {
  released: "results.home.drawStatus.released",
  confirmed: "results.home.drawStatus.confirmed",
  draft: "results.home.drawStatus.draft",
};

/** describeRoundStatus's label in the viewer's language (the tone still comes from it). */
function roundStatusLabel(round: Pick<Round, "drawStatus" | "resultsReleased" | "completed">, t: Translate): string {
  const draw = t((round.drawStatus && DRAW_STATUS_KEYS[round.drawStatus]) || "results.home.drawStatus.none");
  if (round.completed) return t("results.home.drawStatus.completed", { status: draw });
  if (round.resultsReleased) return t("results.home.drawStatus.resultsPublished", { status: draw });
  return draw;
}

function StatTile({
  href,
  label,
  value,
  detail,
  icon,
}: {
  href: string;
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong",
        focusRing
      )}
    >
      <div className="flex items-center justify-between text-xs font-medium text-fg-muted">
        <span>{label}</span>
        <span className="text-fg-subtle [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-fg">{value}</div>
      <p className="mt-0.5 text-xs text-fg-muted">{detail}</p>
    </Link>
  );
}

export default function TournamentDashboardPage() {
  const {
    tournament,
    activeRound,
    rounds,
    teams,
    adjudicators,
    venues,
    debates,
    ballots,
    motions,
    isOwnerOrAdmin,
  } = useTournament();
  const { t, plural, formatNumber } = useI18n();

  const roundDebates = activeRound ? debates.filter((d) => d.roundId === activeRound.id) : [];
  const confirmedBallots = activeRound
    ? ballots.filter((b) => b.roundId === activeRound.id && b.confirmed)
    : [];
  const completedRoundDebates = roundDebates.filter(
    (debate) => debate.byeTeamId || confirmedBallots.some((ballot) => ballot.debateId === debate.id)
  ).length;
  const roundMotion = activeRound
    ? motions.find((m) => m.rounds && m.rounds.includes(activeRound.id))
    : null;

  const isBP = tournament?.format === "bp";
  const base = `/${tournament?.slug}`;
  const roundStatus = activeRound ? describeRoundStatus(activeRound) : null;
  const sides = ((isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"]) as DebateSide[])
    .map((side) => [side, translatedSideName(t, side, tournament?.preferences)] as const);

  const workflow: { label: MessageKey; href: string }[] = [
    { label: "results.home.workflow.availability", href: `${base}/checkins` },
    { label: "results.home.workflow.draw", href: `${base}/draw` },
    { label: "results.home.workflow.allocate", href: `${base}/allocation` },
    { label: "results.home.workflow.display", href: `${base}/display` },
    { label: "results.home.workflow.motions", href: `${base}/imports/motions` },
    { label: "results.home.workflow.results", href: `${base}/results` },
    { label: "results.home.workflow.standings", href: `${base}/standings` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={tournament?.name || t("results.home.fallbackTitle")}
        description={isBP ? t("results.home.formatBp") : t("results.home.formatTwoTeam")}
        actions={
          <Link href={`${base}/public`} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "secondary" })}>
            {t("results.home.publicIndex")}
            <ArrowUpRight aria-hidden="true" />
          </Link>
        }
      />

      <nav aria-label={t("results.home.workflowLabel")}>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {workflow.map((step, index) => (
            <li key={step.label}>
              <Link
                href={step.href}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[13px] font-medium text-fg transition-colors hover:border-border-strong hover:bg-muted/60",
                  focusRing
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-fg-muted">
                  {formatNumber(index + 1)}
                </span>
                <span className="truncate">{t(step.label)}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      {activeRound ? (
        <Card>
          <CardHeader
            title={activeRound.name}
            description={t("results.home.currentRound")}
            actions={
              roundDebates.length === 0 ? (
                // Drawing happens on the draw page, which runs the venue and rule checks first.
                isOwnerOrAdmin ? (
                  <Link href={`${base}/draw`} className={buttonClasses({ variant: "primary" })}>
                    <Shuffle aria-hidden="true" />
                    {t("results.home.generateDraw")}
                  </Link>
                ) : null
              ) : (
                <>
                  <Link href={`${base}/draw`} className={buttonClasses({ variant: "secondary" })}>
                    <Shuffle aria-hidden="true" />
                    {plural("results.home.viewDraw", roundDebates.length)}
                  </Link>
                  <Link href={`${base}/allocation`} className={buttonClasses({ variant: "secondary" })}>
                    <Users2 aria-hidden="true" />
                    {t("results.home.allocation")}
                  </Link>
                  <Link href={`${base}/results`} className={buttonClasses({ variant: "primary" })}>
                    <FileCheck2 aria-hidden="true" />
                    {t("results.home.enterBallots", { done: completedRoundDebates, total: roundDebates.length })}
                  </Link>
                </>
              )
            }
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {roundStatus && <StatusPill tone={roundStatus.tone}>{roundStatusLabel(activeRound, t)}</StatusPill>}
              <Badge>{activeRound.stage === "elimination" ? t("results.home.stage.elimination") : t("results.home.stage.preliminary")}</Badge>
            </div>
            {roundMotion ? (
              <blockquote className="max-w-3xl border-s-2 border-border-strong ps-3 text-[13px] text-fg">
                <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-fg-muted">{t("results.home.motion")}</span>
                &ldquo;{roundMotion.text}&rdquo;
              </blockquote>
            ) : (
              <p className="text-[13px] text-fg-muted">{t("results.home.noMotion")}</p>
            )}
            {roundDebates.length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-fg-muted">{t("results.home.completion")}</span>
                  <span className="font-medium tabular-nums text-fg">
                    {t("results.home.completionDetail", {
                      done: completedRoundDebates,
                      total: roundDebates.length,
                      percent: formatNumber(completedRoundDebates / Math.max(1, roundDebates.length), {
                        style: "percent",
                        maximumFractionDigits: 0,
                      }),
                    })}
                  </span>
                </div>
                <ProgressBar value={completedRoundDebates} max={roundDebates.length} label={t("results.home.completion")} />
              </div>
            )}
          </CardBody>
        </Card>
      ) : (
        <EmptyState
          icon={<CalendarPlus />}
          title={t("results.home.noRoundsTitle")}
          description={t("results.home.noRoundsBody")}
        />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          href={`${base}/imports/teams`}
          label={t("results.home.stat.teams")}
          value={formatNumber(teams.length)}
          detail={plural("results.home.stat.speakers", teams.reduce((sum, team) => sum + (team.speakers?.length || 0), 0))}
          icon={<Users />}
        />
        <StatTile
          href={`${base}/imports/adjudicators`}
          label={t("results.home.stat.adjudicators")}
          value={formatNumber(adjudicators.length)}
          detail={plural("results.home.stat.chairs", adjudicators.filter((a) => !a.trainee).length)}
          icon={<Users2 />}
        />
        <StatTile
          href={`${base}/imports/venues`}
          label={t("results.home.stat.venues")}
          value={formatNumber(venues.length)}
          detail={plural("results.home.stat.activeRooms", venues.filter((v) => v.available !== false).length)}
          icon={<MapPin />}
        />
        <StatTile
          href={`${base}/standings`}
          label={t("results.home.stat.rounds")}
          value={formatNumber(rounds.length)}
          detail={plural("results.home.stat.roundsCompleted", rounds.filter((r) => r.completed).length)}
          icon={<Trophy />}
        />
      </div>

      {roundDebates.length > 0 && (
        <section aria-labelledby="overview-matchups" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="overview-matchups" className="text-[15px] font-semibold text-fg">
              {t("results.home.matchupsTitle", { round: activeRound?.name ?? "" })}
            </h2>
            <Link
              href={`${base}/draw`}
              className={cn("inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-accent-text hover:underline", focusRing)}
            >
              {t("results.home.fullDraw")}
              <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
            </Link>
          </div>
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH className="w-28">{t("results.home.column.venue")}</TH>
                  {sides.map(([side, label]) => (
                    <TH key={side}>
                      {label} <span className="text-fg-subtle">({sideLabel(side, tournament?.preferences)})</span>
                    </TH>
                  ))}
                  <TH>{t("results.home.column.chair")}</TH>
                  <TH className="w-32">{t("results.home.column.status")}</TH>
                </TR>
              </THead>
              <TBody>
                {roundDebates.map((debate) => {
                  const status = debateStatus(debate, t);
                  return (
                    <TR key={debate.id}>
                      <TD className="font-medium">{debate.venueName || t("results.home.unassigned")}</TD>
                      {sides.map(([side]) => (
                        <TD key={side}>{debate.teams?.[side]?.teamName || "—"}</TD>
                      ))}
                      <TD>
                        {debate.byeTeamId ? (
                          <span className="text-fg-muted">{t("results.home.chairNotRequired")}</span>
                        ) : debate.adjudicators?.chairName ? (
                          debate.adjudicators.chairName
                        ) : (
                          <StatusPill tone="danger">{t("results.home.unassigned")}</StatusPill>
                        )}
                      </TD>
                      <TD>
                        <StatusPill tone={status.tone}>{status.label}</StatusPill>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableContainer>
        </section>
      )}
    </div>
  );
}
