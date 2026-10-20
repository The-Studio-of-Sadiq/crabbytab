/**
 * Team-name and code-name generators (Tabbycat `team_name_generator` / `code_name_generator`;
 * docs/registration.md, "Names"). Pure and deterministic: the same teams in, the same names out.
 */

export type TeamNameGenerator = "user" | "alphabetical" | "numerical" | "initials";
export type CodeNameGenerator = "user" | "emoji" | "last_names";

export const TEAM_NAME_GENERATORS: TeamNameGenerator[] = ["user", "alphabetical", "numerical", "initials"];
export const CODE_NAME_GENERATORS: CodeNameGenerator[] = ["user", "emoji", "last_names"];

/** Tabbycat's emoji set is larger; these are distinct, widely supported and name-like. */
export const CODE_NAME_EMOJI = [
  "🐙", "🦊", "🐢", "🦉", "🐝", "🦄", "🐬", "🦁", "🐧", "🦜", "🐳", "🦋", "🐸", "🦒", "🦓", "🐨",
  "🐼", "🦔", "🦦", "🦩", "🐌", "🦀", "🐞", "🦕", "🌵", "🌻", "🍄", "🌈", "⚡", "🔥", "🌙", "⭐",
  "🍉", "🍋", "🍒", "🥑", "🎈", "🎲", "🎯", "🎺", "🚀", "⛵", "🏔", "🗿", "🧭", "🔔", "💎", "🧩",
];

function letters(index: number): string {
  // 0 → A, 25 → Z, 26 → AA …
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/**
 * The name for a new team. `existingNames` are the institution's (or, for independents, every)
 * current team names, so "alphabetical" and "numerical" pick the first free label. A "user" name,
 * or a generated name when there is nothing to generate from, returns `submittedName`.
 */
export function generateTeamName(input: {
  generator: TeamNameGenerator | undefined;
  submittedName: string;
  institutionName?: string;
  speakerNames: string[];
  existingNames: string[];
}): string {
  const prefix = input.institutionName?.trim() ?? "";
  const taken = new Set(input.existingNames.map((name) => name.trim().toLowerCase()));
  const named = (label: string) => (prefix ? `${prefix} ${label}` : `Team ${label}`);
  const firstFree = (label: (index: number) => string) => {
    for (let index = 0; index < 10_000; index += 1) {
      const candidate = named(label(index));
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return input.submittedName;
  };
  switch (input.generator) {
    case "alphabetical":
      return firstFree(letters);
    case "numerical":
      return firstFree((index) => String(index + 1));
    case "initials": {
      const initials = input.speakerNames.map((name) => lastName(name).charAt(0).toUpperCase()).filter(Boolean).join("");
      if (!initials) return input.submittedName;
      const base = named(initials);
      if (!taken.has(base.toLowerCase())) return base;
      return firstFree((index) => `${initials}${index + 2}`);
    }
    default:
      return input.submittedName;
  }
}

/** A code name for a new team, or undefined for "user" (left to the organiser). */
export function generateCodeName(input: {
  generator: CodeNameGenerator | undefined;
  speakerNames: string[];
  existingCodeNames: string[];
}): string | undefined {
  const taken = new Set(input.existingCodeNames);
  if (input.generator === "emoji") {
    const free = CODE_NAME_EMOJI.find((emoji) => !taken.has(emoji));
    if (free) return free;
    // Every single emoji is used: pair them.
    for (const first of CODE_NAME_EMOJI) {
      for (const second of CODE_NAME_EMOJI) if (!taken.has(`${first}${second}`)) return `${first}${second}`;
    }
    return undefined;
  }
  if (input.generator === "last_names") {
    const names = input.speakerNames.map(lastName).filter(Boolean);
    if (names.length === 0) return undefined;
    const base = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
    if (!taken.has(base)) return base;
    for (let index = 2; index < 1_000; index += 1) if (!taken.has(`${base} ${index}`)) return `${base} ${index}`;
  }
  return undefined;
}

/**
 * Applies the tournament's generators to a team built from a registration: the name (unless
 * "user") among the institution's existing teams, and a code name (unless "user") unique in the
 * tournament.
 */
export function applyNameGenerators<T extends { name: string; codeName?: string; institutionId?: string; speakers: Array<{ name: string }> }>(
  team: T,
  context: {
    settings: { teamNameGenerator?: TeamNameGenerator; codeNameGenerator?: CodeNameGenerator };
    institutionName?: string;
    teams: Array<{ name: string; codeName?: string; institutionId?: string; institutionName?: string }>;
  }
): T {
  const speakerNames = team.speakers.map((speaker) => speaker.name);
  const sameInstitution = context.teams.filter((existing) =>
    team.institutionId ? existing.institutionId === team.institutionId : (existing.institutionName ?? "") === (context.institutionName ?? "")
  );
  const name = generateTeamName({
    generator: context.settings.teamNameGenerator,
    submittedName: team.name,
    institutionName: context.institutionName,
    speakerNames,
    existingNames: context.teams.map((existing) => existing.name).concat(sameInstitution.map((existing) => existing.name)),
  });
  const codeName = generateCodeName({
    generator: context.settings.codeNameGenerator,
    speakerNames,
    existingCodeNames: context.teams.map((existing) => existing.codeName).filter((value): value is string => Boolean(value)),
  });
  return { ...team, name, ...(codeName && !team.codeName ? { codeName } : {}) };
}
