import type {
  BreakCategory,
  Speaker,
  SpeakerCategory,
  SpeakerCategoryEligibilityRule,
  SpeakerStandingRow,
  Team,
} from "@/types";

/**
 * Speaker categories as entities (Tabbycat's SpeakerCategory). They live in
 * `preferences.speakerCategories`; speakers reference them by id in `Speaker.categories`.
 *
 * Older data stored free-text labels ("esl") there, and team-wide labels in
 * `Team.speakerCategories`. Nothing is rewritten on load: every reference is resolved by id,
 * slug or name, and labels that match no category show up as unsaved categories
 * (`effectiveSpeakerCategories`) until an organiser saves the category list.
 */

export interface SpeakerCategoryView extends SpeakerCategory {
  /** Derived from labels on speakers; not yet saved to the tournament. */
  unsaved?: boolean;
}

export function slugifyCategory(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const SPEAKER_CATEGORY_ID_PREFIX = "spkcat-";

/** Deterministic id for a category created from a label, so devices that migrate agree. */
export function speakerCategoryIdForSlug(slug: string): string {
  return `${SPEAKER_CATEGORY_ID_PREFIX}${slug}`;
}

/** Speakers (with their team) whose categories include the category. */
export function speakersInCategory(
  teams: Pick<Team, "speakers" | "speakerCategories">[],
  categoryId: string,
  categories: SpeakerCategory[]
): number {
  return teams.reduce(
    (count, team) =>
      count +
      team.speakers.filter((speaker) =>
        resolveSpeakerCategoryIds(speakerCategoryRefs(speaker, team), categories).includes(categoryId)
      ).length,
    0
  );
}

export function sortSpeakerCategories<T extends Pick<SpeakerCategory, "seq" | "name">>(categories: T[]): T[] {
  return [...categories].sort((left, right) => left.seq - right.seq || left.name.localeCompare(right.name));
}

/** Finds the category an entry in `Speaker.categories` refers to (id, then slug, then name). */
export function resolveSpeakerCategoryRef<T extends SpeakerCategory>(ref: string, categories: T[]): T | undefined {
  const key = ref.trim().toLowerCase();
  if (!key) return undefined;
  return (
    categories.find((category) => category.id.toLowerCase() === key) ??
    categories.find((category) => category.slug.toLowerCase() === key) ??
    categories.find((category) => category.name.trim().toLowerCase() === key) ??
    categories.find((category) => category.slug === slugifyCategory(key))
  );
}

/** The raw category references that apply to a speaker (their own, else the team-wide labels). */
export function speakerCategoryRefs(speaker: Pick<Speaker, "categories">, team?: Pick<Team, "speakerCategories">): string[] {
  // Mirrors standings/calculator: a speaker's own list, even an empty one, wins over the team's.
  return speaker.categories ?? team?.speakerCategories ?? [];
}

export function resolveSpeakerCategoryIds(refs: string[] | undefined, categories: SpeakerCategory[]): string[] {
  const ids: string[] = [];
  for (const ref of refs ?? []) {
    const match = resolveSpeakerCategoryRef(ref, categories);
    if (match && !ids.includes(match.id)) ids.push(match.id);
  }
  return ids;
}

export function speakerCategoryNames(refs: string[] | undefined, categories: SpeakerCategory[]): string[] {
  return sortSpeakerCategories(
    resolveSpeakerCategoryIds(refs, categories).flatMap((id) => categories.filter((category) => category.id === id))
  ).map((category) => category.name);
}

/**
 * Saved categories plus an unsaved one for every label on a speaker (or team) that matches
 * none of them. Labels are grouped by slug, so "ESL" and "esl" become one category.
 */
export function effectiveSpeakerCategories(
  stored: SpeakerCategory[] | undefined,
  teams: Pick<Team, "speakers" | "speakerCategories">[]
): SpeakerCategoryView[] {
  const result: SpeakerCategoryView[] = sortSpeakerCategories(stored ?? []);
  let nextSeq = Math.max(0, ...result.map((category) => category.seq)) + 1;
  const labels = teams.flatMap((team) => [
    ...(team.speakerCategories ?? []),
    ...team.speakers.flatMap((speaker) => speaker.categories ?? []),
  ]);
  for (const label of labels) {
    // A dangling id (its category was deleted elsewhere) is not a label to migrate.
    if (label.startsWith(SPEAKER_CATEGORY_ID_PREFIX) || resolveSpeakerCategoryRef(label, result)) continue;
    const slug = slugifyCategory(label);
    if (!slug) continue;
    result.push({
      id: speakerCategoryIdForSlug(slug),
      name: label.trim(),
      slug,
      seq: nextSeq++,
      public: false,
      unsaved: true,
    });
  }
  return result;
}

/** Strips view-only flags so the list can be stored in preferences. */
export function toStoredSpeakerCategories(categories: SpeakerCategoryView[]): SpeakerCategory[] {
  return categories.map((category) => {
    const stored: SpeakerCategory = {
      id: category.id,
      name: category.name.trim(),
      slug: category.slug,
      seq: category.seq,
      public: category.public,
    };
    if (category.limit && category.limit > 0) stored.limit = category.limit;
    return stored;
  });
}

export function newSpeakerCategory(name: string, existing: SpeakerCategory[], createId: () => string): SpeakerCategory {
  return {
    id: createId(),
    name: name.trim(),
    slug: slugifyCategory(name),
    seq: Math.max(0, ...existing.map((category) => category.seq)) + 1,
    public: false,
  };
}

/** Problems that stop a category list being saved: blank or duplicate names/slugs, bad limits. */
export function validateSpeakerCategories(categories: SpeakerCategory[]): string[] {
  const errors: string[] = [];
  const names = new Map<string, string>();
  const slugs = new Map<string, string>();
  for (const category of categories) {
    const name = category.name.trim();
    if (!name) {
      errors.push("Every speaker category needs a name.");
      continue;
    }
    if (!category.slug) errors.push(`"${name}" needs a slug (letters or digits).`);
    const nameKey = name.toLowerCase();
    if (names.has(nameKey)) errors.push(`Two categories are called "${name}".`);
    names.set(nameKey, category.id);
    if (category.slug && slugs.has(category.slug)) {
      errors.push(`"${name}" and "${slugs.get(category.slug)}" have the same slug "${category.slug}".`);
    }
    slugs.set(category.slug, name);
    if (category.limit !== undefined && (!Number.isInteger(category.limit) || category.limit < 0)) {
      errors.push(`The public limit for "${name}" must be a whole number of at least 0.`);
    }
  }
  return errors;
}

/** Speakers in a category, ranked within it. Equal overall ranks stay tied; unranked rows stay unranked. */
export function speakerRowsInCategory(
  rows: SpeakerStandingRow[],
  categoryId: string,
  categories: SpeakerCategory[],
  limit?: number
): SpeakerStandingRow[] {
  const inCategory = rows.filter((row) => resolveSpeakerCategoryIds(row.categories, categories).includes(categoryId));
  let position = 0;
  let previous: SpeakerStandingRow | undefined;
  let previousRank = 0;
  const ranked = inCategory.map((row) => {
    if (row.ineligible) return { ...row, rank: 0 };
    position += 1;
    const rank = previous && previous.rank === row.rank ? previousRank : position;
    previous = row;
    previousRank = rank;
    return { ...row, rank };
  });
  if (!limit || limit <= 0) return ranked;
  return ranked.filter((row) => !row.ineligible && row.rank <= limit);
}

export function describeEligibilityRule(rule: SpeakerCategoryEligibilityRule, categories: SpeakerCategory[]): string {
  const category = categories.find((item) => item.id === rule.speakerCategoryId);
  const name = category?.name ?? "an unknown category";
  return rule.minimumSpeakers
    ? `at least ${rule.minimumSpeakers} speaker${rule.minimumSpeakers === 1 ? "" : "s"} in ${name}`
    : `every speaker in ${name}`;
}

/** Whether a team meets a break category's speaker-category rule. A team without speakers never does. */
export function teamMeetsEligibilityRule(
  team: Pick<Team, "speakers" | "speakerCategories">,
  rule: SpeakerCategoryEligibilityRule,
  categories: SpeakerCategory[]
): boolean {
  if (team.speakers.length === 0) return false;
  const inCategory = team.speakers.filter((speaker) =>
    resolveSpeakerCategoryIds(speakerCategoryRefs(speaker, team), categories).includes(rule.speakerCategoryId)
  ).length;
  return rule.minimumSpeakers ? inCategory >= rule.minimumSpeakers : inCategory === team.speakers.length;
}

export interface EligibilityChange {
  teamsToAdd: Team[];
  teamsToRemove: Team[];
  /** Teams with their new `breakCategories`, ready to save. */
  updated: Team[];
}

/**
 * What applying a break category's speaker-category rule would change: teams that meet it
 * become eligible and teams that do not lose eligibility. General categories and categories
 * without a rule change nothing.
 */
export function planEligibilityFromSpeakerCategories(
  teams: Team[],
  breakCategory: BreakCategory,
  categories: SpeakerCategory[]
): EligibilityChange {
  const rule = breakCategory.speakerCategoryRule;
  const change: EligibilityChange = { teamsToAdd: [], teamsToRemove: [], updated: [] };
  if (!rule || breakCategory.isGeneral) return change;
  for (const team of teams) {
    const eligible = (team.breakCategories ?? []).includes(breakCategory.id);
    const meets = teamMeetsEligibilityRule(team, rule, categories);
    if (meets && !eligible) {
      change.teamsToAdd.push(team);
      change.updated.push({ ...team, breakCategories: [...(team.breakCategories ?? []), breakCategory.id] });
    } else if (!meets && eligible) {
      change.teamsToRemove.push(team);
      change.updated.push({
        ...team,
        breakCategories: (team.breakCategories ?? []).filter((id) => id !== breakCategory.id),
      });
    }
  }
  return change;
}

/**
 * Resolves category names from an import to references to store. Known names become ids;
 * unknown names are returned so the caller can create them (or report them).
 */
export function resolveSpeakerCategoryNamesForImport(
  names: string[],
  categories: SpeakerCategory[]
): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const match = resolveSpeakerCategoryRef(name, categories);
    if (match) {
      if (!ids.includes(match.id)) ids.push(match.id);
    } else if (!unknown.some((item) => slugifyCategory(item) === slugifyCategory(name))) {
      unknown.push(name.trim());
    }
  }
  return { ids, unknown };
}
