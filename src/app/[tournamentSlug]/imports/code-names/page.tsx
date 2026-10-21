"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { codeNameRows } from "@/lib/participants/reports";

/**
 * Code-name decoder (Tabbycat participants-code-names-list): each team's code name next to its
 * real name, institution and speakers, for the tab room when code names are shown publicly.
 */
export default function CodeNamesPage() {
  const { tournament, teams, isOwnerOrAdmin } = useTournament();
  const { t, plural, formatList } = useI18n();
  const [query, setQuery] = useState("");
  const rows = useMemo(() => codeNameRows(teams), [teams]);
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(
    (row) =>
      !needle ||
      [row.codeName, row.teamName, row.institutionName, ...row.speakers].some((value) => value?.toLowerCase().includes(needle))
  );
  const missing = rows.filter((row) => row.codeName === undefined).length;

  return (
    <div className="space-y-6">
      <PageHeader title={t("setup.importsExtra.codeNames.title")} description={t("setup.importsExtra.codeNames.description")} />
      {!isOwnerOrAdmin && <Alert tone="info">{t("setup.importsExtra.codeNames.readOnly")}</Alert>}
      {missing > 0 && (
        <Alert tone="warning" role="status">
          {plural("setup.importsExtra.codeNames.missing", missing)}{" "}
          <Link
            href={`/${tournament?.slug}/config/visibility`}
            className={cn("rounded-sm font-medium text-accent-text underline underline-offset-2", focusRing)}
          >
            {t("setup.importsExtra.codeNames.generateLink")}
          </Link>
        </Alert>
      )}
      <div className="w-full sm:w-72">
        <Input
          type="search"
          leadingIcon={<Search />}
          aria-label={t("setup.importsExtra.codeNames.search")}
          placeholder={t("setup.importsExtra.codeNames.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <TableContainer>
        <Table>
          <caption className="sr-only">{t("setup.importsExtra.codeNames.title")}</caption>
          <THead>
            <TR>
              <TH>{t("setup.importsExtra.codeNames.colCodeName")}</TH>
              <TH>{t("setup.importsExtra.codeNames.colTeam")}</TH>
              <TH>{t("setup.importsExtra.codeNames.colInstitution")}</TH>
              <TH>{t("setup.importsExtra.codeNames.colSpeakers")}</TH>
            </TR>
          </THead>
          <TBody>
            {shown.map((row) => (
              <TR key={row.teamId}>
                <TD className="font-medium">
                  {row.emoji && <span className="me-1" aria-hidden="true">{row.emoji}</span>}
                  {row.codeName ?? <span className="italic text-fg-muted">{t("setup.importsExtra.codeNames.none")}</span>}
                </TD>
                <TD>
                  <Link
                    href={`/${tournament?.slug}/team/${row.teamId}`}
                    className={cn("rounded-sm text-accent-text hover:underline", focusRing)}
                  >
                    {row.teamName}
                  </Link>
                </TD>
                <TD className="text-xs text-fg-muted">{row.institutionName ?? "—"}</TD>
                <TD className="text-xs text-fg-muted">{row.speakers.length > 0 ? formatList(row.speakers) : "—"}</TD>
              </TR>
            ))}
            {shown.length === 0 && <TableEmpty colSpan={4}>{t("setup.importsExtra.codeNames.empty")}</TableEmpty>}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  );
}
