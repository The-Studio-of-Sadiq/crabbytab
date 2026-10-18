import type { BreakCategory } from "@/types";

/**
 * Parses a free-text category list ("ESL, novice; esl") into normalised,
 * de-duplicated lowercase labels, in first-seen order.
 */
export function parseCategoryList(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,;|]/)) {
    const label = part.trim().replace(/\s+/g, " ").toLowerCase();
    if (label) seen.add(label);
  }
  return [...seen];
}

export function formatCategoryList(categories: string[] | undefined): string {
  return (categories ?? []).join(", ");
}

/**
 * Resolves break-category references (id, slug or name, case-insensitive) to
 * category ids. Unknown references are returned separately so callers can
 * report them instead of silently dropping eligibility.
 */
export function resolveBreakCategoryRefs(
  refs: string[],
  categories: BreakCategory[]
): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const ref of refs) {
    const key = ref.trim().toLowerCase();
    if (!key) continue;
    const match = categories.find(
      (category) =>
        category.id.toLowerCase() === key ||
        category.slug.toLowerCase() === key ||
        category.name.trim().toLowerCase() === key
    );
    if (!match) unknown.push(ref.trim());
    else if (!ids.includes(match.id)) ids.push(match.id);
  }
  return { ids, unknown };
}

/** Categories a team can be marked eligible for: general categories include every team. */
export function selectableBreakCategories(categories: BreakCategory[]): BreakCategory[] {
  return categories
    .filter((category) => !category.isGeneral)
    .sort((left, right) => (right.priority || 0) - (left.priority || 0) || left.seq - right.seq);
}
