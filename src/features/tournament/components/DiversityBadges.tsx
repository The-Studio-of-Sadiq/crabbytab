import type { Institution } from "@/types";
import {
  formatDiversityCounts,
  panelDiversitySummary,
  participantGender,
  participantRegion,
  type DiversityFields,
} from "@/lib/adjudicators/diversity";

interface InstitutionLookup {
  institutionsById: Map<string, Pick<Institution, "region">>;
}

/** Text badges (not colour alone) for a participant's gender and region. */
export function DiversityBadges({ participant, institutionsById }: InstitutionLookup & { participant: DiversityFields }) {
  const gender = participantGender(participant);
  const region = participantRegion(participant, institutionsById);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        className="rounded border border-violet-200 bg-violet-50 px-1 py-0 text-[9px] font-semibold text-violet-800"
        title="Gender"
      >
        {gender ?? "Gender ?"}
      </span>
      <span
        className="rounded border border-teal-200 bg-teal-50 px-1 py-0 text-[9px] font-semibold text-teal-800"
        title="Region"
      >
        {region ?? "Region ?"}
      </span>
    </span>
  );
}

export function PanelDiversityLine({ members, institutionsById }: InstitutionLookup & { members: DiversityFields[] }) {
  const summary = panelDiversitySummary(members, institutionsById);
  return (
    <div className="px-3 py-1 bg-violet-50/50 border-b border-violet-100 text-[10px] text-gray-700">
      <span className="font-semibold text-violet-900">Panel of {summary.size}:</span>{" "}
      <span>Gender {formatDiversityCounts(summary.genders)}</span>
      <span className="mx-1 text-gray-400">·</span>
      <span>Region {formatDiversityCounts(summary.regions)}</span>
    </div>
  );
}
