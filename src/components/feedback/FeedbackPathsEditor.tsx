"use client";

import type { FeedbackPathConfig, TeamFeedbackTargets } from "@/types";

const ADJUDICATOR_PATHS: Array<{ key: keyof Omit<FeedbackPathConfig, "teams" | "onTeams">; label: string }> = [
  { key: "chairOnPanellists", label: "Chair on panellists" },
  { key: "chairOnTrainees", label: "Chair on trainees" },
  { key: "panellistsOnChair", label: "Panellists on chair" },
  { key: "traineesOnChair", label: "Trainees on chair" },
  { key: "adjudicatorsOnEachOther", label: "Every adjudicator on every other (trainees included)" },
];

/** Edits one set of feedback paths (who gives feedback on whom). */
export function FeedbackPathsEditor({
  idPrefix,
  legend,
  value,
  onChange,
}: {
  idPrefix: string;
  legend: string;
  value: FeedbackPathConfig;
  onChange: (value: FeedbackPathConfig) => void;
}) {
  return (
    <fieldset className="space-y-2 rounded border border-gray-200 p-3">
      <legend className="px-1 text-[11px] font-bold text-gray-800">{legend}</legend>
      <label htmlFor={`${idPrefix}-teams`} className="block text-[11px] font-semibold text-gray-700">
        Teams give feedback on
        <select
          id={`${idPrefix}-teams`}
          value={value.teams}
          onChange={(event) => onChange({ ...value, teams: event.target.value as TeamFeedbackTargets })}
          className="mt-1 w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
        >
          <option value="chair">The chair only</option>
          <option value="all_adjudicators">Every adjudicator on the panel</option>
          <option value="none">Nobody (no team feedback)</option>
        </select>
      </label>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {ADJUDICATOR_PATHS.map(({ key, label }) => (
          <label key={key} className="flex items-start gap-2 text-[11px] font-medium text-gray-700">
            <input
              type="checkbox"
              checked={value[key]}
              disabled={key !== "adjudicatorsOnEachOther" && value.adjudicatorsOnEachOther}
              onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
              className="mt-0.5"
            />
            {label}
          </label>
        ))}
        <label className="flex items-start gap-2 text-[11px] font-medium text-gray-700">
          <input
            type="checkbox"
            checked={value.onTeams}
            onChange={(event) => onChange({ ...value, onTeams: event.target.checked })}
            className="mt-0.5"
          />
          Also allow feedback on teams (optional, never counted in adjudicator scores)
        </label>
      </div>
    </fieldset>
  );
}
