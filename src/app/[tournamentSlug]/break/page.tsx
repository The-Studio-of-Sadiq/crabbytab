"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import confetti from "canvas-confetti";
import {
  AlertTriangle,
  Award,
  Sparkles,
  Plus,
  ArrowRight,
  CheckCircle2,
  Pencil,
  Trash2,
} from "lucide-react";
import { BreakCategory, BreakQualificationRule, BreakTeamOverride } from "@/types";
import {
  BREAK_EXCLUSION_LABELS,
  BREAK_OVERRIDE_LABELS,
  isGeneratedBreakStale,
  type BreakCategoryResult,
  type BreakExclusionReason,
} from "@/lib/breakqual/calculator";
import {
  getBreakCategoryDeletionBlocker,
  upsertBreakCategory,
  validateBreakCategoryDraft,
  withTeamOverride,
  type BreakCategoryDraft,
} from "@/features/tournament/application/breaks";
import { eliminationByeCount } from "@/lib/draw/elimination";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { SpeakerCategoryEligibilityPanel } from "@/features/tournament/components/SpeakerCategoryEligibilityPanel";

const OVERRIDE_OPTIONS: BreakTeamOverride[] = [
  "include",
  "ineligible",
  "withdrawn",
  "different_break",
  "disqualified",
  "lost_coin_toss",
];

const EMPTY_DRAFT: BreakCategoryDraft = {
  name: "",
  breakSize: 8,
  reserveSize: 2,
  priority: 5,
  isGeneral: false,
  maxPerInstitution: 0,
  qualificationRule: "standard",
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
  };
}

interface BreakRow {
  teamId: string;
  teamName: string;
  institutionName?: string;
  rank: number;
  points: number;
  totalSpeakerScore: number;
  seedLabel: string;
  status: string;
  tone: "breaking" | "reserve" | "tied" | "excluded";
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
      seedLabel: String(entry.seed),
      status: `${generatedIds.has(entry.team.id) ? "Breaking" : "Qualifies"}${entry.manuallyIncluded ? " (manual)" : ""}`,
      tone: "breaking" as const,
    })),
    ...result.reserveTeams.map((entry) => ({
      teamId: entry.team.id,
      teamName: entry.team.name,
      institutionName: entry.team.institutionName,
      rank: entry.rank,
      points: entry.standing.points,
      totalSpeakerScore: entry.standing.totalSpeakerScore,
      seedLabel: `R${entry.reserveIndex}`,
      status: `Reserve ${entry.reserveIndex}`,
      tone: "reserve" as const,
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
        seedLabel: "?",
        status: `Tied: ${tie.places} of ${tie.teams.length} ${tie.cutoff === "break" ? "break" : "reserve"} place${tie.places === 1 ? "" : "s"}`,
        tone: "tied" as const,
      }))
    ),
    ...result.excludedTeams.map((entry) => ({
      teamId: entry.team.id,
      teamName: entry.team.name,
      institutionName: entry.team.institutionName,
      rank: entry.rank,
      points: entry.standing.points,
      totalSpeakerScore: entry.standing.totalSpeakerScore,
      seedLabel: "—",
      status: BREAK_EXCLUSION_LABELS[entry.reason as BreakExclusionReason],
      tone: "excluded" as const,
    })),
  ];
  return rows;
}

