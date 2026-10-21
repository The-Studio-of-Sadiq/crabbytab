"use client";

import { sideLabel } from "@/lib/sideNames";
import React, { useMemo } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { SideBadge } from "@/components/ui/SideBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ProgressBar } from "@/components/ui/Feedback";
import { StatusPill } from "@/components/ui/Badge";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { BarChart3, TrendingUp, PieChart, Lightbulb } from "lucide-react";
import { DebateSide } from "@/types";
import { computeMotionRoundStatistics, countMotionVetoes } from "@/lib/motionStatistics";
import { isPolyFormat, tournamentSides } from "@/lib/debateSides";

export default function AnalyticsPage() {
  const {
    tournament,
    rounds,
    debates,
    ballots,
    motions,
  } = useTournament();
  const { t, plural, formatNumber, formatDecimal } = useI18n();

  const isBP = tournament?.format === "bp";
  const confirmedBallots = ballots.filter((b) => b.confirmed && !b.discarded);
  const formatPercent = (percent: number) => formatNumber(percent / 100, { style: "percent" });

  // 1. Speaker Score Distribution (Bins from 65 to 85)
  const scoreBins = useMemo(() => {
    const bins: Record<number, number> = {};
    for (let s = 68; s <= 84; s++) bins[s] = 0;

    confirmedBallots.forEach((b) => {
      Object.values(b.speakerScores || {}).forEach((scoreList) => {
        scoreList.forEach((spk) => {
          const rounded = Math.round(spk.score);
          if (bins[rounded] !== undefined) {
            bins[rounded]++;
          }
        });
      });
    });

    const maxCount = Math.max(1, ...Object.values(bins));
    return { bins, maxCount };
  }, [confirmedBallots]);

  // 2. Side Win / Points Balance Analysis
  const sideStats = useMemo(() => {
    const sides: DebateSide[] = tournament ? tournamentSides(tournament) : isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];
    const stats: Record<string, { totalPoints: number; totalWins: number; count: number }> = {};

    sides.forEach((s) => {
      stats[s] = { totalPoints: 0, totalWins: 0, count: 0 };
    });

    confirmedBallots.forEach((b) => {
      sides.forEach((s) => {
        const teamScore = b.teamScores?.[s];
        if (teamScore) {
          stats[s].totalPoints += teamScore.points || 0;
          if (teamScore.win || (isBP && teamScore.points === 3)) {
            stats[s].totalWins++;
          }
          stats[s].count++;
        }
      });
    });

    return stats;
  }, [confirmedBallots, isBP, tournament]);

  // 3. Motion statistics, one row per round a motion was used in (Tabbycat motions-statistics);
  // the counting rules live in lib/motionStatistics.ts, shared with the public page.
  const roundOrder = useMemo(
    () => [...rounds].sort((left, right) => left.seq - right.seq).map((round) => round.id),
    [rounds]
  );
  const roundNames = useMemo(() => new Map(rounds.map((round) => [round.id, round.name])), [rounds]);
  const motionStats = useMemo(
    () =>
      // Tabbycat has no motion statistics for more or fewer than two teams (other than BP).
      (isPolyFormat(tournament?.format) ? [] : computeMotionRoundStatistics(motions, debates, ballots, isBP, roundOrder)).map((stat) => ({
        ...stat,
        vetoes: countMotionVetoes(ballots, stat.motion.id, stat.roundId),
      })),
    [motions, debates, ballots, isBP, roundOrder, tournament?.format]
  );
  const showVetoes =
    Boolean(tournament?.preferences?.enableMotionVetoes) || motionStats.some((stat) => stat.vetoes > 0);
  const motionColumns = 4 + (isBP ? 4 : 2) + (showVetoes ? 1 : 0);
  const sampleSize = confirmedBallots.length * (isBP ? 8 : 6);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader title={t("results.analytics.title")} description={t("results.analytics.description")} />

      {/* 1. Round-by-Round Progression Tracker */}
      <Card>
        <CardHeader icon={<TrendingUp aria-hidden="true" />} title={t("results.analytics.progressionTitle")} />
        <CardBody>
          {rounds.length === 0 ? (
            <p className="text-[13px] text-fg-muted">{t("results.analytics.noRounds")}</p>
          ) : (
            <ul className="space-y-4">
              {rounds.map((round) => {
                const rDebates = debates.filter((d) => d.roundId === round.id);
                const rConfirmed = rDebates.filter((d) =>
                  d.byeTeamId || confirmedBallots.some((b) => b.debateId === d.id)
                ).length;
                const pct = rDebates.length > 0 ? Math.round((rConfirmed / rDebates.length) * 100) : 0;

                return (
                  <li key={round.id} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-fg">{round.name}</span>
                        <span className="font-mono text-fg-muted">
                          {t("results.analytics.roundProgress", { confirmed: rConfirmed, total: rDebates.length })}
                        </span>
                      </div>
                      <span className="font-mono font-semibold text-fg">{formatPercent(pct)}</span>
                    </div>
                    <ProgressBar
                      value={rConfirmed}
                      max={rDebates.length}
                      label={t("results.analytics.roundProgressLabel", { round: round.name })}
                      className="h-2"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* 2. Speaker Score Distribution Histogram */}
      <Card>
        <CardHeader
          icon={<BarChart3 aria-hidden="true" />}
          title={t("results.analytics.distributionTitle")}
          description={t("results.analytics.distributionDescription")}
          actions={
            <span className="text-xs text-fg-muted">{plural("results.analytics.sampleSize", sampleSize)}</span>
          }
        />
        <CardBody>
          <ul
            aria-label={t("results.analytics.distributionTitle")}
            className="flex h-48 items-stretch justify-between gap-1 border-b border-border px-2 sm:gap-2"
          >
            {Object.entries(scoreBins.bins).map(([scoreStr, count]) => {
              const heightPct = Math.round((count / scoreBins.maxCount) * 100);
              return (
                <li key={scoreStr} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span className="sr-only">
                    {plural("results.analytics.distributionBar", count, { score: Number(scoreStr) })}
                  </span>
                  <span aria-hidden="true" className="font-mono text-[10px] text-fg-muted">
                    {formatNumber(count)}
                  </span>
                  <div
                    aria-hidden="true"
                    className="w-full rounded-t-sm bg-accent"
                    style={{ height: `${Math.max(2, heightPct * 0.85)}%` }}
                  />
                </li>
              );
            })}
          </ul>
          <div aria-hidden="true" className="flex justify-between gap-1 px-2 pt-1.5 sm:gap-2">
            {Object.keys(scoreBins.bins).map((scoreStr) => (
              <span key={scoreStr} className="min-w-0 flex-1 text-center font-mono text-[10px] text-fg-muted">
                {formatNumber(Number(scoreStr))}
              </span>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* 3. Side Balance & Win Rates */}
      <Card>
        <CardHeader icon={<PieChart aria-hidden="true" />} title={t("results.analytics.sideBalanceTitle")} />
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(sideStats).map(([sideKey, data]) => {
              const avgPts = data.count > 0 ? data.totalPoints / data.count : 0;
              const winPct = data.count > 0 ? Math.round((data.totalWins / data.count) * 100) : 0;

              return (
                <div key={sideKey} className="flex flex-col justify-between rounded-lg border border-border bg-muted/40 p-4">
                  <div>
                    <SideBadge side={sideKey as DebateSide} preferences={tournament?.preferences} />
                    <div className="mt-3">
                      <div className="font-mono text-2xl font-semibold text-fg">{formatDecimal(avgPts, 2)}</div>
                      <span className="text-xs text-fg-muted">{t("results.analytics.averagePoints")}</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs">
                    <span className="text-fg-muted">{t("results.analytics.firstsOrWins")}</span>
                    <span className="font-mono font-semibold text-fg">
                      {t("results.analytics.winsValue", { wins: data.totalWins, percent: formatPercent(winPct) })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* 4. Motion Statistics Table */}
      <Card className="overflow-hidden">
        <CardHeader
          icon={<Lightbulb aria-hidden="true" />}
          title={t("results.analytics.motionTitle")}
          description={t("results.analytics.motionDescription")}
        />
        {motions.length === 0 ? (
          <div className="p-4">
            <EmptyState title={t("results.analytics.noMotions")} />
          </div>
        ) : (
          <TableContainer className="max-h-[calc(100vh-16rem)] rounded-none border-0">
            <Table>
              <THead>
                <TR>
                  <TH>{t("results.analytics.colMotion")}</TH>
                  <TH className="w-28">{t("results.analytics.colRound")}</TH>
                  <TH align="right" className="w-24">{t("results.analytics.colDebates")}</TH>
                  {isBP ? (
                    (["OG", "OO", "CG", "CO"] as const).map((side) => (
                      <TH key={side} align="right" className="w-20">{t("results.analytics.colSideWins", { side })}</TH>
                    ))
                  ) : (
                    <>
                      <TH align="right" className="w-24">
                        {t("results.analytics.colSideWins", { side: sideLabel("AFF", tournament?.preferences) })}
                      </TH>
                      <TH align="right" className="w-24">
                        {t("results.analytics.colSideWins", { side: sideLabel("NEG", tournament?.preferences) })}
                      </TH>
                    </>
                  )}
                  {showVetoes && <TH align="right" className="w-20">{t("results.analytics.colVetoes")}</TH>}
                  <TH align="right" className="w-36">{t("results.analytics.colChiSquared")}</TH>
                </TR>
              </THead>
              <TBody>
                {motionStats.length === 0 && <TableEmpty colSpan={motionColumns}>{t("results.analytics.noMotions")}</TableEmpty>}
                {motionStats.map((ms) => (
                  <TR key={`${ms.motion.id}|${ms.roundId ?? ""}`}>
                    <TD className="min-w-64">
                      <span className="mb-0.5 block text-[11px] font-medium text-fg-muted">{ms.motion.reference}</span>
                      <span className="font-medium">&ldquo;{ms.motion.text}&rdquo;</span>
                    </TD>
                    <TD className="text-fg-muted">{(ms.roundId && roundNames.get(ms.roundId)) || "—"}</TD>
                    <TD numeric>{formatNumber(ms.debatesCounted)}</TD>
                    {ms.positions.map((position) => (
                      <TD key={position.side} numeric className="font-semibold">{formatNumber(position.wins)}</TD>
                    ))}
                    {showVetoes && <TD numeric>{formatNumber(ms.vetoes)}</TD>}
                    <TD align="right" className="text-xs">
                      {ms.balance.chiSquared === null || ms.balance.pValue === null ? (
                        <span className="text-fg-muted">{t("results.analytics.insufficientData")}</span>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="font-mono font-semibold text-fg">
                            {t("results.analytics.chiValue", {
                              chi: formatDecimal(ms.balance.chiSquared, 2),
                              p: formatDecimal(ms.balance.pValue, 3),
                            })}
                          </span>
                          <span className="text-[11px] text-fg-muted">
                            {t("results.analytics.chiMeta", {
                              n: ms.balance.observations,
                              df: ms.balance.degreesOfFreedom,
                            })}
                          </span>
                          {ms.balance.lowExpectedCount && (
                            <StatusPill tone="warning">{t("results.analytics.lowExpectedCount")}</StatusPill>
                          )}
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </div>
  );
}
