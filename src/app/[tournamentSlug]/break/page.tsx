"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import confetti from "canvas-confetti";
import {
  Award,
  Sparkles,
  Trophy,
  Plus,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { BreakCategory } from "@/types";

export default function BreakPage() {
  const {
    tournament,
    teams,
    rounds,
    setActiveRound,
    breakCategories,
    breakResults,
    saveBreakCategories,
    generateBreak,
  } = useTournament();

  const [activeCategorySlug, setActiveCategorySlug] = useState<string>("open");
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatBreakSize, setNewCatBreakSize] = useState(8);
  const [newCatReserveSize, setNewCatReserveSize] = useState(2);
  const [newCatMaxPerInstitution, setNewCatMaxPerInstitution] = useState(0);
  const [newCatIsGeneral, setNewCatIsGeneral] = useState(false);
  const [newCatPriority, setNewCatPriority] = useState(5);
  const [isGeneratingBreak, setIsGeneratingBreak] = useState(false);
  const [breakGenerationError, setBreakGenerationError] = useState("");

  const breakHasBeenGenerated = teams.some((team) => team.breakCategoryIds !== undefined);
  const eliminatedTeamsCount = teams.filter((team) => team.breakStatus === "eliminated").length;

  const selectedResult =
    breakResults.find((r) => r.category.slug === activeCategorySlug) ||
    breakResults[0];
  const categoryFirstRound = selectedResult && rounds
    .filter((round) => round.stage === "elimination" && round.breakCategoryIds?.includes(selectedResult.category.id))
    .sort((a, b) => a.seq - b.seq)[0];

  const triggerCelebration = () => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;

    const newCat: BreakCategory = {
      id: `bc-${Date.now()}`,
      tournamentId: tournament?.id || "",
      name: newCatName.trim(),
      slug: newCatName.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      seq: breakCategories.length + 1,
      breakSize: newCatBreakSize,
      reserveSize: newCatReserveSize,
      isGeneral: newCatIsGeneral,
      priority: newCatPriority,
      maxPerInstitution: newCatMaxPerInstitution > 0 ? newCatMaxPerInstitution : undefined,
    };

    const updated = [...breakCategories, newCat];
    await saveBreakCategories(updated);
    setShowAddCategoryModal(false);
    setNewCatName("");
    setNewCatMaxPerInstitution(0);
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
            onClick={() => setShowAddCategoryModal(true)}
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
      {selectedResult ? (
        <div className="space-y-6">
          <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
            <div className="p-4 bg-[#f6f8fa] border-b border-[#d0d7de] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900">
                  {selectedResult.category.name} Breaking Teams (
                  {selectedResult.breakingTeams.length} teams)
                </h3>
                <p className="text-xs text-gray-500">
                  Priority: {selectedResult.category.priority} &bull; Break Size:{" "}
                  {selectedResult.category.breakSize} &bull; Reserves:{" "}
                  {selectedResult.category.reserveSize}
                </p>
              </div>

              <div className="flex flex-col items-end gap-1.5">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateBreak}
                    disabled={isGeneratingBreak || breakResults.length === 0}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shadow-xs transition disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isGeneratingBreak ? "Generating..." : breakHasBeenGenerated ? "Regenerate Break" : "Generate Break"}</span>
                  </button>
                  {breakHasBeenGenerated && categoryFirstRound && (
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
                {breakHasBeenGenerated && (
                  <span className="text-[11px] text-gray-500">
                    {selectedResult.breakingTeams.length} qualifiers for this category; {eliminatedTeamsCount} teams eliminated overall
                  </span>
                )}
              </div>
            </div>

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
                    <th className="text-center w-24">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedResult.breakingTeams.map((entry) => (
                    <tr key={entry.team.id} className="hover:bg-purple-50/40">
                      <td className="text-center font-mono font-bold text-sm text-purple-700">
                        {entry.seed}
                      </td>
                      <td className="text-center font-mono text-xs text-gray-600">
                        #{entry.rank}
                      </td>
                      <td className="font-bold text-gray-900 text-xs">
                        {entry.team.name}
                      </td>
                      <td className="text-xs text-gray-600">
                        {entry.team.institutionName || "—"}
                      </td>
                      <td className="text-right font-mono font-bold text-xs text-blue-600">
                        {entry.standing.points} pts
                      </td>
                      <td className="text-right font-mono font-semibold text-xs text-gray-800">
                        {entry.standing.totalSpeakerScore.toFixed(1)}
                      </td>
                      <td className="text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-300 uppercase">
                          Breaking
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Reserves Table */}
          {selectedResult.reserveTeams.length > 0 && (
            <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
              <div className="p-3 bg-gray-50 border-b border-[#d0d7de]">
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                  Reserve Teams ({selectedResult.reserveTeams.length})
                </h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left tabby-table">
                  <thead>
                    <tr>
                      <th className="w-16 text-center">Reserve</th>
                      <th className="w-16 text-center">Tab Rank</th>
                      <th>Team</th>
                      <th>Institution</th>
                      <th className="text-right">Points</th>
                      <th className="text-right">Total Speaks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedResult.reserveTeams.map((entry) => (
                      <tr key={entry.team.id} className="hover:bg-gray-50">
                        <td className="text-center font-mono font-bold text-xs text-amber-700">
                          R{entry.reserveIndex}
                        </td>
                        <td className="text-center font-mono text-xs text-gray-600">
                          #{entry.rank}
                        </td>
                        <td className="font-semibold text-gray-800 text-xs">
                          {entry.team.name}
                        </td>
                        <td className="text-xs text-gray-500">
                          {entry.team.institutionName || "—"}
                        </td>
                        <td className="text-right font-mono text-xs text-gray-700">
                          {entry.standing.points} pts
                        </td>
                        <td className="text-right font-mono text-xs text-gray-700">
                          {entry.standing.totalSpeakerScore.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-10 text-center">
          <Award className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-gray-800 mb-1">No Break Categories Defined</h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto mb-4">
            Add Open, ESL, or Novice break categories to calculate qualifying breaking teams.
          </p>
          <button
            onClick={() => setShowAddCategoryModal(true)}
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-bold shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Break Category</span>
          </button>
        </div>
      )}

      {/* Add Break Category Modal */}
      {showAddCategoryModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Award className="w-5 h-5 text-purple-600" />
              <span>Add Break Category</span>
            </h3>
            <form onSubmit={handleAddCategory} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Category Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ESL Break or Novice Break"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Break Size</label>
                  <select
                    value={newCatBreakSize}
                    onChange={(e) => setNewCatBreakSize(parseInt(e.target.value, 10))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  >
                    <option value={64}>64 Teams (Triple Octos)</option>
                    <option value={32}>32 Teams (Double Octos)</option>
                    <option value={16}>16 Teams (Octos)</option>
                    <option value={8}>8 Teams (Quarters)</option>
                    <option value={4}>4 Teams (Semis)</option>
                    <option value={2}>2 Teams (Grand Final)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Reserve Size</label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={newCatReserveSize}
                    onChange={(e) => setNewCatReserveSize(parseInt(e.target.value, 10))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Priority Order (Higher takes precedence)</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={newCatPriority}
                  onChange={(e) => setNewCatPriority(parseInt(e.target.value, 10))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Maximum qualifiers per institution
                </label>
                <input
                  type="number"
                  min="0"
                  max={newCatBreakSize}
                  value={newCatMaxPerInstitution}
                  onChange={(event) => setNewCatMaxPerInstitution(Math.max(0, parseInt(event.target.value, 10) || 0))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Set to 0 for no limit. For example, 3 enforces the AIDA 2016 Easters institution cap; ranking order
                  is preserved and the next eligible institution is promoted. The limit also applies to reserves.
                </p>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAddCategoryModal(false)}
                  className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded shadow-xs"
                >
                  Save Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
