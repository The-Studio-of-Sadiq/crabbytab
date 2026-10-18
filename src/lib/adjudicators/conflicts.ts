import type { Adjudicator, AdjudicatorConflict, Institution } from "@/types";

function isOwnInstitutionConflict(conflict: AdjudicatorConflict, institutionId: string | undefined): boolean {
  return Boolean(
    institutionId &&
      conflict.type === "institution" &&
      conflict.institutionId === institutionId &&
      !conflict.teamId &&
      !conflict.adjudicatorId
  );
}

/**
 * Moves an adjudicator to another institution (or makes them independent). Only the
 * conflict with the previous own institution is replaced; team, adjudicator and other
 * institution conflicts are kept.
 */
export function changeAdjudicatorInstitution(
  adjudicator: Adjudicator,
  institution: Pick<Institution, "id" | "name"> | undefined
): Adjudicator {
  const kept = (adjudicator.conflicts ?? []).filter(
    (conflict) => !isOwnInstitutionConflict(conflict, adjudicator.institutionId)
  );
  const alreadyConflicted = institution && kept.some((conflict) => isOwnInstitutionConflict(conflict, institution.id));
  return {
    ...adjudicator,
    institutionId: institution?.id,
    institutionName: institution?.name,
    independent: !institution,
    conflicts: institution && !alreadyConflicted
      ? [...kept, { institutionId: institution.id, type: "institution" }]
      : kept,
  };
}

export function teamConflictIds(adjudicator: Adjudicator): string[] {
  return (adjudicator.conflicts ?? []).flatMap((conflict) => (conflict.teamId ? [conflict.teamId] : []));
}

/** Institutions the adjudicator is conflicted with apart from their own. */
export function extraInstitutionConflictIds(adjudicator: Adjudicator): string[] {
  return (adjudicator.conflicts ?? []).flatMap((conflict) =>
    conflict.institutionId && !conflict.teamId && !conflict.adjudicatorId &&
    conflict.institutionId !== adjudicator.institutionId
      ? [conflict.institutionId]
      : []
  );
}

/** Adjudicators in conflict with this one, whichever side declared it. */
export function adjudicatorConflictIds(adjudicator: Adjudicator, all: Adjudicator[]): string[] {
  const ids = new Set(
    (adjudicator.conflicts ?? []).flatMap((conflict) => (conflict.adjudicatorId ? [conflict.adjudicatorId] : []))
  );
  for (const other of all) {
    if (other.id !== adjudicator.id && (other.conflicts ?? []).some((conflict) => conflict.adjudicatorId === adjudicator.id)) {
      ids.add(other.id);
    }
  }
  ids.delete(adjudicator.id);
  return [...ids];
}

export interface ConflictSelection {
  teamIds: string[];
  adjudicatorIds: string[];
  institutionIds: string[];
}

/**
 * Applies the conflicts chosen in the editor. Returns every adjudicator that changed:
 * the edited one, plus others whose declaration of a removed adjudicator conflict had
 * to be dropped. New adjudicator conflicts are stored on the edited adjudicator.
 */
export function applyConflictSelection(
  edited: Adjudicator,
  selection: ConflictSelection,
  all: Adjudicator[]
): Adjudicator[] {
  const wantedAdjudicators = new Set(selection.adjudicatorIds.filter((id) => id !== edited.id));
  const declaredElsewhere = new Set(
    all
      .filter((other) => other.id !== edited.id && (other.conflicts ?? []).some((conflict) => conflict.adjudicatorId === edited.id))
      .map((other) => other.id)
  );

  const ownInstitution = (edited.conflicts ?? []).filter((conflict) =>
    isOwnInstitutionConflict(conflict, edited.institutionId)
  );
  const conflicts: AdjudicatorConflict[] = [
    ...ownInstitution,
    ...[...new Set(selection.institutionIds)]
      .filter((id) => id !== edited.institutionId)
      .map((institutionId): AdjudicatorConflict => ({ institutionId, type: "institution" })),
    ...[...new Set(selection.teamIds)].map((teamId): AdjudicatorConflict => ({ teamId, type: "personal" })),
    ...[...wantedAdjudicators]
      .filter((id) => !declaredElsewhere.has(id))
      .map((adjudicatorId): AdjudicatorConflict => ({ adjudicatorId, type: "personal" })),
  ];

  const changed: Adjudicator[] = [{ ...edited, conflicts }];
  for (const other of all) {
    if (other.id === edited.id || !declaredElsewhere.has(other.id) || wantedAdjudicators.has(other.id)) continue;
    changed.push({
      ...other,
      conflicts: (other.conflicts ?? []).filter((conflict) => conflict.adjudicatorId !== edited.id),
    });
  }
  return changed;
}
