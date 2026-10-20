"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import type {
  ScoreAggregation,
  ScoreCriterion,
  ScoreCriterionSpeechType,
  SideNames,
  SpeakerRanksMode,
  SpeakersInBallots,
  TournamentFormat,
  TournamentPreferences,
  WinnerDeclaration,
} from "@/types";
import {
  maximumMarginFor,
  motionsEnabled,
  replyScoreStep,
  requireSubstantiveForReply,
  scoreAggregationFor,
  scoreCriteriaFor,
  speakerRanksFor,
  speakersInBallotsFor,
  validateScoreCriteria,
  winnerDeclarationFor,
} from "@/lib/ballots/ballotRules";
import { SIDE_NAME_OPTIONS, SIDE_NAME_SETS, sideNamesFor } from "@/lib/sideNames";

/**
 * Settings for how ballots record results (Tabbycat's winners_in_ballots, speakers_in_ballots,
 * speaker_ranks, score_aggregation_function, maximum_margin, reply_score_step,
 * require_substantive_for_reply, side_names, enable_motions and score criteria).
 */
interface ResultsRulesSettingsProps {
  prefs: TournamentPreferences;
  onChange: (patch: Partial<TournamentPreferences>) => void;
  format: TournamentFormat;
  /** Ballots exist: settings that change a ballot's shape are fixed. */
  shapeLocked: boolean;
}

const WINNER_OPTIONS: [WinnerDeclaration, string][] = [
  ["none", "From the scores — the higher total wins; totals may not tie"],
  ["high-points", "Declared, as a check — the declared winner must have the higher total"],
  ["tied-points", "Declared, to break ties — equal totals allowed; the declared winner may not have the lower total"],
  ["low-points", "Declared, overriding the scores — low-point wins allowed"],
];

const SPEAKERS_OPTIONS: [SpeakersInBallots, string][] = [
  ["always", "Always"],
  ["prelim", "Preliminary rounds only (elimination ballots record the result only)"],
  ["never", "Never (ballots record the result only)"],
];

const RANK_OPTIONS: [SpeakerRanksMode, string][] = [
  ["none", "Do not rank speeches"],
  ["any", "Rank every speech, independently of the scores"],
  ["high-points", "Rank every speech; ranks must follow the scores"],
];

const SPEECH_TYPES: [ScoreCriterionSpeechType, string][] = [
  ["all", "All speeches"],
  ["substantive", "Substantive"],
  ["reply", "Reply"],
];

const box = "block p-3 rounded bg-gray-50 border border-gray-200";
const select = "w-full border border-gray-300 rounded px-3 py-2 text-xs bg-white disabled:bg-gray-100";
const help = "text-[11px] text-gray-500 block mt-1";

