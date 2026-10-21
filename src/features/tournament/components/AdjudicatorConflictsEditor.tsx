"use client";

import { X } from "lucide-react";
import type { Adjudicator, Institution, Team } from "@/types";
import type { ConflictSelection } from "@/lib/adjudicators/conflicts";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Select } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

interface AdjudicatorConflictsEditorProps {
  adjudicator: Adjudicator;
  selection: ConflictSelection;
  teams: Team[];
  adjudicators: Adjudicator[];
  institutions: Institution[];
  onChange(selection: ConflictSelection): void;
}

interface ConflictListProps {
  label: string;
  /** Accessible name of the "add" select. */
  addLabel: string;
  selectedIds: string[];
  options: Array<{ id: string; label: string }>;
  onChange(ids: string[]): void;
}

function ConflictList({ label, addLabel, selectedIds, options, onChange }: ConflictListProps) {
  const { t } = useI18n();
  const labels = new Map(options.map((option) => [option.id, option.label]));
  const available = options.filter((option) => !selectedIds.includes(option.id));
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-fg">{label}</span>
        {selectedIds.map((id) => {
          const name = labels.get(id) ?? t("setup.imports.removedRecord");
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-sm border border-danger-border bg-danger-subtle px-1.5 py-0.5 text-[11px] text-danger"
            >
              {name}
              <button
                type="button"
                onClick={() => onChange(selectedIds.filter((item) => item !== id))}
                aria-label={t("setup.imports.removeConflict", { name })}
                title={t("setup.imports.removeConflict", { name })}
                className={cn("rounded-sm text-danger hover:text-fg", focusRing)}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          );
        })}
        {selectedIds.length === 0 && <span className="text-[11px] text-fg-muted">{t("setup.common.none")}</span>}
      </div>
      <Select
        value=""
        onChange={(event) => {
          if (event.target.value) onChange([...selectedIds, event.target.value]);
        }}
        aria-label={addLabel}
      >
        <option value="">{t("setup.imports.conflictAddOption")}</option>
        {available.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </Select>
    </div>
  );
}

/** Edits team, adjudicator and additional institution conflicts for one adjudicator. */
export function AdjudicatorConflictsEditor({
  adjudicator,
  selection,
  teams,
  adjudicators,
  institutions,
  onChange,
}: AdjudicatorConflictsEditorProps) {
  const { t } = useI18n();
  return (
    <fieldset className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
      <legend className="px-1 text-xs font-medium text-fg">{t("setup.imports.conflictsLegend")}</legend>
      <p className="text-xs text-fg-muted">{t("setup.imports.conflictsHelp")}</p>
      <ConflictList
        label={t("setup.imports.teamConflicts")}
        addLabel={t("setup.imports.addTeamConflict")}
        selectedIds={selection.teamIds}
        options={[...teams]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((team) => ({ id: team.id, label: team.institutionName ? `${team.name} (${team.institutionName})` : team.name }))}
        onChange={(teamIds) => onChange({ ...selection, teamIds })}
      />
      <ConflictList
        label={t("setup.imports.adjudicatorConflicts")}
        addLabel={t("setup.imports.addAdjudicatorConflict")}
        selectedIds={selection.adjudicatorIds}
        options={adjudicators
          .filter((other) => other.id !== adjudicator.id)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((other) => ({ id: other.id, label: other.name }))}
        onChange={(adjudicatorIds) => onChange({ ...selection, adjudicatorIds })}
      />
      <ConflictList
        label={t("setup.imports.institutionConflicts")}
        addLabel={t("setup.imports.addInstitutionConflict")}
        selectedIds={selection.institutionIds}
        options={institutions
          .filter((institution) => institution.id !== adjudicator.institutionId)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((institution) => ({ id: institution.id, label: `${institution.name} (${institution.code})` }))}
        onChange={(institutionIds) => onChange({ ...selection, institutionIds })}
      />
    </fieldset>
  );
}
