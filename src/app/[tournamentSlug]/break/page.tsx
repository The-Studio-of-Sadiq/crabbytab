"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import confetti from "canvas-confetti";
import { Award, Sparkles, Plus, ArrowRight, CheckCircle2, Pencil, Trash2, X } from "lucide-react";
import { BreakCategory, BreakQualificationRule, BreakTeamOverride } from "@/types";
import { isGeneratedBreakStale, type BreakCategoryResult, type BreakExclusionReason } from "@/lib/breakqual/calculator";
import {
  getBreakCategoryDeletionBlocker,
  upsertBreakCategory,
  validateBreakCategoryDraft,
  withTeamOverride,
  type BreakCategoryDraft,
} from "@/features/tournament/application/breaks";
import { eliminationByeCount } from "@/lib/draw/elimination";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/messages";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { Dialog } from "@/components/ui/Dialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, IconButton, buttonClasses } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Checkbox, Input, Select } from "@/components/ui/Field";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { StatusPill, type Tone } from "@/components/ui/Badge";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/Tabs";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { SpeakerCategoryEligibilityPanel } from "@/features/tournament/components/SpeakerCategoryEligibilityPanel";

const OVERRIDE_OPTIONS: BreakTeamOverride[] = [
  "include",
  "ineligible",
  "withdrawn",
  "different_break",
  "disqualified",
  "lost_coin_toss",
];

/** Labels for the fixed override and exclusion values (the calculator's English labels, translated). */
const OVERRIDE_KEYS: Record<BreakTeamOverride, MessageKey> = {
  include: "results.break.override.include",
  ineligible: "results.break.override.ineligible",
  withdrawn: "results.break.override.withdrawn",
  different_break: "results.break.override.differentBreak",
  disqualified: "results.break.override.disqualified",
  lost_coin_toss: "results.break.override.lostCoinToss",
};

const EXCLUSION_KEYS: Record<BreakExclusionReason, MessageKey> = {
  ineligible: OVERRIDE_KEYS.ineligible,
  withdrawn: OVERRIDE_KEYS.withdrawn,
  different_break: OVERRIDE_KEYS.different_break,
  disqualified: OVERRIDE_KEYS.disqualified,
  lost_coin_toss: OVERRIDE_KEYS.lost_coin_toss,
  capped: "results.break.exclusionCapped",
};

const QUALIFICATION_RULE_KEYS: Record<BreakQualificationRule, MessageKey> = {
  standard: "results.break.rule.standard",
  aida_1996: "results.break.rule.aida1996",
  aida_2016_australs: "results.break.rule.aida2016Australs",
  aida_2016_easters: "results.break.rule.aida2016Easters",
  aida_2019_australs_open: "results.break.rule.aida2019AustralsOpen",
};

const EDITOR_FORM_ID = "break-category-editor";
/** Sticky headers need the table to scroll inside its own frame. */
const TABLE_FRAME = "max-h-[calc(100vh-16rem)] rounded-none border-0";

const EMPTY_DRAFT: BreakCategoryDraft = {
  name: "",
  breakSize: 8,
  reserveSize: 2,
  priority: 5,
  isGeneral: false,
  maxPerInstitution: 0,
  qualificationRule: "standard",
  limit: 0,
};

function draftFromCategory(category: BreakCategory): BreakCategoryDraft {
  return {
    name: category.name,
    breakSize: category.breakSize,
    reserveSize: category.reserveSize,
    priority: category.priority,
    isGeneral: category.isGeneral,
    maxPerInstitution: category.maxPerInstitution ?? 0,
    qualificationRule: category.qualificationRule ?? "standard",
    limit: category.limit ?? 0,
  };
}

type BreakRowStatus =
  | { kind: "breaking"; seed: number; breakRank: number; tied: boolean; generated: boolean; manual: boolean }
  | { kind: "reserve"; index: number | undefined }
  | { kind: "tied"; cutoff: "break" | "reserve"; places: number; teams: number }
  | { kind: "excluded"; reason: BreakExclusionReason };

