"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Search } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { focusRing } from "@/components/ui/focus";
import { cn } from "@/components/ui/cn";
import {
  generalCategoryEligibilityChanges,
  teamEligibleCategoryIds,
  teamsWithEligibilityChanges,
} from "@/lib/participants/reports";

const checkboxClass = cn(
  "h-4 w-4 cursor-pointer rounded-sm accent-[rgb(var(--color-accent))]",
  focusRing,
  "disabled:cursor-not-allowed disabled:opacity-50"
);

/**
 * Team x break category eligibility grid (Tabbycat breakqual-edit-eligibility). Changes are kept
 * as a draft and saved together, so a half-edited grid never reaches the break. A general category
 * takes every team, so its column shows and sets the "Ineligible" override instead of the team's
 * own category list, exactly as the break, liveness and public pages read it.
 */
export default function BreakEligibilityPage() {
  const { tournament, teams, breakCategories, saveEntityBatch, saveBreakCategories, isOwnerOrAdmin } = useTournament();
  const { t, plural } = useI18n();
  const categories = useMemo(() => [...breakCategories].sort((a, b) => a.seq - b.seq), [breakCategories]);
  // Team id -> category ids, only for teams the organiser has touched.
  const [draft, setDraft] = useState<Map<string, Set<string>>>(new Map());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const storedEligibility = (teamId: string): Set<string> => {
    const team = teams.find((item) => item.id === teamId);
    return team ? teamEligibleCategoryIds(team, categories) : new Set();
  };
  const eligibleOf = (teamId: string): Set<string> => draft.get(teamId) ?? storedEligibility(teamId);
  const nonGeneral = useMemo(() => categories.filter((category) => !category.isGeneral), [categories]);
  const changedTeams = useMemo(() => teamsWithEligibilityChanges(teams, draft, nonGeneral), [teams, draft, nonGeneral]);
  const changedCategories = useMemo(() => generalCategoryEligibilityChanges(categories, draft), [categories, draft]);
  // Teams whose eligibility the draft changes in any category, for the save button's count.
  const changed = useMemo(
    () =>
      teams.filter((team) => {
        const wanted = draft.get(team.id);
        if (!wanted) return false;
        const stored = teamEligibleCategoryIds(team, categories);
        return wanted.size !== stored.size || [...wanted].some((id) => !stored.has(id));
      }),
    [teams, draft, categories]
  );
  const needle = query.trim().toLowerCase();
  const shownTeams = useMemo(
    () =>
      [...teams]
        .filter(
          (team) =>
            !needle || team.name.toLowerCase().includes(needle) || (team.institutionName ?? "").toLowerCase().includes(needle)
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [teams, needle]
  );

  const setEligible = (teamIds: string[], categoryId: string, eligible: boolean) => {
    setMessage(null);
    setDraft((current) => {
      const next = new Map(current);
      for (const teamId of teamIds) {
        const set = new Set(next.get(teamId) ?? storedEligibility(teamId));
        if (eligible) set.add(categoryId);
        else set.delete(categoryId);
        next.set(teamId, set);
      }
      return next;
    });
  };

  const save = async () => {
    if (saving || changed.length === 0) return;
    setSaving(true);
    setMessage(null);
    try {
      // General categories record "Ineligible" overrides (audited by the break category save);
      // other categories are the teams' own lists. The audit summary stays in English.
      if (changedCategories.length > 0) {
        const updated = new Map(changedCategories.map((category) => [category.id, category]));
        await saveBreakCategories(breakCategories.map((category) => updated.get(category.id) ?? category));
      }
      if (changedTeams.length > 0) await saveEntityBatch({ teamsUpdated: changedTeams }, "Break eligibility edited");
      setDraft(new Map());
      setMessage({ tone: "success", text: plural("results.break.eligibilityGrid.saved", changed.length) });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: error instanceof Error ? error.message : t("results.break.eligibilityGrid.saveFailed"),
      });
    } finally {
      setSaving(false);
    }
  };

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
          title={t("results.break.eligibilityGrid.title")}
          description={t("results.break.eligibilityGrid.description")}
          actions={
            isOwnerOrAdmin && (
              <>
                {changed.length > 0 && (
                  <Button variant="ghost" onClick={() => setDraft(new Map())} disabled={saving}>
                    {t("results.break.eligibilityGrid.discard")}
                  </Button>
                )}
                <Button variant="primary" onClick={() => void save()} loading={saving} disabled={changed.length === 0}>
                  <Save aria-hidden="true" />
                  {changed.length > 0
                    ? plural("results.break.eligibilityGrid.saveCount", changed.length)
                    : t("results.break.eligibilityGrid.noChanges")}
                </Button>
              </>
            )
          }
        />
      </div>

      {message && (
        <Alert tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>
          {message.text}
        </Alert>
      )}

      {categories.length === 0 ? (
        <EmptyState title={t("results.break.eligibilityGrid.noCategories")} />
      ) : (
        <>
          {categories.some((category) => category.isGeneral) && (
            <p className="text-sm text-fg-muted">{t("results.break.eligibilityGrid.generalHint")}</p>
          )}
          <div className="w-full sm:w-72">
            <Input
              type="search"
              leadingIcon={<Search />}
              aria-label={t("results.break.eligibilityGrid.search")}
              placeholder={t("results.break.eligibilityGrid.search")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <TableContainer className="max-h-[calc(100vh-14rem)]">
            <Table>
              <caption className="sr-only">{t("results.break.eligibilityGrid.caption")}</caption>
              <THead>
                <TR>
                  <TH>{t("results.break.eligibilityGrid.team")}</TH>
                  {categories.map((category) => {
                    const ids = shownTeams.map((team) => team.id);
                    const allChecked = ids.length > 0 && ids.every((id) => eligibleOf(id).has(category.id));
                    return (
                      <TH key={category.id} align="center">
                        <span className="flex flex-col items-center gap-1">
                          <span>{category.name}</span>
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={allChecked}
                            disabled={!isOwnerOrAdmin || ids.length === 0}
                            aria-label={t("results.break.eligibilityGrid.toggleAll", { category: category.name })}
                            onChange={(event) => setEligible(ids, category.id, event.target.checked)}
                          />
                        </span>
                      </TH>
                    );
                  })}
                </TR>
              </THead>
              <TBody>
                {shownTeams.map((team) => {
                  const eligible = eligibleOf(team.id);
                  return (
                    <TR key={team.id}>
                      <TD className="font-medium">
                        {team.name}
                        {team.institutionName && <span className="ms-2 text-xs text-fg-muted">{team.institutionName}</span>}
                      </TD>
                      {categories.map((category) => (
                        <TD key={category.id} align="center">
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={eligible.has(category.id)}
                            disabled={!isOwnerOrAdmin}
                            aria-label={t("results.break.eligibilityGrid.cellLabel", { team: team.name, category: category.name })}
                            onChange={(event) => setEligible([team.id], category.id, event.target.checked)}
                          />
                        </TD>
                      ))}
                    </TR>
                  );
                })}
                {shownTeams.length === 0 && (
                  <TableEmpty colSpan={categories.length + 1}>{t("results.break.eligibilityGrid.noTeams")}</TableEmpty>
                )}
              </TBody>
            </Table>
          </TableContainer>
        </>
      )}
    </div>
  );
}
