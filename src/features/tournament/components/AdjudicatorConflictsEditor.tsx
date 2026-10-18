import { X } from "lucide-react";
import type { Adjudicator, Institution, Team } from "@/types";
import type { ConflictSelection } from "@/lib/adjudicators/conflicts";

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
  selectedIds: string[];
  options: Array<{ id: string; label: string }>;
  onChange(ids: string[]): void;
}

function ConflictList({ label, selectedIds, options, onChange }: ConflictListProps) {
  const labels = new Map(options.map((option) => [option.id, option.label]));
  const available = options.filter((option) => !selectedIds.includes(option.id));
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-gray-700">{label}</span>
        {selectedIds.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] text-red-800"
          >
            {labels.get(id) ?? "Removed record"}
            <button
              type="button"
              onClick={() => onChange(selectedIds.filter((item) => item !== id))}
              aria-label={`Remove conflict with ${labels.get(id) ?? "removed record"}`}
              className="text-red-500 hover:text-red-800"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {selectedIds.length === 0 && <span className="text-[11px] text-gray-400">None</span>}
      </div>
      <select
        value=""
        onChange={(event) => {
          if (event.target.value) onChange([...selectedIds, event.target.value]);
        }}
        aria-label={`Add ${label.toLowerCase()}`}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
      >
        <option value="">Add…</option>
        {available.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
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
  return (
    <fieldset className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
      <legend className="px-1 text-xs font-bold text-gray-800">Conflicts</legend>
      <p className="text-[11px] text-gray-500">
        The adjudicator&apos;s own institution is always a conflict. Auto-allocation avoids these and the
        allocation editor flags them.
      </p>
      <ConflictList
        label="Team conflicts"
        selectedIds={selection.teamIds}
        options={[...teams]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((team) => ({ id: team.id, label: team.institutionName ? `${team.name} (${team.institutionName})` : team.name }))}
        onChange={(teamIds) => onChange({ ...selection, teamIds })}
      />
      <ConflictList
        label="Adjudicator conflicts"
        selectedIds={selection.adjudicatorIds}
        options={adjudicators
          .filter((other) => other.id !== adjudicator.id)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((other) => ({ id: other.id, label: other.name }))}
        onChange={(adjudicatorIds) => onChange({ ...selection, adjudicatorIds })}
      />
      <ConflictList
        label="Other institution conflicts"
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
