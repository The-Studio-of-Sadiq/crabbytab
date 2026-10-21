"use client";

import React, { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { institutionAdjudicatorRequirements, requirementRounds, type InstitutionRequirementCell } from "@/lib/participants/reports";

/**
 * Adjudicator requirement by institution (Tabbycat participants-adj-rule): teams / adjudicators
 * registered and, for each preliminary round with a draw, debating / allocated. Cells where an
 * institution provides fewer than N-1 adjudicators for N teams are flagged with an icon and text,
 * not colour alone.
 */
export default function AdjudicatorRequirementsPage() {
  const { institutions, teams, adjudicators, rounds, debates } = useTournament();
  const { t, formatNumber } = useI18n();
  const shownRounds = useMemo(() => requirementRounds(rounds), [rounds]);
  const rows = useMemo(
    () => institutionAdjudicatorRequirements({ institutions, teams, adjudicators, rounds, debates }),
    [institutions, teams, adjudicators, rounds, debates]
  );

  const renderCell = (cell: InstitutionRequirementCell) => {
    const text = t("setup.importsExtra.adjRule.cell", { teams: formatNumber(cell.teams), adjudicators: formatNumber(cell.adjudicators) });
    return cell.short ? (
      <span className="inline-flex items-center gap-1 font-semibold text-danger">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        {text}
        <span className="sr-only"> {t("setup.importsExtra.adjRule.short")}</span>
      </span>
    ) : (
      text
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("setup.importsExtra.adjRule.title")} description={t("setup.importsExtra.adjRule.description")} />
      <TableContainer>
        <Table>
          <caption className="sr-only">{t("setup.importsExtra.adjRule.title")}</caption>
          <THead>
            <TR>
              <TH>{t("setup.importsExtra.adjRule.colInstitution")}</TH>
              <TH align="right">{t("setup.importsExtra.adjRule.colRegistered")}</TH>
              {shownRounds.map((round) => (
                <TH key={round.id} align="right" title={round.name}>
                  {round.abbreviation || round.name}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.institutionId}>
                <TD className="font-medium" title={row.name}>
                  {row.code || row.name}
                </TD>
                <TD numeric>{renderCell(row.registered)}</TD>
                {shownRounds.map((round) => (
                  <TD key={round.id} numeric>
                    {renderCell(row.byRound[round.id])}
                  </TD>
                ))}
              </TR>
            ))}
            {rows.length === 0 && (
              <TableEmpty colSpan={shownRounds.length + 2}>{t("setup.importsExtra.adjRule.empty")}</TableEmpty>
            )}
          </TBody>
        </Table>
      </TableContainer>
      <p className="text-xs text-fg-muted">{t("setup.importsExtra.adjRule.footnote")}</p>
    </div>
  );
}