const STATUS_CLASSES: Record<BreakRow["tone"], string> = {
  breaking: "bg-purple-100 text-purple-800 border-purple-300",
  reserve: "bg-amber-50 text-amber-800 border-amber-300",
  tied: "bg-red-50 text-red-800 border-red-300",
  excluded: "bg-gray-100 text-gray-700 border-gray-300",
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
      setEditorError(error instanceof Error ? error.message : "The break category could not be saved.");
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
      setDeleteError(error instanceof Error ? error.message : "The break category could not be deleted.");
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
      setOverrideError(error instanceof Error ? error.message : "The override could not be saved.");
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
      setBreakGenerationError(error instanceof Error ? error.message : "The break could not be saved. Please try again.");
    } finally {
      setIsGeneratingBreak(false);
    }
  };

  const teamNameById = new Map(teams.map((team) => [team.id, team.name]));
  const overrideEntries = Object.entries(overrides).sort(([left], [right]) =>
    (teamNameById.get(left) ?? left).localeCompare(teamNameById.get(right) ?? right)
  );
  const rankedTeams = teamStandings.length > 0
    ? teamStandings.map((standing) => ({ id: standing.teamId, label: `#${standing.rank} ${standing.teamName}` }))
    : teams.map((team) => ({ id: team.id, label: team.name }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <Award className="w-6 h-6 text-purple-600" />
            <span>Break Qualification & Out-Rounds</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Calculate breaking teams across Open, ESL, and Novice categories with priority resolution.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={triggerCelebration}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-bold shadow-xs transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Celebrate Break</span>
          </button>

          <button
            onClick={() => openEditor()}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded text-xs font-semibold border border-gray-300 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Category</span>
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center space-x-2 border-b border-[#d0d7de] pb-3 overflow-x-auto">
        {breakResults.map((res) => (
          <button
            key={res.category.id}
            onClick={() => setActiveCategorySlug(res.category.slug)}
            aria-pressed={selectedResult?.category.id === res.category.id}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-2 ${
              selectedResult?.category.id === res.category.id
                ? "bg-purple-600 text-white shadow-xs"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <span>{res.category.name}</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                selectedResult?.category.id === res.category.id
                  ? "bg-purple-800 text-purple-200"
                  : "bg-gray-200 text-gray-700"
              }`}
            >
              Top {res.category.breakSize}
            </span>
          </button>
        ))}
      </div>

      {/* Breaking Teams List */}
      {selectedResult && selectedCategory ? (
        <div className="space-y-6">
          <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
            <div className="p-4 bg-[#f6f8fa] border-b border-[#d0d7de] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <span>
                    {selectedCategory.name} Breaking Teams ({selectedResult.breakingTeams.length} teams)
                  </span>
                  <button
                    type="button"
                    onClick={() => openEditor(selectedCategory)}
                    className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => requestDelete(selectedCategory)}
                    className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    Delete
                  </button>
                </h3>
                <p className="text-xs text-gray-500">
                  {selectedCategory.isGeneral ? "General (all teams eligible)" : "Eligible teams only"} &bull; Priority:{" "}
                  {selectedCategory.priority} &bull; Break Size: {selectedCategory.breakSize} &bull; Reserves:{" "}
                  {selectedCategory.reserveSize}
                  {byeCount > 0 && <> &bull; Partial elimination: top {byeCount} seeds get a bye</>}
                </p>
              </div>

              <div className="flex flex-col items-start lg:items-end gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateBreak}
                    disabled={isGeneratingBreak || breakResults.length === 0 || cutoffTies.length > 0}
                    title={cutoffTies.length > 0 ? "Resolve the tie at the cutoff first" : undefined}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shadow-xs transition disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isGeneratingBreak ? "Generating..." : categoryHasBeenGenerated ? "Regenerate Break" : "Generate Break"}</span>
                  </button>
                  {categoryHasBeenGenerated && categoryFirstRound && (
                    <Link
                      href={`/${tournament?.slug}/draw`}
                      onClick={() => setActiveRound(categoryFirstRound)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-xs transition"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span>Open {categoryFirstRound.name}</span>
                    </Link>
                  )}
                </div>
                {breakGenerationError && <span role="alert" className="text-[11px] text-red-600">{breakGenerationError}</span>}
                {categoryHasBeenGenerated && (
                  <span className="text-[11px] text-gray-500">
                    {selectedCategory.generatedBreak?.breakingTeamIds.length ?? selectedResult.breakingTeams.length} teams
                    breaking in this category; {eliminatedTeamsCount} teams eliminated overall
                  </span>
                )}
              </div>
            </div>

            <SpeakerCategoryEligibilityPanel category={selectedCategory} />

            {cutoffTies.map((tie) => (
              <div
                key={tie.cutoff}
                role="alert"
                className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-900"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
                <div>
                  <p className="font-semibold">
                    Unresolved tie at the {tie.cutoff === "break" ? "break" : "reserve"} cutoff:{" "}
                    {tie.teams.length} teams tied at rank {tie.teams[0]?.rank} for {tie.places}{" "}
                    {tie.cutoff === "break" ? "breaking" : "reserve"} place{tie.places === 1 ? "" : "s"}.
                  </p>
                  <p className="mt-0.5">
                    {tie.teams.map((entry) => entry.team.name).join(", ")} are level on every standings metric, so
                    CrabbyTab will not pick between them. Decide it (for example by coin toss) and record the result
                    with overrides: &ldquo;Manually included&rdquo; for the team{tie.places === 1 ? "" : "s"} that go
                    {tie.places === 1 ? "es" : ""} through (the others stay in the running for reserve places), or
                    &ldquo;Lost coin toss&rdquo; for the others (which removes them from this category). The break
                    cannot be generated until then.
                  </p>
                </div>
              </div>
            ))}

            {breakIsStale && (
              <p role="status" className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
                The calculated break below differs from the break that was generated (standings, settings or
                overrides changed). Regenerate the break to apply it.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left tabby-table">
                <thead>
                  <tr>
                    <th className="w-16 text-center">Seed</th>
                    <th className="w-16 text-center">Tab Rank</th>
                    <th>Team</th>
                    <th>Institution</th>
                    <th className="text-right">Points</th>
                    <th className="text-right">Total Speaks</th>
                    <th className="text-center w-32">Status</th>
                    <th className="w-44">Override</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.teamId} className={row.tone === "excluded" ? "bg-gray-50/60" : "hover:bg-purple-50/40"}>
                      <td className="text-center font-mono font-bold text-sm text-purple-700">{row.seedLabel}</td>
                      <td className="text-center font-mono text-xs text-gray-600">#{row.rank}</td>
                      <td className={`text-xs ${row.tone === "excluded" ? "text-gray-500" : "font-bold text-gray-900"}`}>
                        {row.teamName}
                      </td>
                      <td className="text-xs text-gray-600">{row.institutionName || "—"}</td>
                      <td className="text-right font-mono font-bold text-xs text-blue-600">{row.points} pts</td>
                      <td className="text-right font-mono font-semibold text-xs text-gray-800">
                        {row.totalSpeakerScore.toFixed(1)}
                      </td>
                      <td className="text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${STATUS_CLASSES[row.tone]}`}>
                          {row.status}
                        </span>
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={`override-${row.teamId}`}>
                          Override for {row.teamName}
                        </label>
                        <select
                          id={`override-${row.teamId}`}
                          value={overrides[row.teamId] ?? ""}
                          disabled={isSavingOverride}
                          onChange={(event) =>
                            saveOverride(row.teamId, (event.target.value || null) as BreakTeamOverride | null)
                          }
                          className="w-full border border-gray-300 rounded px-2 py-1 text-[11px] bg-white"
                        >
                          <option value="">No override</option>
                          {OVERRIDE_OPTIONS.map((option) => (
                            <option key={option} value={option}>{BREAK_OVERRIDE_LABELS[option]}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-xs text-gray-500">
                        No teams qualify for this category yet. Teams need confirmed preliminary results and,
                        for a non-general category, eligibility set on the team.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Manual overrides */}
          <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs p-4 space-y-3">
            <div>
              <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Manual overrides</h4>
              <p className="text-[11px] text-gray-500 mt-0.5">
                &ldquo;Manually included&rdquo; forces a team into this break (it takes a break place first; it still
                cannot break in two categories). Any other remark removes the team from this category. Regenerate the
                break after changing overrides.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
              <div className="flex-1">
                <label htmlFor="override-team" className="block text-[11px] font-semibold text-gray-700 mb-1">Team</label>
                <select
                  id="override-team"
                  value={overrideTeamId}
                  onChange={(event) => setOverrideTeamId(event.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white"
                >
                  <option value="">Select a team…</option>
                  {rankedTeams.map((team) => (
                    <option key={team.id} value={team.id}>{team.label}</option>
                  ))}
                </select>
              </div>
              <div className="sm:w-48">
                <label htmlFor="override-value" className="block text-[11px] font-semibold text-gray-700 mb-1">Override</label>
                <select
                  id="override-value"
                  value={overrideValue}
                  onChange={(event) => setOverrideValue(event.target.value as BreakTeamOverride)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white"
                >
                  {OVERRIDE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{BREAK_OVERRIDE_LABELS[option]}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                disabled={!overrideTeamId || isSavingOverride}
                onClick={() => saveOverride(overrideTeamId, overrideValue)}
                className="px-3 py-1.5 rounded bg-purple-600 text-white text-xs font-bold hover:bg-purple-700 disabled:opacity-50"
              >
                Apply override
              </button>
            </div>
            {overrideError && <p role="alert" className="text-[11px] text-red-600">{overrideError}</p>}
            {overrideEntries.length > 0 ? (
              <ul className="divide-y divide-gray-100 border border-gray-200 rounded">
                {overrideEntries.map(([teamId, override]) => (
                  <li key={teamId} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span>
                      <strong className="text-gray-900">{teamNameById.get(teamId) ?? "Deleted team"}</strong>
                      <span className="text-gray-500"> &middot; {BREAK_OVERRIDE_LABELS[override]}</span>
                    </span>
                    <button
                      type="button"
                      disabled={isSavingOverride}
                      onClick={() => saveOverride(teamId, null)}
                      className="text-[11px] font-semibold text-red-700 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-gray-500">No overrides for this category.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-10 text-center">
          <Award className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-gray-800 mb-1">No Break Categories Defined</h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto mb-4">
            Add Open, ESL, or Novice break categories to calculate qualifying breaking teams.
          </p>
          <button
            onClick={() => openEditor()}
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-bold shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Break Category</span>
          </button>
        </div>
      )}

      {/* Add / Edit Break Category Modal */}
      {editor && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="break-category-editor-title"
            className="bg-white text-gray-900 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-200 max-h-[90vh] overflow-y-auto"
          >
            <h3 id="break-category-editor-title" className="text-base font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Award className="w-5 h-5 text-purple-600" />
              <span>{editor.editingId ? "Edit Break Category" : "Add Break Category"}</span>
            </h3>
            <form onSubmit={handleSaveCategory} className="space-y-4 text-sm">
              <div>
                <label htmlFor="break-name" className="block text-xs font-semibold text-gray-700 mb-1">Category Name</label>
                <input
                  id="break-name"
                  type="text"
                  required
                  placeholder="e.g. ESL Break or Novice Break"
                  value={editor.draft.name}
                  onChange={(e) => updateDraft({ name: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="break-size" className="block text-xs font-semibold text-gray-700 mb-1">Break Size</label>
                  <input
                    id="break-size"
                    type="number"
                    min={teamsInDebate}
                    step={teamsInDebate === 4 ? 2 : 1}
                    value={editor.draft.breakSize}
                    onChange={(e) => updateDraft({ breakSize: parseInt(e.target.value, 10) || 0 })}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="break-reserves" className="block text-xs font-semibold text-gray-700 mb-1">Reserve Size</label>
                  <input
                    id="break-reserves"
                    type="number"
                    min="0"
                    value={editor.draft.reserveSize}
                    onChange={(e) => updateDraft({ reserveSize: parseInt(e.target.value, 10) || 0 })}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <p className="-mt-2 text-[11px] text-gray-500">
                Sizes that do not halve cleanly (e.g. 12 or 24) start with a partial elimination round in which the top
                seeds get a bye.{teamsInDebate === 4 ? " BP break sizes must be even." : ""}
              </p>

              <div>
                <label htmlFor="break-priority" className="block text-xs font-semibold text-gray-700 mb-1">
                  Priority Order (Higher takes precedence)
                </label>
                <input
                  id="break-priority"
                  type="number"
                  min="1"
                  max="100"
                  value={editor.draft.priority}
                  onChange={(e) => updateDraft({ priority: parseInt(e.target.value, 10) || 0 })}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>

              <label className="flex items-start gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={editor.draft.isGeneral}
                  onChange={(e) => updateDraft({ isGeneral: e.target.checked })}
                  className="mt-0.5 rounded border-gray-300 text-purple-600"
                />
                <span>
                  <strong className="block text-gray-900">General category</strong>
                  Every team is eligible (like an Open break). Otherwise only teams marked eligible for this category
                  on their team record can break here.
                </span>
              </label>

              <div>
                <label htmlFor="break-rule" className="block text-xs font-semibold text-gray-700 mb-1">
                  Break qualification rule
                </label>
                <select
                  id="break-rule"
                  value={editor.draft.qualificationRule}
                  onChange={(event) => updateDraft({ qualificationRule: event.target.value as BreakQualificationRule })}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                >
                  <option value="standard">Standard — highest-ranked eligible teams</option>
                  <option value="aida_1996">AIDA 1996 — maximum three teams per institution</option>
                  <option value="aida_2016_australs">AIDA 2016 Australs</option>
                  <option value="aida_2016_easters">AIDA 2016 Easters</option>
                  <option value="aida_2019_australs_open">AIDA 2019 Australs (open, dynamic cap)</option>
                </select>
                <p className="mt-1 text-[11px] text-gray-500">
                  AIDA 2016 rules use wins and institution ranking; Easters gives capped teams inside the natural break priority when reinserting teams. AIDA 2019 Australs follows AIDA 2016 Australs with a cap of 3 teams per institution, plus one for every 8 teams the break exceeds 16. The institution limit below applies only to the standard rule.
                </p>
              </div>

              <div>
                <label htmlFor="break-max-institution" className="block text-xs font-semibold text-gray-700 mb-1">
                  Maximum qualifiers per institution
                </label>
                <input
                  id="break-max-institution"
                  type="number"
                  min="0"
                  max={editor.draft.breakSize}
                  value={editor.draft.maxPerInstitution}
                  onChange={(event) => updateDraft({ maxPerInstitution: Math.max(0, parseInt(event.target.value, 10) || 0) })}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Set to 0 for no limit. Applied to breaking teams and reserves when using the standard rule.
                </p>
              </div>

              {editorError && <p role="alert" className="text-xs text-red-600">{editorError}</p>}

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingCategory}
                  className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded shadow-xs disabled:opacity-50"
                >
                  {isSavingCategory ? "Saving..." : "Save Category"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pendingDelete && (
        <ConfirmActionDialog
          title={`Delete ${pendingDelete.name}?`}
          description="This removes the category and its overrides. Team eligibility entries for it are ignored afterwards."
          confirmLabel="Delete category"
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