interface BreakRow {
  teamId: string;
  teamName: string;
  institutionName?: string;
  rank: number;
  points: number;
  totalSpeakerScore: number;
  status: BreakRowStatus;
}

function buildRows(result: BreakCategoryResult): BreakRow[] {
  const generatedIds = new Set(result.category.generatedBreak?.breakingTeamIds ?? []);
  const rows: BreakRow[] = [
    ...result.breakingTeams.map((entry) => ({
      teamId: entry.team.id,
      teamName: entry.team.name,
      institutionName: entry.team.institutionName,
      rank: entry.rank,
      points: entry.standing.points,
      totalSpeakerScore: entry.standing.totalSpeakerScore,
      status: {
        kind: "breaking" as const,
        seed: entry.seed,
        breakRank: entry.breakRank ?? entry.seed,
        tied: result.breakingTeams.some(
          (other) => other !== entry && (other.breakRank ?? other.seed) === (entry.breakRank ?? entry.seed)
        ),
        generated: generatedIds.has(entry.team.id),
        manual: Boolean(entry.manuallyIncluded),
      },
    })),
    ...result.reserveTeams.map((entry) => ({
      teamId: entry.team.id,
      teamName: entry.team.name,
      institutionName: entry.team.institutionName,
      rank: entry.rank,
      points: entry.standing.points,
      totalSpeakerScore: entry.standing.totalSpeakerScore,
      status: { kind: "reserve" as const, index: entry.reserveIndex },
    })),
    // Teams tied across a cutoff sit between the clear places and the rest until resolved.
    ...result.cutoffTies.flatMap((tie) =>
      tie.teams.map((entry) => ({
        teamId: entry.team.id,
        teamName: entry.team.name,
        institutionName: entry.team.institutionName,
        rank: entry.rank,
        points: entry.standing.points,
        totalSpeakerScore: entry.standing.totalSpeakerScore,
        status: { kind: "tied" as const, cutoff: tie.cutoff, places: tie.places, teams: tie.teams.length },
      }))
    ),
    ...result.excludedTeams.map((entry) => ({
      teamId: entry.team.id,
      teamName: entry.team.name,
      institutionName: entry.team.institutionName,
      rank: entry.rank,
      points: entry.standing.points,
      totalSpeakerScore: entry.standing.totalSpeakerScore,
      status: { kind: "excluded" as const, reason: entry.reason as BreakExclusionReason },
    })),
  ];
  return rows;
}

const STATUS_TONES: Record<BreakRowStatus["kind"], Tone> = {
  breaking: "success",
  reserve: "info",
  tied: "danger",
  excluded: "neutral",
};

