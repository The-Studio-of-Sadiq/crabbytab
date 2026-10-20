"use client";

import React from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { CrossTournamentMotionStatistic } from "@/lib/motions/crossTournament";

/** Pooled motion statistics (admin cross-tournament page and its public counterpart). */
export function CrossTournamentMotionTable({ statistics }: { statistics: CrossTournamentMotionStatistic[] }) {
  const { t, formatDecimal, formatList, formatNumber } = useI18n();
  return (
    <TableContainer>
      <Table>
        <caption className="sr-only">{t("setup.entry.motions.tableCaption")}</caption>
        <THead>
          <TR>
            <TH>{t("setup.entry.motions.colMotion")}</TH>
            <TH>{t("setup.entry.motions.colTournaments")}</TH>
            <TH align="right">{t("setup.entry.motions.colDebates")}</TH>
            <TH>{t("setup.entry.motions.colWins")}</TH>
            <TH align="right">{t("setup.entry.motions.colVetoes")}</TH>
            <TH align="right">{t("setup.entry.motions.colBalance")}</TH>
          </TR>
        </THead>
        <TBody>
          {statistics.map((statistic) => (
            <TR key={statistic.key}>
              <TH
                scope="row"
                className="max-w-md whitespace-normal bg-transparent text-[13px] font-medium normal-case tracking-normal text-fg"
              >
                {statistic.text}
              </TH>
              <TD className="text-fg-muted">
                {formatList(statistic.tournaments.map((item) =>
                  t("setup.entry.motions.tournamentDebates", { name: item.name, count: item.debates })
                ))}
              </TD>
              <TD numeric>{formatNumber(statistic.debatesCounted)}</TD>
              <TD className="whitespace-nowrap font-mono text-xs text-fg-muted">
                {/* Side codes (OG, OO, AFF…) stay as they are in every language. */}
                {statistic.positionWins.map((item) => `${item.side} ${formatNumber(item.wins)}`).join(" · ")}
              </TD>
              <TD numeric>{formatNumber(statistic.vetoes)}</TD>
              <TD numeric>
                {statistic.balance.pValue === null ? "—" : formatDecimal(statistic.balance.pValue, 3)}
                {statistic.balance.lowExpectedCount && statistic.balance.pValue !== null && (
                  <span className="sr-only"> {t("setup.entry.motions.fewDebates")}</span>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableContainer>
  );
}
