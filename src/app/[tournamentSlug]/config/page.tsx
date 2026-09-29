"use client";

import React, { useState } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import {
  Sliders,
  Save,
  CheckCircle2,
  Shield,
  Eye,
  Shuffle,
  FileCheck2,
} from "lucide-react";
import { TournamentPreferences, TournamentFormat } from "@/types";
import { PrecedenceEditor, ExtraMetricsEditor } from "@/components/setup/PrecedenceEditor";
import {
  TEAM_METRIC_LABELS,
  SPEAKER_METRIC_LABELS,
  BP_ONLY_TEAM_METRICS,
  TWO_TEAM_ONLY_TEAM_METRICS,
} from "@/lib/standings/metrics";
import { resolveTeamPrecedence, resolveSpeakerPrecedence } from "@/lib/standings/precedence";
import { OddBracketMethod, PairingMethod, ConflictAvoidance, PullupRestriction } from "@/types";

export default function ConfigPage() {
  const { tournament, saveTournament } = useTournament();

  const [format, setFormat] = useState<TournamentFormat>(tournament?.format || "bp");
  const [prefs, setPrefs] = useState<TournamentPreferences>(
    tournament?.preferences || {
      teamsInDebate: 4,
      substantiveSpeakers: 2,
      replyScoresEnabled: false,
      minSpeakerScore: 68,
      maxSpeakerScore: 84,
      stepSpeakerScore: 1,
      minReplyScore: 34,
      maxReplyScore: 42,
      drawRule: "power_paired",
      sideAllocationRule: "balanced",
      ballotDoubleEntry: false,
      publicDraw: true,
      publicResults: true,
      publicStandings: true,
      publicMotions: true,
      feedbackEnabled: true,
      feedbackMinScore: 1,
      feedbackMaxScore: 10,
    }
  );

  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournament) return;

    await saveTournament({
      ...tournament,
      format,
      preferences: prefs,
      updatedAt: new Date().toISOString(),
    });

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="max-w-4xl space-y-6 pb-12">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <Sliders className="w-6 h-6 text-blue-600" />
            <span>Tournament Configuration</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Configure debate format rules, speaker score ranges, draw constraints, and public tab settings.
          </p>
        </div>

        {savedSuccess && (
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-bold rounded">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Settings Saved!</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* 1. Format & Speakers */}
        <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
            <Shield className="w-4 h-4 text-blue-600" />
            <span>Debate Format & Team Structure</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Parliamentary Format
              </label>
              <select
                value={format}
                onChange={(e) => {
                  const newFmt = e.target.value as TournamentFormat;
                  setFormat(newFmt);
                  if (newFmt === "bp") {
                    setPrefs((p) => ({
                      ...p,
                      teamsInDebate: 4,
                      substantiveSpeakers: 2,
                      replyScoresEnabled: false,
                    }));
                  } else {
                    setPrefs((p) => ({
                      ...p,
                      teamsInDebate: 2,
                      substantiveSpeakers: 3,
                      replyScoresEnabled: true,
                    }));
                  }
                }}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-semibold"
              >
                <option value="bp">British Parliamentary (BP) — 4 Teams, 2 Speakers/Team</option>
                <option value="uadc">Asian Parliamentary (UADC) — 2 Teams, 3 Speakers + Reply</option>
                <option value="australs">Australs — 2 Teams, 3 Speakers + Reply</option>
                <option value="wsdc">World Schools (WSDC) — 2 Teams, 3 Speakers + Reply</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Substantive Speakers per Team
              </label>
              <input
                type="number"
                min="1"
                max="5"
                value={prefs.substantiveSpeakers}
                onChange={(e) =>
                  setPrefs((p) => ({
                    ...p,
                    substantiveSpeakers: parseInt(e.target.value, 10),
                  }))
                }
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
              />
            </div>
          </div>
        </div>

        {/* 2. Speaker Score Bounds */}
        <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
            <FileCheck2 className="w-4 h-4 text-emerald-600" />
            <span>Speaker Scoring Parameters</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Minimum Speaker Score
              </label>
              <input
                type="number"
                value={prefs.minSpeakerScore}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, minSpeakerScore: parseFloat(e.target.value) || 68 }))
                }
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Maximum Speaker Score
              </label>
              <input
                type="number"
                value={prefs.maxSpeakerScore}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, maxSpeakerScore: parseFloat(e.target.value) || 84 }))
                }
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Score Step Increment
              </label>
              <select
                value={prefs.stepSpeakerScore}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, stepSpeakerScore: parseFloat(e.target.value) || 1 }))
                }
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono"
              >
                <option value={1}>1.0 (Integers only: 74, 75, 76...)</option>
                <option value={0.5}>0.5 (Half points: 74.5, 75.0...)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Standings rules */}
        <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-5">
          <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
            <Sliders className="w-4 h-4 text-blue-600" />
            <span>Standings Rules</span>
          </h3>
          <p className="text-xs text-gray-600">
            The order teams and speakers are ranked in. Leave empty to use the format&apos;s default. This also
            decides power-paired draws and who breaks.
          </p>

          <div>
            <h4 className="text-xs font-bold text-gray-800 mb-2">Team ranking</h4>
            <PrecedenceEditor
              value={prefs.teamStandingsPrecedence ?? []}
              onChange={(teamStandingsPrecedence) => setPrefs((p) => ({ ...p, teamStandingsPrecedence }))}
              labels={TEAM_METRIC_LABELS}
              disabledIds={format === "bp" ? TWO_TEAM_ONLY_TEAM_METRICS : BP_ONLY_TEAM_METRICS}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Default for this format: {resolveTeamPrecedence(format, {}).map((m) => TEAM_METRIC_LABELS[m]).join(" \u2192 ")}
            </p>
          </div>

          <div>
            <h4 className="text-xs font-bold text-gray-800 mb-2">Extra team metrics (shown, not ranked on)</h4>
            <ExtraMetricsEditor
              value={prefs.teamStandingsExtra ?? []}
              onChange={(teamStandingsExtra) => setPrefs((p) => ({ ...p, teamStandingsExtra }))}
              labels={TEAM_METRIC_LABELS}
              exclude={prefs.teamStandingsPrecedence ?? []}
            />
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h4 className="text-xs font-bold text-gray-800 mb-2">Speaker ranking</h4>
            <PrecedenceEditor
              value={prefs.speakerStandingsPrecedence ?? []}
              onChange={(speakerStandingsPrecedence) => setPrefs((p) => ({ ...p, speakerStandingsPrecedence }))}
              labels={SPEAKER_METRIC_LABELS}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Default: {resolveSpeakerPrecedence({}).map((m) => SPEAKER_METRIC_LABELS[m]).join(" \u2192 ")}
            </p>
          </div>

          <div>
            <h4 className="text-xs font-bold text-gray-800 mb-2">Extra speaker metrics (shown, not ranked on)</h4>
            <ExtraMetricsEditor
              value={prefs.speakerStandingsExtra ?? []}
              onChange={(speakerStandingsExtra) => setPrefs((p) => ({ ...p, speakerStandingsExtra }))}
              labels={SPEAKER_METRIC_LABELS}
              exclude={prefs.speakerStandingsPrecedence ?? []}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Speaker trim (for speaks_trimmed_mean)
            </label>
            <input
              type="number"
              min={0}
              className="w-32 border border-gray-300 rounded px-3 py-1.5 text-xs"
              value={prefs.speakerTrim ?? 0}
              onChange={(e) => setPrefs((p) => ({ ...p, speakerTrim: Math.max(0, Number(e.target.value) || 0) }))}
            />
            <p className="text-[11px] text-gray-500 mt-1">Number of a speaker&apos;s lowest scores dropped before averaging.</p>
          </div>
        </div>

        {/* BP clash penalties (C2) */}
        {format === "bp" && (
          <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
              <Sliders className="w-4 h-4 text-blue-600" />
              <span>Draw Generation</span>
            </h3>
            <p className="text-xs text-gray-600">
              How heavily the BP draw penalizes a rematch or an institution clash when searching for a
              clean grouping within a bracket.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Repeat matchup penalty</label>
                <input
                  type="number"
                  min={0}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  value={prefs.repeatMatchupPenalty ?? 1000}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, repeatMatchupPenalty: Math.max(0, Number(e.target.value) || 0) }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Institution clash penalty</label>
                <input
                  type="number"
                  min={0}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  value={prefs.institutionClashPenalty ?? 200}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, institutionClashPenalty: Math.max(0, Number(e.target.value) || 0) }))
                  }
                />
              </div>
            </div>
          </div>
        )}

        {/* Two-team draw generation (C2) */}
        {format !== "bp" && (
          <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
              <Sliders className="w-4 h-4 text-blue-600" />
              <span>Draw Generation</span>
            </h3>
            <p className="text-xs text-gray-600">
              How preliminary draws are built for two-team rounds. Brackets are grouped by wins.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Pairing within a bracket</label>
                <select
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                  value={prefs.pairingMethod ?? "fold"}
                  onChange={(e) => setPrefs((p) => ({ ...p, pairingMethod: e.target.value as PairingMethod }))}
                >
                  <option value="fold">Fold (strongest vs weakest)</option>
                  <option value="slide">Slide (top half vs bottom half)</option>
                  <option value="adjacent">Adjacent (1v2, 3v4, ...)</option>
                  <option value="fold_top_adjacent_rest">Fold top room, adjacent for the rest</option>
                  <option value="random">Random within bracket</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Odd bracket resolution</label>
                <select
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                  value={prefs.oddBracketMethod ?? "pullup_top"}
                  onChange={(e) => setPrefs((p) => ({ ...p, oddBracketMethod: e.target.value as OddBracketMethod }))}
                >
                  <option value="pullup_top">Pull up the top team from below</option>
                  <option value="pullup_bottom">Pull up the bottom team from below</option>
                  <option value="pullup_middle">Pull up the middle team from below</option>
                  <option value="pullup_random">Pull up a random team from below</option>
                  <option value="intermediate">Intermediate bubble room (top team)</option>
                  <option value="intermediate_bubble">Intermediate bubble room (restricted)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Who can be pulled up</label>
                <select
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                  value={prefs.pullupRestriction ?? "none"}
                  onChange={(e) => setPrefs((p) => ({ ...p, pullupRestriction: e.target.value as PullupRestriction }))}
                >
                  <option value="none">No restriction</option>
                  <option value="least_pulled">Teams pulled up the fewest times so far</option>
                  <option value="lowest_draw_strength_speaks">Lowest draw strength (speaks)</option>
                  <option value="lowest_draw_strength_wins">Lowest draw strength (wins)</option>
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  Narrows the candidates before the odd bracket rule above picks one.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Conflict avoidance</label>
                <select
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                  value={prefs.conflictAvoidance ?? "one_up_one_down"}
                  onChange={(e) => setPrefs((p) => ({ ...p, conflictAvoidance: e.target.value as ConflictAvoidance }))}
                >
                  <option value="off">Off</option>
                  <option value="one_up_one_down">One up, one down (fast, local swaps)</option>
                  <option value="min_cost">Minimum cost (slower, finds the true best)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* 3. Public Visibility Controls */}
        <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
            <Eye className="w-4 h-4 text-purple-600" />
            <span>Public Website Visibility Controls</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="flex items-center space-x-2.5 p-2 rounded bg-gray-50 border border-gray-200 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.publicDraw}
                onChange={(e) => setPrefs((p) => ({ ...p, publicDraw: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="font-semibold text-gray-800">Public Draw Display</span>
            </label>

            <label className="flex items-center space-x-2.5 p-2 rounded bg-gray-50 border border-gray-200 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.publicResults}
                onChange={(e) => setPrefs((p) => ({ ...p, publicResults: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="font-semibold text-gray-800">Public Results & Scores</span>
            </label>

            <label className="flex items-center space-x-2.5 p-2 rounded bg-gray-50 border border-gray-200 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.publicStandings}
                onChange={(e) => setPrefs((p) => ({ ...p, publicStandings: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="font-semibold text-gray-800">Public Standings Tab</span>
            </label>

            <label className="flex items-center space-x-2.5 p-2 rounded bg-gray-50 border border-gray-200 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.publicMotions}
                onChange={(e) => setPrefs((p) => ({ ...p, publicMotions: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="font-semibold text-gray-800">Public Motions Page</span>
            </label>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="inline-flex items-center space-x-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded shadow-xs transition"
          >
            <Save className="w-4 h-4" />
            <span>Save Tournament Settings</span>
          </button>
        </div>
      </form>
    </div>
  );
}
