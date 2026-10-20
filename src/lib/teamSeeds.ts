import type { TeamSeedMode } from "@/types";

/**
 * Team seeds as Tabbycat asks for them (`show_seed_in_importer`): "numeric" takes any whole
 * number (higher is stronger, as the seeded draw reads Team.seed); "title" offers Tabbycat's four
 * descriptive seeds, stored as the same numbers Tabbycat stores (Unseeded 0, Free 1, Half 2,
 * Full 3). "off" does not ask. Pure functions shared by the CSV import, the registration form
 * and its server-side validation.
 */

export const TEAM_SEED_MODES: readonly TeamSeedMode[] = ["off", "numeric", "title"];

/** Largest numeric seed accepted (keeps values readable and far from float limits). */
export const MAX_TEAM_SEED = 99_999;

export const SEED_TITLES = [
  { value: 0, label: "Unseeded" },
  { value: 1, label: "Free seed" },
  { value: 2, label: "Half seed" },
  { value: 3, label: "Full seed" },
] as const;

export type SeedTitleValue = (typeof SEED_TITLES)[number]["value"];

/** Spellings accepted for each title (case-insensitive, spaces/dashes/underscores ignored). */
const TITLE_ALIASES: Record<string, SeedTitleValue> = {
  unseeded: 0,
  none: 0,
  free: 1,
  freeseed: 1,
  half: 2,
  halfseed: 2,
  full: 3,
  fullseed: 3,
};

export function normalizeTeamSeedMode(value: unknown): TeamSeedMode {
  return TEAM_SEED_MODES.includes(value as TeamSeedMode) ? (value as TeamSeedMode) : "off";
}

/** The English title of a seed in title mode, or undefined when the value is not a title seed. */
export function seedTitle(seed: number | undefined): string | undefined {
  return SEED_TITLES.find((title) => title.value === seed)?.label;
}

export type SeedParseResult = { ok: true; seed: number | undefined } | { ok: false; error: string };

/**
 * Reads a seed cell or form value. Empty means "no seed" (undefined), never 0: a missing seed is
 * not the same as "Unseeded". Throws nothing; the caller reports the error with its context.
 */
export function parseTeamSeed(raw: unknown, mode: TeamSeedMode): SeedParseResult {
  if (raw === undefined || raw === null) return { ok: true, seed: undefined };
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : null;
  if (text === null) return { ok: false, error: "The seed must be a number or a seed title." };
  if (!text) return { ok: true, seed: undefined };
  if (mode === "off") return { ok: false, error: "Seeds are not being collected." };
  if (mode === "title") {
    const key = text.toLowerCase().replace(/[\s_-]+/g, "");
    if (key in TITLE_ALIASES) return { ok: true, seed: TITLE_ALIASES[key] };
    if (/^[0-3]$/.test(text)) return { ok: true, seed: Number(text) };
    return {
      ok: false,
      error: `"${text}" is not a seed title: use ${SEED_TITLES.map((title) => title.label).join(", ")} (or 0–3).`,
    };
  }
  if (!/^\d+$/.test(text) || Number(text) > MAX_TEAM_SEED) {
    return { ok: false, error: `"${text}" is not a valid seed: use a whole number from 0 to ${MAX_TEAM_SEED}.` };
  }
  return { ok: true, seed: Number(text) };
}
