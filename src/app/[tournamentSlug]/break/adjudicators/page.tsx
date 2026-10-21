"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { AdjudicatorFlagToggle } from "@/features/tournament/components/AdjudicatorFlagToggle";
import { mayEditAdjudicatorScores } from "@/lib/staffPermissions";

type Filter = "all" | "breaking";

/**
 * Breaking adjudicators (Tabbycat breakqual-adjudicators and the breaking check cells): every
 * adjudicator with an inline toggle, breaking ones first. The public list is released separately.
 */
export default function BreakingAdjudicatorsPage() {
  const { tournament, adjudicators, isOwnerOrAdmin, isDataEntryAssistant, staffPermissions } = useTournament();
  const canEditScores = mayEditAdjudicatorScores({ isOwnerOrAdmin, isDataEntryAssistant, permissions: staffPermissions });
  const { t, plural, formatDecimal } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const breakingCount = adjudicators.filter((adjudicator) => adjudicator.breaking === true).length;
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      adjudicators
        .filter((adjudicator) => filter === "all" || adjudicator.breaking === true)
        .filter(
          (adjudicator) =>
            !needle ||
            adjudicator.name.toLowerCase().includes(needle) ||
            (adjudicator.institutionName ?? "").toLowerCase().includes(needle)
        )
        .sort(
          (a, b) =>
            Number(b.breaking === true) - Number(a.breaking === true) ||
            (b.baseScore ?? 0) - (a.baseScore ?? 0) ||
            a.name.localeCompare(b.name)
        ),
    [adjudicators, filter, needle]
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/${tournament?.slug}/break`}
          className={buttonClasses({ variant: "ghost", size: "sm", className: "-ms-2.5" })}
        >
          <ArrowLeft className="rtl:-scale-x-100" aria-hidden="true" />
          {t("results.break.eligibilityGrid.back")}
        </Link>
        <PageHeader
          title={t("results.break.breakingAdjudicators.title")}
          description={plural("results.break.breakingAdjudicators.description", breakingCount)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-72">
          <Input
            type="search"
            leadingIcon={<Search />}
            aria-label={t("results.break.breakingAdjudicators.search")}
            placeholder={t("results.break.breakingAdjudicators.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SegmentedControl<Filter>
          label={t("results.break.breakingAdjudicators.filter")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("results.break.breakingAdjudicators.filterAll") },
            { value: "breaking", label: t("results.break.breakingAdjudicators.filterBreaking") },
          ]}
        />
      </div>

      <TableContainer>
        <Table>
          <caption className="sr-only">{t("results.break.breakingAdjudicators.title")}</caption>
          <THead>
            <TR>
              <TH>{t("results.break.breakingAdjudicators.colName")}</TH>
              <TH>{t("results.break.breakingAdjudicators.colInstitution")}</TH>
              <TH align="right">{t("results.break.breakingAdjudicators.colBaseScore")}</TH>
              <TH align="center">{t("results.break.breakingAdjudicators.colBreaking")}</TH>
            </TR>
          </THead>
          <TBody>
            {shown.map((adjudicator) => (
              <TR key={adjudicator.id}>
                <TD className="font-medium">{adjudicator.name}</TD>
                <TD className="text-fg-muted">{adjudicator.institutionName || "—"}</TD>
                <TD numeric>{formatDecimal(adjudicator.baseScore ?? 0, 1)}</TD>
                <TD align="center">
                  {canEditScores ? (
                    <AdjudicatorFlagToggle
                      adjudicator={adjudicator}
                      flag="breaking"
                      label={t("results.feedback.tester.breakingLabel", { name: adjudicator.name })}
                    />
                  ) : adjudicator.breaking ? (
                    <StatusPill tone="success">{t("results.break.breakingAdjudicators.breaking")}</StatusPill>
                  ) : (
                    "—"
                  )}
                </TD>
              </TR>
            ))}
            {shown.length === 0 && <TableEmpty colSpan={4}>{t("results.break.breakingAdjudicators.empty")}</TableEmpty>}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  );
}