export default function BreakPage() {
  const {
    tournament,
    teams,
    rounds,
    teamStandings,
    setActiveRound,
    breakCategories,
    breakResults,
    saveBreakCategories,
    generateBreak,
  } = useTournament();
  const { t, plural, formatNumber, formatDecimal, formatList } = useI18n();

  const teamsInDebate: 4 | 2 = tournament?.format === "bp" ? 4 : 2;
  const [activeCategorySlug, setActiveCategorySlug] = useState<string>("open");
  const [editor, setEditor] = useState<{ editingId?: string; draft: BreakCategoryDraft } | null>(null);
  const [editorError, setEditorError] = useState("");
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BreakCategory | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isGeneratingBreak, setIsGeneratingBreak] = useState(false);
  const [breakGenerationError, setBreakGenerationError] = useState("");
  const [overrideTeamId, setOverrideTeamId] = useState("");
  const [overrideValue, setOverrideValue] = useState<BreakTeamOverride>("include");
  const [overrideError, setOverrideError] = useState("");
  const [isSavingOverride, setIsSavingOverride] = useState(false);

  const selectedResult =
    breakResults.find((r) => r.category.slug === activeCategorySlug) ||
    breakResults[0];
  const selectedCategory = selectedResult?.category;
  const categoryHasBeenGenerated = Boolean(
    selectedCategory &&
      (selectedCategory.generatedBreak || teams.some((team) => team.breakCategoryIds?.includes(selectedCategory.id)))
  );
  const breakIsStale = selectedResult ? isGeneratedBreakStale(selectedResult) : false;
  const cutoffTies = selectedResult?.cutoffTies ?? [];
  const tooFewEligible = selectedResult?.tooFewEligible;
  const generationBlocked = cutoffTies.length > 0 || Boolean(tooFewEligible);
  const eliminatedTeamsCount = teams.filter((team) => team.breakStatus === "eliminated").length;
  const categoryFirstRound = selectedResult && rounds
    .filter((round) => round.stage === "elimination" && round.breakCategoryIds?.includes(selectedResult.category.id))
    .sort((a, b) => a.seq - b.seq)[0];
  const rows = selectedResult ? buildRows(selectedResult) : [];
  const overrides = selectedCategory?.teamOverrides ?? {};
  const byeCount = selectedResult
    ? eliminationByeCount(selectedResult.breakingTeams.length, tournament?.format ?? "bp")
    : 0;

  const triggerCelebration = () => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });
  };

  const openEditor = (category?: BreakCategory) => {
    setEditorError("");
    setEditor(category
      ? { editingId: category.id, draft: draftFromCategory(category) }
      : { draft: { ...EMPTY_DRAFT, breakSize: Math.max(EMPTY_DRAFT.breakSize, teamsInDebate) } });
  };

  const updateDraft = (changes: Partial<BreakCategoryDraft>) => {
    setEditor((current) => (current ? { ...current, draft: { ...current.draft, ...changes } } : current));
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editor || isSavingCategory) return;
    const error = validateBreakCategoryDraft(editor.draft, breakCategories, teamsInDebate, editor.editingId);
    if (error) {
      setEditorError(error);
      return;
    }
    setIsSavingCategory(true);
    try {
      const updated = upsertBreakCategory(breakCategories, editor.draft, tournament?.id || "", editor.editingId);
      await saveBreakCategories(updated);
      const saved = editor.editingId
        ? updated.find((category) => category.id === editor.editingId)
        : updated[updated.length - 1];
      if (saved) setActiveCategorySlug(saved.slug);
      setEditor(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : t("results.break.saveCategoryFailed"));
    } finally {
      setIsSavingCategory(false);
    }
  };

  const requestDelete = (category: BreakCategory) => {
    setDeleteError(getBreakCategoryDeletionBlocker(category, teams, rounds));
    setPendingDelete(category);
  };

  const handleDeleteCategory = async () => {
    if (!pendingDelete || isDeleting) return;
    const blocker = getBreakCategoryDeletionBlocker(pendingDelete, teams, rounds);
    if (blocker) {
      setDeleteError(blocker);
      return;
    }
    setIsDeleting(true);
    try {
      await saveBreakCategories(breakCategories.filter((category) => category.id !== pendingDelete.id));
      setPendingDelete(null);
      setDeleteError("");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t("results.break.deleteCategoryFailed"));
    } finally {
      setIsDeleting(false);
    }
  };

  const saveOverride = async (teamId: string, override: BreakTeamOverride | null) => {
    if (!selectedCategory || isSavingOverride) return;
    setIsSavingOverride(true);
    setOverrideError("");
    try {
      await saveBreakCategories(withTeamOverride(breakCategories, selectedCategory.id, teamId, override));
      setOverrideTeamId("");
    } catch (error) {
      setOverrideError(error instanceof Error ? error.message : t("results.break.overrideFailed"));
    } finally {
      setIsSavingOverride(false);
    }
  };

  const handleGenerateBreak = async () => {
    if (!selectedResult) return;
    setIsGeneratingBreak(true);
    setBreakGenerationError("");
    try {
      await generateBreak(selectedResult.category.id);
    } catch (error) {
      setBreakGenerationError(error instanceof Error ? error.message : t("results.break.generateFailed"));
    } finally {
      setIsGeneratingBreak(false);
    }
  };

  const teamNameById = new Map(teams.map((team) => [team.id, team.name]));
  const overrideEntries = Object.entries(overrides).sort(([left], [right]) =>
    (teamNameById.get(left) ?? left).localeCompare(teamNameById.get(right) ?? right)
  );
  const rankedTeams = teamStandings.length > 0
    ? teamStandings.map((standing) => ({
        id: standing.teamId,
        label: t("results.break.rankedTeamOption", { rank: standing.rank, name: standing.teamName }),
      }))
    : teams.map((team) => ({ id: team.id, label: team.name }));

  const seedLabel = (status: BreakRowStatus) =>
    status.kind === "breaking"
      ? // Tied teams share a break rank, shown "=2" as on a printed tab.
        `${status.tied ? "=" : ""}${formatNumber(status.breakRank)}`
      : status.kind === "reserve"
        ? t("results.break.reserveSeed", { index: status.index ?? "?" })
        : status.kind === "tied"
          ? "?"
          : "—";

  const statusLabel = (status: BreakRowStatus) => {
    switch (status.kind) {
      case "breaking":
        return status.generated
          ? t(status.manual ? "results.break.statusBreakingManual" : "results.break.statusBreaking")
          : t(status.manual ? "results.break.statusQualifiesManual" : "results.break.statusQualifies");
      case "reserve":
        return t("results.break.statusReserve", { index: status.index ?? "?" });
      case "tied":
        return plural(
          status.cutoff === "break" ? "results.break.statusTiedBreak" : "results.break.statusTiedReserve",
          status.places,
          { teams: status.teams }
        );
      case "excluded":
        return t(EXCLUSION_KEYS[status.reason]);
    }
  };

  const categoryMeta = selectedCategory
    ? [
        t(selectedCategory.isGeneral ? "results.break.metaGeneral" : "results.break.metaEligibleOnly"),
        t("results.break.metaPriority", { priority: selectedCategory.priority }),
        t("results.break.metaBreakSize", { size: selectedCategory.breakSize }),
        t("results.break.metaReserves", { count: selectedCategory.reserveSize }),
        ...(byeCount > 0 ? [plural("results.break.metaByes", byeCount)] : []),
      ].join(" · ")
    : "";

  const categoryTabs: TabItem<string>[] = breakResults.map((res) => ({
    value: res.category.slug,
    label: (
      <>
        {res.category.name}
        <span className="text-xs font-normal text-fg-muted">
          {t("results.break.topN", { count: res.category.breakSize })}
        </span>
      </>
    ),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("results.break.title")}
        description={t("results.break.description")}
        actions={
          <>
            <Link href={`/${tournament?.slug}/break/eligibility`} className={buttonClasses({ variant: "ghost" })}>
              {t("results.break.eligibilityGrid.link")}
            </Link>
            <Link href={`/${tournament?.slug}/break/adjudicators`} className={buttonClasses({ variant: "ghost" })}>
              {t("results.break.breakingAdjudicators.link")}
            </Link>
            <Button variant="ghost" onClick={triggerCelebration}>
              <Sparkles aria-hidden="true" />
              {t("results.break.celebrate")}
            </Button>
            <Button variant="secondary" onClick={() => openEditor()}>
              <Plus aria-hidden="true" />
              {t("results.break.addCategory")}
            </Button>
          </>
        }
      />

      {selectedResult && selectedCategory ? (
        <>
          <Tabs
            id="break-categories"
            items={categoryTabs}
            value={selectedCategory.slug}
            onValueChange={setActiveCategorySlug}
            ariaLabel={t("results.break.categoriesLabel")}
          />

          <TabPanel id="break-categories" value={selectedCategory.slug} className="space-y-6">
            <Card className="overflow-hidden">
              <CardHeader
                title={plural("results.break.breakingTeamsTitle", selectedResult.breakingTeams.length, {
                  name: selectedCategory.name,
                })}
                description={categoryMeta}
                actions={
                  <>
                    <Button size="sm" variant="ghost" onClick={() => openEditor(selectedCategory)}>
                      <Pencil aria-hidden="true" />
                      {t("results.break.edit")}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => requestDelete(selectedCategory)}>
                      <Trash2 aria-hidden="true" />
                      {t("results.break.delete")}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={handleGenerateBreak}
                      disabled={breakResults.length === 0 || generationBlocked}
                      loading={isGeneratingBreak}
                      loadingText={t("results.break.generating")}
                      title={
                        tooFewEligible
                          ? t("results.break.tooFewEligibleTitle")
                          : cutoffTies.length > 0
                            ? t("results.break.resolveTieFirst")
                            : undefined
                      }
                    >
                      <CheckCircle2 aria-hidden="true" />
                      {t(categoryHasBeenGenerated ? "results.break.regenerate" : "results.break.generate")}
                    </Button>
                    {categoryHasBeenGenerated && categoryFirstRound && (
                      <Link
                        href={`/${tournament?.slug}/draw`}
                        onClick={() => setActiveRound(categoryFirstRound)}
                        className={buttonClasses({ variant: "secondary", size: "sm" })}
                      >
                        <ArrowRight className="rtl:-scale-x-100" aria-hidden="true" />
                        {t("results.break.openRound", { round: categoryFirstRound.name })}
                      </Link>
                    )}
                  </>
                }
              />

              {(breakGenerationError || categoryHasBeenGenerated) && (
                <div className="space-y-1 border-b border-border px-4 py-2 text-xs text-fg-muted">
                  {breakGenerationError && <p role="alert" className="text-danger">{breakGenerationError}</p>}
                  {categoryHasBeenGenerated && (
                    <p>
                      {plural(
                        "results.break.generatedSummary",
                        selectedCategory.generatedBreak?.breakingTeamIds.length ?? selectedResult.breakingTeams.length
                      )}{" "}
                      {plural("results.break.eliminatedOverall", eliminatedTeamsCount)}
                    </p>
                  )}
                </div>
              )}

              <SpeakerCategoryEligibilityPanel category={selectedCategory} />

              {(generationBlocked || breakIsStale) && (
                <div className="space-y-2 border-b border-border p-4">
                  {tooFewEligible && (
                    <Alert role="alert" tone="danger" title={t("results.break.tooFewEligibleTitle")}>
                      {t("results.break.tooFewEligibleBody", {
                        eligible: tooFewEligible.eligible,
                        breakSize: tooFewEligible.breakSize,
                      })}
                    </Alert>
                  )}
                  {cutoffTies.map((tie) => (
                    <Alert
                      key={tie.cutoff}
                      role="alert"
                      tone="danger"
                      title={plural(
                        tie.cutoff === "break" ? "results.break.tieBreakTitle" : "results.break.tieReserveTitle",
                        tie.places,
                        { teams: tie.teams.length, rank: tie.teams[0]?.rank ?? 0 }
                      )}
                    >
                      {plural("results.break.tieBody", tie.places, {
                        names: formatList(tie.teams.map((entry) => entry.team.name)),
                        include: t(OVERRIDE_KEYS.include),
                        lostCoinToss: t(OVERRIDE_KEYS.lost_coin_toss),
                      })}
                    </Alert>
                  ))}
                  {breakIsStale && (
                    <Alert role="status" tone="warning">
                      {t("results.break.staleNotice")}
                    </Alert>
                  )}
                </div>
              )}

              <TableContainer className={TABLE_FRAME}>
                <Table>
                  <THead>
                    <TR>
                      <TH align="right" className="w-16">{t("results.break.colSeed")}</TH>
                      <TH align="right" className="w-20">
                        {t(selectedCategory.isGeneral ? "results.break.colTabRank" : "results.break.colCategoryRank")}
                      </TH>
                      <TH>{t("results.break.colTeam")}</TH>
                      <TH>{t("results.break.colInstitution")}</TH>
                      <TH align="right">{t("results.break.colPoints")}</TH>
                      <TH align="right">{t("results.break.colTotalSpeaks")}</TH>
                      <TH>{t("results.break.colStatus")}</TH>
                      <TH className="w-48">{t("results.break.colOverride")}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.length === 0 && <TableEmpty colSpan={8}>{t("results.break.noQualifiers")}</TableEmpty>}
                    {rows.map((row) => {
                      const excluded = row.status.kind === "excluded";
                      return (
                        <TR key={row.teamId}>
                          <TD numeric className="text-[13px] font-semibold">{seedLabel(row.status)}</TD>
                          <TD numeric className="text-fg-muted">{t("results.break.rankValue", { rank: row.rank })}</TD>
                          <TD className={excluded ? "text-fg-muted" : "font-medium"}>{row.teamName}</TD>
                          <TD className="text-fg-muted">{row.institutionName || "—"}</TD>
                          <TD numeric className="font-semibold">{plural("results.break.pointsValue", row.points)}</TD>
                          <TD numeric>{formatDecimal(row.totalSpeakerScore, 1)}</TD>
                          <TD>
                            <StatusPill tone={STATUS_TONES[row.status.kind]}>{statusLabel(row.status)}</StatusPill>
                          </TD>
                          <TD>
                            <Select
                              aria-label={t("results.break.overrideFor", { team: row.teamName })}
                              value={overrides[row.teamId] ?? ""}
                              disabled={isSavingOverride}
                              onChange={(event) =>
                                saveOverride(row.teamId, (event.target.value || null) as BreakTeamOverride | null)
                              }
                              className="h-7 text-xs"
                            >
                              <option value="">{t("results.break.noOverride")}</option>
                              {OVERRIDE_OPTIONS.map((option) => (
                                <option key={option} value={option}>{t(OVERRIDE_KEYS[option])}</option>
                              ))}
                            </Select>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableContainer>
            </Card>

            {/* Manual overrides */}
            <Card>
              <CardHeader
                title={t("results.break.overridesTitle")}
                description={t("results.break.overridesDescription", {
                  include: t(OVERRIDE_KEYS.include),
                })}
              />
              <CardBody className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Select
                    id="override-team"
                    label={t("results.break.overrideTeam")}
                    value={overrideTeamId}
                    onChange={(event) => setOverrideTeamId(event.target.value)}
                    wrapperClassName="flex-1"
                  >
                    <option value="">{t("results.break.selectTeam")}</option>
                    {rankedTeams.map((team) => (
                      <option key={team.id} value={team.id}>{team.label}</option>
                    ))}
                  </Select>
                  <Select
                    id="override-value"
                    label={t("results.break.overrideValue")}
                    value={overrideValue}
                    onChange={(event) => setOverrideValue(event.target.value as BreakTeamOverride)}
                    wrapperClassName="sm:w-48"
                  >
                    {OVERRIDE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{t(OVERRIDE_KEYS[option])}</option>
                    ))}
                  </Select>
                  <Button
                    variant="secondary"
                    disabled={!overrideTeamId || isSavingOverride}
                    onClick={() => saveOverride(overrideTeamId, overrideValue)}
                  >
                    {t("results.break.applyOverride")}
                  </Button>
                </div>
                {overrideError && <p role="alert" className="text-xs text-danger">{overrideError}</p>}
                {overrideEntries.length > 0 ? (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {overrideEntries.map(([teamId, override]) => {
                      const teamName = teamNameById.get(teamId) ?? t("results.break.deletedTeam");
                      return (
                        <li key={teamId} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[13px]">
                          <span>
                            <strong className="font-medium text-fg">{teamName}</strong>
                            <span className="text-fg-muted"> · {t(OVERRIDE_KEYS[override])}</span>
                          </span>
                          <IconButton
                            size="sm"
                            label={t("results.break.removeOverride", { team: teamName })}
                            icon={<X />}
                            disabled={isSavingOverride}
                            onClick={() => saveOverride(teamId, null)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-fg-muted">{t("results.break.noOverrides")}</p>
                )}
              </CardBody>
            </Card>
          </TabPanel>
        </>
      ) : (
        <EmptyState
          icon={<Award aria-hidden="true" />}
          title={t("results.break.emptyTitle")}
          description={t("results.break.emptyDescription")}
          action={
            <Button variant="primary" onClick={() => openEditor()}>
              <Plus aria-hidden="true" />
              {t("results.break.addBreakCategory")}
            </Button>
          }
        />
      )}

      {/* Add / Edit Break Category */}
      <Dialog
        open={editor !== null}
        onClose={() => setEditor(null)}
        dismissible={!isSavingCategory}
        icon={<Award className="text-fg-subtle" aria-hidden="true" />}
        title={t(editor?.editingId ? "results.break.editorEditTitle" : "results.break.editorAddTitle")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditor(null)} disabled={isSavingCategory}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              form={EDITOR_FORM_ID}
              variant="primary"
              loading={isSavingCategory}
              loadingText={t("results.break.saving")}
            >
              {t("results.break.saveCategory")}
            </Button>
          </>
        }
      >
        {editor && (
          <form id={EDITOR_FORM_ID} onSubmit={handleSaveCategory} className="space-y-4">
            <Input
              id="break-name"
              type="text"
              required
              label={t("results.break.fieldName")}
              placeholder={t("results.break.fieldNamePlaceholder")}
              value={editor.draft.name}
              onChange={(e) => updateDraft({ name: e.target.value })}
            />

            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  id="break-size"
                  type="number"
                  label={t("results.break.fieldBreakSize")}
                  min={teamsInDebate}
                  step={teamsInDebate === 4 ? 2 : 1}
                  value={editor.draft.breakSize}
                  onChange={(e) => updateDraft({ breakSize: parseInt(e.target.value, 10) || 0 })}
                  aria-describedby="break-size-help"
                />
                <Input
                  id="break-reserves"
                  type="number"
                  label={t("results.break.fieldReserveSize")}
                  min="0"
                  value={editor.draft.reserveSize}
                  onChange={(e) => updateDraft({ reserveSize: parseInt(e.target.value, 10) || 0 })}
                />
              </div>
              <p id="break-size-help" className="text-xs text-fg-muted">
                {t("results.break.fieldSizeHelp")}
                {teamsInDebate === 4 ? ` ${t("results.break.fieldSizeHelpBp")}` : ""}
              </p>
            </div>

            <Input
              id="break-priority"
              type="number"
              label={t("results.break.fieldPriority")}
              min="1"
              max="100"
              value={editor.draft.priority}
              onChange={(e) => updateDraft({ priority: parseInt(e.target.value, 10) || 0 })}
            />

            <Checkbox
              label={t("results.break.fieldGeneral")}
              description={t("results.break.fieldGeneralHelp")}
              checked={editor.draft.isGeneral}
              onChange={(e) => updateDraft({ isGeneral: e.target.checked })}
            />

            <Select
              id="break-rule"
              label={t("results.break.fieldRule")}
              help={t("results.break.fieldRuleHelp")}
              value={editor.draft.qualificationRule}
              onChange={(event) => updateDraft({ qualificationRule: event.target.value as BreakQualificationRule })}
            >
              {(Object.keys(QUALIFICATION_RULE_KEYS) as BreakQualificationRule[]).map((rule) => (
                <option key={rule} value={rule}>{t(QUALIFICATION_RULE_KEYS[rule])}</option>
              ))}
            </Select>

            <Input
              id="break-max-institution"
              type="number"
              label={t("results.break.fieldMaxPerInstitution")}
              help={t("results.break.fieldMaxPerInstitutionHelp")}
              min="0"
              max={editor.draft.breakSize}
              value={editor.draft.maxPerInstitution}
              onChange={(event) => updateDraft({ maxPerInstitution: Math.max(0, parseInt(event.target.value, 10) || 0) })}
            />

            <Input
              id="break-tab-limit"
              type="number"
              label={t("results.break.fieldTabLimit")}
              help={t("results.break.fieldTabLimitHelp")}
              min="0"
              value={editor.draft.limit ?? 0}
              onChange={(event) => updateDraft({ limit: Math.max(0, parseInt(event.target.value, 10) || 0) })}
            />

            {editorError && <p role="alert" className="text-xs text-danger">{editorError}</p>}
          </form>
        )}
      </Dialog>

      {pendingDelete && (
        <ConfirmActionDialog
          title={t("results.break.deleteTitle", { name: pendingDelete.name })}
          description={t("results.break.deleteDescription")}
          confirmLabel={t("results.break.deleteConfirm")}
          variant="danger"
          onConfirm={handleDeleteCategory}
          onCancel={() => {
            setPendingDelete(null);
            setDeleteError("");
          }}
          isBusy={isDeleting}
          error={deleteError}
        />
      )}
    </div>
  );
}
