"use client";

import type { FeedbackPathConfig, TeamFeedbackTargets } from "@/types";
import type { MessageKey } from "@/lib/i18n/messages";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Checkbox, Select } from "@/components/ui/Field";

const ADJUDICATOR_PATHS: Array<{ key: keyof Omit<FeedbackPathConfig, "teams" | "onTeams">; label: MessageKey }> = [
  { key: "chairOnPanellists", label: "results.feedback.paths.chairOnPanellists" },
  { key: "chairOnTrainees", label: "results.feedback.paths.chairOnTrainees" },
  { key: "panellistsOnChair", label: "results.feedback.paths.panellistsOnChair" },
  { key: "traineesOnChair", label: "results.feedback.paths.traineesOnChair" },
  { key: "panellistsOnEachOther", label: "results.feedback.paths.panellistsOnEachOther" },
  { key: "adjudicatorsOnEachOther", label: "results.feedback.paths.adjudicatorsOnEachOther" },
];

const TEAM_TARGETS: Array<{ value: TeamFeedbackTargets; label: MessageKey }> = [
  { value: "chair", label: "results.feedback.paths.teams.chair" },
  { value: "orallist", label: "results.feedback.paths.teams.orallist" },
  { value: "voting_allowed", label: "results.feedback.paths.teams.votingAllowed" },
  { value: "all_allowed", label: "results.feedback.paths.teams.allAllowed" },
  { value: "all_voting", label: "results.feedback.paths.teams.allVoting" },
  { value: "all_adjudicators", label: "results.feedback.paths.teams.allAdjudicators" },
  { value: "none", label: "results.feedback.paths.teams.none" },
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
  const { t } = useI18n();
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-semibold text-fg">{legend}</legend>
      <Select
        id={`${idPrefix}-teams`}
        label={t("results.feedback.paths.teamsLabel")}
        value={value.teams}
        onChange={(event) => onChange({ ...value, teams: event.target.value as TeamFeedbackTargets })}
      >
        {TEAM_TARGETS.map((target) => (
          <option key={target.value} value={target.value}>
            {t(target.label)}
          </option>
        ))}
      </Select>
      <div className="grid gap-2 sm:grid-cols-2">
        {ADJUDICATOR_PATHS.map(({ key, label }) => (
          <Checkbox
            key={key}
            id={`${idPrefix}-${key}`}
            label={t(label)}
            checked={value[key] === true}
            disabled={key !== "adjudicatorsOnEachOther" && value.adjudicatorsOnEachOther}
            onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
          />
        ))}
        <Checkbox
          id={`${idPrefix}-onTeams`}
          label={t("results.feedback.paths.onTeams")}
          checked={value.onTeams}
          onChange={(event) => onChange({ ...value, onTeams: event.target.checked })}
        />
      </div>
    </fieldset>
  );
}
