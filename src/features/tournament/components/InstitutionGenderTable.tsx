"use client";

import React, { useMemo } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { institutionGenderTable } from "@/lib/participants/reports";
import type { Adjudicator, Institution, Team } from "@/types";

/**
 * Speakers and adjudicators by gender for each institution (Tabbycat
 * participants-institution-gender-diversity). Independent adjudicators are not counted.
 */
export function InstitutionGenderTable({
  institutions,
  teams,
  adjudicators,
}: {
  institutions: Institution[];
  teams: Team[];
  adjudicators: Adjudicator[];
}) {
  const { t, formatNumber } = useI18n();
  const table = useMemo(
    () => institutionGenderTable({ institutions, teams, adjudicators }),
    [institutions, teams, adjudicators]
  );
  const genderLabel = (gender: string) => gender || t("setup.importsExtra.genderByInstitution.notGiven");
  const columnCount = 1 + table.genders.length * 2;

  return (
    <TableContainer>
      <Table>
        <caption className="sr-only">{t("setup.importsExtra.genderByInstitution.title")}</caption>
        <THead>
          <TR>
            <TH rowSpan={2}>{t("setup.importsExtra.genderByInstitution.colInstitution")}</TH>
            {table.genders.length > 0 && (
              <>
                <TH colSpan={table.genders.length} align="center">{t("setup.importsExtra.genderByInstitution.speakers")}</TH>
                <TH colSpan={table.genders.length} align="center">{t("setup.importsExtra.genderByInstitution.adjudicators")}</TH>
              </>
            )}
          </TR>
          <TR>
            {table.genders.map((gender) => (
              <TH key={`s-${gender}`} align="right" scope="col">{genderLabel(gender)}</TH>
            ))}
            {table.genders.map((gender) => (
              <TH key={`a-${gender}`} align="right" scope="col">{genderLabel(gender)}</TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {table.rows.map((row) => (
            <TR key={row.institutionId}>
              <TD className="font-medium">{row.name}</TD>
              {table.genders.map((gender) => (
                <TD key={`s-${gender}`} numeric>{formatNumber(row.speakers[gender] ?? 0)}</TD>
              ))}
              {table.genders.map((gender) => (
                <TD key={`a-${gender}`} numeric>{formatNumber(row.adjudicators[gender] ?? 0)}</TD>
              ))}
            </TR>
          ))}
          {table.rows.length === 0 && (
            <TableEmpty colSpan={columnCount}>{t("setup.importsExtra.genderByInstitution.empty")}</TableEmpty>
          )}
        </TBody>
      </Table>
    </TableContainer>
  );
}