export function ResultsRulesSettings({ prefs, onChange, format, shapeLocked }: ResultsRulesSettingsProps) {
  const twoTeam = format !== "bp";
  const criteria = scoreCriteriaFor(prefs);
  const criteriaErrors = validateScoreCriteria(criteria);
  const lockedNote = "Ballots have been entered, so this is locked.";

  const setCriteria = (next: ScoreCriterion[]) =>
    onChange({ scoreCriteria: next.map((criterion, index) => ({ ...criterion, seq: index + 1 })) });
  const updateCriterion = (id: string, patch: Partial<ScoreCriterion>) =>
    setCriteria(criteria.map((criterion) => (criterion.id === id ? { ...criterion, ...patch } : criterion)));

  return (
    <div className="space-y-4">
      <label className={box}>
        <span className="font-semibold text-gray-800 block mb-1">Deciding the winner</span>
        <select
          value={winnerDeclarationFor(prefs)}
          onChange={(e) => {
            const mode = e.target.value as WinnerDeclaration;
            // allowLowPointWins is kept in step for older clients and saved data.
            onChange({ winnersInBallots: mode, allowLowPointWins: mode === "low-points" });
          }}
          className={select}
        >
          {WINNER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <span className={help}>
          {twoTeam
            ? "Applies to every scoresheet, voting sheets included. Replaces \"Allow low-point wins\"."
            : "BP: \"from the scores\" ranks teams by total; \"to break ties\" lets ranks order teams with equal totals; \"overriding\" accepts any ranks."}
        </span>
      </label>

      <label className={box}>
        <span className="font-semibold text-gray-800 block mb-1">Ballots ask for speaker scores</span>
        <select
          value={speakersInBallotsFor(prefs)}
          disabled={shapeLocked}
          onChange={(e) => onChange({ speakersInBallots: e.target.value as SpeakersInBallots })}
          className={select}
        >
          {SPEAKERS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <span className={help}>
          {shapeLocked
            ? lockedNote
            : "Results-only debates count for points and wins but not for speaks, margins or the speaker tab."}
        </span>
      </label>

      <label className={box}>
        <span className="font-semibold text-gray-800 block mb-1">Speech ranks</span>
        <select
          value={speakerRanksFor(prefs)}
          onChange={(e) => onChange({ speakerRanks: e.target.value as SpeakerRanksMode })}
          className={select}
        >
          {RANK_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <span className={help}>
          Consensus ballots rank every substantive speech in the debate (1 = best). Adds the
          &quot;Speech ranks (sum)&quot; speaker metric. Reply speeches are not ranked.
        </span>
      </label>

      {twoTeam && (
        <label className={box}>
          <span className="font-semibold text-gray-800 block mb-1">Panel score aggregation (voting ballots)</span>
          <select
            value={scoreAggregationFor(prefs)}
            onChange={(e) => onChange({ scoreAggregation: e.target.value as ScoreAggregation })}
            className={select}
          >
            <option value="mean">Mean (average)</option>
            <option value="median">Median (in even-numbered panels, the mean rounded up)</option>
          </select>
          <span className={help}>How a speech&apos;s scores from several adjudicators combine. Team totals are always the mean.</span>
        </label>
      )}

      {twoTeam && (
        <label className={box}>
          <span className="font-semibold text-gray-800 block mb-1">Maximum margin</span>
          <input
            type="number"
            min={0}
            step="any"
            value={maximumMarginFor(prefs) || 0}
            onChange={(e) => onChange({ maximumMargin: Math.max(0, Number(e.target.value) || 0) })}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
          />
          <span className={help}>The largest amount by which one team can beat another on a scoresheet; 0 means no limit.</span>
        </label>
      )}

      {twoTeam && prefs.replyScoresEnabled && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className={box}>
            <span className="font-semibold text-gray-800 block mb-1">Reply score step</span>
            <input
              type="number"
              min={0.01}
              step="any"
              value={replyScoreStep(prefs)}
              onChange={(e) => {
                const value = Number(e.target.value);
                onChange({ stepReplyScore: Number.isFinite(value) && value > 0 ? value : undefined });
              }}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
            />
            <span className={help}>E.g. 1 for whole points or 0.5 for half points. Unset, it is half the speaker score step.</span>
          </label>
          <label className="flex items-center space-x-2.5 p-3 rounded bg-gray-50 border border-gray-200 cursor-pointer">
            <input
              type="checkbox"
              checked={requireSubstantiveForReply(prefs)}
              onChange={(e) => onChange({ requireSubstantiveForReply: e.target.checked })}
              className="rounded border-gray-300 text-blue-600"
            />
            <div>
              <span className="font-semibold text-gray-800 block">Reply speaker must have given a substantive speech</span>
              <span className="text-[11px] text-gray-500">The last substantive speaker can never reply.</span>
            </div>
          </label>
        </div>
      )}

      {twoTeam && (
        <label className={box}>
          <span className="font-semibold text-gray-800 block mb-1">Side names</span>
          <select
            value={sideNamesFor(prefs)}
            onChange={(e) => onChange({ sideNames: e.target.value as SideNames })}
            className={select}
          >
            {SIDE_NAME_OPTIONS.map((value) => <option key={value} value={value}>{SIDE_NAME_SETS[value].label}</option>)}
          </select>
          <span className={help}>Used on ballots, the draw, printing and public pages.</span>
        </label>
      )}

      <label className="flex items-center space-x-2.5 p-3 rounded bg-gray-50 border border-gray-200 cursor-pointer">
        <input
          type="checkbox"
          checked={motionsEnabled(prefs)}
          onChange={(e) => onChange({ enableMotions: e.target.checked })}
          className="rounded border-gray-300 text-blue-600"
        />
        <div>
          <span className="font-semibold text-gray-800 block">Record motions on ballots</span>
          <span className="text-[11px] text-gray-500">Off: ballots and printed scoresheets do not ask for the motion or vetoes.</span>
        </div>
      </label>

      <fieldset className="p-3 rounded bg-gray-50 border border-gray-200 space-y-2" disabled={shapeLocked}>
        <legend className="px-1 font-semibold text-gray-800">Score criteria</legend>
        <p className="text-[11px] text-gray-500">
          {shapeLocked
            ? lockedNote
            : "Optional. With criteria, adjudicators score each one and a speech's score is the weighted sum (e.g. WSDC Style / Content / Strategy)."}
        </p>
        {criteria.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="p-1 font-semibold">Name</th>
                  <th className="p-1 font-semibold">Speeches</th>
                  <th className="p-1 font-semibold">Weight</th>
                  <th className="p-1 font-semibold">Min</th>
                  <th className="p-1 font-semibold">Max</th>
                  <th className="p-1 font-semibold">Step</th>
                  <th className="p-1 font-semibold">Required</th>
                  <th className="p-1"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {criteria.map((criterion) => {
                  const number = (field: "weight" | "minScore" | "maxScore" | "step") => (
                    <input
                      type="number"
                      step="any"
                      aria-label={`${criterion.name || "Criterion"} ${field}`}
                      value={Number.isFinite(criterion[field]) ? criterion[field] : ""}
                      onChange={(e) => updateCriterion(criterion.id, { [field]: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
                      className="w-16 border border-gray-300 rounded px-1.5 py-1 font-mono"
                    />
                  );
                  return (
                    <tr key={criterion.id}>
                      <td className="p-1">
                        <input
                          aria-label="Criterion name"
                          value={criterion.name}
                          maxLength={20}
                          onChange={(e) => updateCriterion(criterion.id, { name: e.target.value })}
                          className="w-28 border border-gray-300 rounded px-1.5 py-1"
                        />
                      </td>
                      <td className="p-1">
                        <select
                          aria-label={`${criterion.name || "Criterion"} speeches`}
                          value={criterion.speechType}
                          onChange={(e) => updateCriterion(criterion.id, { speechType: e.target.value as ScoreCriterionSpeechType })}
                          className="border border-gray-300 rounded px-1.5 py-1 bg-white"
                        >
                          {SPEECH_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </td>
                      <td className="p-1">{number("weight")}</td>
                      <td className="p-1">{number("minScore")}</td>
                      <td className="p-1">{number("maxScore")}</td>
                      <td className="p-1">{number("step")}</td>
                      <td className="p-1 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${criterion.name || "Criterion"} required`}
                          checked={criterion.required}
                          onChange={(e) => updateCriterion(criterion.id, { required: e.target.checked })}
                        />
                      </td>
                      <td className="p-1">
                        <button
                          type="button"
                          onClick={() => setCriteria(criteria.filter((item) => item.id !== criterion.id))}
                          className="text-red-600 hover:text-red-800 p-1"
                          aria-label={`Remove ${criterion.name || "criterion"}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {criteriaErrors.length > 0 && (
          <ul role="alert" className="text-[11px] text-red-700 space-y-0.5">
            {criteriaErrors.map((error) => <li key={error}>• {error}</li>)}
          </ul>
        )}
        <button
          type="button"
          onClick={() =>
            setCriteria([
              ...criteria,
              {
                id: `criterion-${Date.now().toString(36)}`,
                name: "",
                seq: criteria.length + 1,
                speechType: "all",
                weight: 1,
                minScore: prefs.minSpeakerScore ?? 0,
                maxScore: prefs.maxSpeakerScore ?? 100,
                step: prefs.stepSpeakerScore ?? 1,
                required: true,
              },
            ])
          }
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
        >
          <Plus className="w-3.5 h-3.5" /> Add criterion
        </button>
      </fieldset>
    </div>
  );
}
