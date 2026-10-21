"use client";

import React, { useMemo, useState } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { StatusPill, type Tone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Field";
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import {
  buildPositionBalanceReport,
  positionBalanceUnavailable,
  type PositionBalanceStatus,
} from "@/lib/draw/positionBalance";
import { BP_SIDES } from "@/lib/draw/sideAllocator";
import type { MessageKey } from "@/lib/i18n";
import type { Round } from "@/types";

const STATUS: Record<PositionBalanceStatus, { key: MessageKey; tone: Tone }> = {
  regression: { key: "tabroom.draw.positionBalance.status.regression", tone: "danger" },
  still_bad: { key: "tabroom.draw.positionBalance.status.stillBad", tone: "danger" },
  improving: { key: "tabroom.draw.positionBalance.status.improving", tone: "warning" },
  resolved: { key: "tabroom.draw.positionBalance.status.resolved", tone: "success" },
};

const COST_FUNCTIONS: Record<string, MessageKey> = {
  simple: "tabroom.draw.positionBalance.cost.simple",
  sum_squared_deviations: "tabroom.draw.positionBalance.cost.variance",
  std_dev: "tabroom.draw.positionBalance.cost.variance",
};

/**
 * Tabbycat's position balance report for a BP round: every team's position history before and
 * after the round, the cost of its position under the configured cost function, and whether its
 * balance got worse, better or stayed imbalanced. Built by lib/draw/positionBalance.ts.
 */
export function PositionBalancePanel({ round }: { round: Round }) {
  const { tournament, rounds, debates, ballots, teams } = useTournament();
  const { t, formatNumber } = useI18n();
  const [onlyImbalanced, setOnlyImbalanced] = useState(true);
  const unavailable = tournament ? positionBalanceUnavailable(tournament.format, round, rounds) : "not_bp";
  const report = useMemo(() => {
    if (!tournament || unavailable) return null;
    const names = new Map(teams.map((team) => [team.id, team.name]));
    return buildPositionBalanceReport({
      round,
      rounds,
      debates,
      ballots,
      teamName: (teamId) => names.get(teamId) ?? teamId,
      preferences: tournament.preferences,
    });
  }, [tournament, unavailable, round, rounds, debates, ballots, teams]);

  if (unavailable === "not_bp") return null;
  const preferences = tournament?.preferences;
  const costFunction = preferences?.bpPositionCost ?? "renyi_entropy";
  const costLabel = COST_FUNCTIONS[costFunction]
    ? t(COST_FUNCTIONS[costFunction])
    : t("tabroom.draw.positionBalance.cost.renyi", { order: formatNumber(preferences?.renyiOrder ?? 1) });
  const rows = report ? (onlyImbalanced ? report.imbalanced : report.rows) : [];
  const counts = (values: number[]) => values.join(" / ");

  return (
    <Card role="region" aria-labelledby="position-balance-heading">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="position-balance-heading" className="text-sm font-semibold text-fg">
            {t("tabroom.draw.positionBalance.title")}
          </h2>
          <p className="text-xs text-fg-muted">
            {t("tabroom.draw.positionBalance.costFunction", {
              cost: costLabel,
              exponent: formatNumber(preferences?.bpPositionCostExponent ?? 4),
            })}
          </p>
        </div>
        {report && (
          <Checkbox
            label={t("tabroom.draw.positionBalance.onlyImbalanced")}
            checked={onlyImbalanced}
            onChange={(event) => setOnlyImbalanced(event.target.checked)}
          />
        )}
      </div>
      {unavailable ? (
        <p className="px-4 py-3 text-xs text-fg-muted">
          {t(unavailable === "first_round"
            ? "tabroom.draw.positionBalance.firstRound"
            : "tabroom.draw.positionBalance.elimination")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          {report && report.sidesPendingDebates > 0 && (
            <p className="px-4 pt-3 text-xs text-fg-muted">
              {t("tabroom.draw.positionBalance.sidesPending", { count: report.sidesPendingDebates })}
            </p>
          )}
          <Table className="text-xs">
            <caption className="sr-only">{t("tabroom.draw.positionBalance.caption", { sides: BP_SIDES.join(" / ") })}</caption>
            <THead>
              <TR>
                <TH>{t("tabroom.draw.positionBalance.team")}</TH>
                <TH>{t("tabroom.draw.positionBalance.position")}</TH>
                <TH title={BP_SIDES.join(" / ")}>{t("tabroom.draw.positionBalance.before")}</TH>
                <TH title={BP_SIDES.join(" / ")}>{t("tabroom.draw.positionBalance.after")}</TH>
                <TH align="right">{t("tabroom.draw.positionBalance.cost")}</TH>
                <TH>{t("tabroom.draw.positionBalance.statusHeader")}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.length === 0 && (
                <TableEmpty colSpan={6}>
                  {t(onlyImbalanced ? "tabroom.draw.positionBalance.noImbalances" : "tabroom.draw.positionBalance.noTeams")}
                </TableEmpty>
              )}
              {rows.map((row) => (
                <TR key={`${row.debateId}-${row.teamId}`}>
                  <TH scope="row" className="bg-transparent text-xs font-semibold normal-case tracking-normal text-fg">
                    {row.teamName}
                  </TH>
                  <TD>{row.side}</TD>
                  <TD>{counts(row.before)}</TD>
                  <TD>{counts(row.after)}</TD>
                  <TD numeric>{formatNumber(row.cost, { maximumFractionDigits: 2 })}</TD>
                  <TD>
                    {row.status
                      ? <StatusPill tone={STATUS[row.status].tone}>{t(STATUS[row.status].key)}</StatusPill>
                      : <span className="text-fg-muted">{t("tabroom.draw.positionBalance.status.balanced")}</span>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
