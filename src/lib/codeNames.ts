import type { Team, TeamCodeNameMode } from "@/types";
import { shuffle as shuffled, type Rng } from "@/lib/draw/rng";

/**
 * Team emoji and code-name generators (Tabbycat `code_name_generator`: "emoji" or "last_names").
 * Pure and driven by an explicit random source, so a given seed always gives the same names.
 * Only teams without one are given a code name or emoji; existing choices are never overwritten.
 */

/** Emoji with the name used as an emoji code name; distinct names, so code names are unique. */
export const TEAM_EMOJI: ReadonlyArray<readonly [string, string]> = [
  ["🦊", "Fox"], ["🐻", "Bear"], ["🐼", "Panda"], ["🐨", "Koala"], ["🐯", "Tiger"], ["🦁", "Lion"],
  ["🐮", "Cow"], ["🐷", "Pig"], ["🐸", "Frog"], ["🐵", "Monkey"], ["🐔", "Chicken"], ["🐧", "Penguin"],
  ["🐦", "Bird"], ["🦆", "Duck"], ["🦅", "Eagle"], ["🦉", "Owl"], ["🦇", "Bat"], ["🐺", "Wolf"],
  ["🐗", "Boar"], ["🐴", "Horse"], ["🦄", "Unicorn"], ["🐝", "Bee"], ["🐛", "Caterpillar"], ["🦋", "Butterfly"],
  ["🐌", "Snail"], ["🐞", "Ladybird"], ["🐢", "Turtle"], ["🐍", "Snake"], ["🦎", "Lizard"], ["🦖", "T-Rex"],
  ["🦕", "Sauropod"], ["🐙", "Octopus"], ["🦑", "Squid"], ["🦐", "Shrimp"], ["🦀", "Crab"], ["🐡", "Blowfish"],
  ["🐠", "Tropical Fish"], ["🐬", "Dolphin"], ["🐳", "Whale"], ["🦈", "Shark"], ["🐊", "Crocodile"], ["🐅", "Leopard"],
  ["🦓", "Zebra"], ["🦍", "Gorilla"], ["🐘", "Elephant"], ["🦛", "Hippo"], ["🦏", "Rhino"], ["🐪", "Camel"],
  ["🦒", "Giraffe"], ["🦘", "Kangaroo"], ["🐃", "Buffalo"], ["🐏", "Ram"], ["🦙", "Llama"], ["🐐", "Goat"],
  ["🦌", "Deer"], ["🐕", "Dog"], ["🐈", "Cat"], ["🐓", "Rooster"], ["🦃", "Turkey"], ["🦚", "Peacock"],
  ["🦜", "Parrot"], ["🦢", "Swan"], ["🦩", "Flamingo"], ["🐇", "Rabbit"], ["🦝", "Raccoon"], ["🦨", "Skunk"],
  ["🦡", "Badger"], ["🦦", "Otter"], ["🦥", "Sloth"], ["🐁", "Mouse"], ["🐿️", "Chipmunk"], ["🦔", "Hedgehog"],
  ["🌵", "Cactus"], ["🌲", "Evergreen"], ["🌴", "Palm"], ["🍀", "Clover"], ["🍁", "Maple"], ["🍄", "Mushroom"],
  ["🌻", "Sunflower"], ["🌹", "Rose"], ["🌷", "Tulip"], ["🌙", "Moon"], ["⭐", "Star"], ["🔥", "Fire"],
  ["🌈", "Rainbow"], ["⚡", "Lightning"], ["❄️", "Snowflake"], ["🌊", "Wave"], ["🍎", "Apple"], ["🍋", "Lemon"],
  ["🍉", "Watermelon"], ["🍇", "Grapes"], ["🍓", "Strawberry"], ["🍒", "Cherries"], ["🍑", "Peach"], ["🍍", "Pineapple"],
  ["🥥", "Coconut"], ["🥑", "Avocado"], ["🌽", "Corn"], ["🥕", "Carrot"], ["🧀", "Cheese"], ["🍩", "Doughnut"],
  ["🚀", "Rocket"], ["⛵", "Sailboat"], ["🚲", "Bicycle"], ["🎈", "Balloon"], ["🎲", "Dice"], ["🎸", "Guitar"],
  ["🎺", "Trumpet"], ["🥁", "Drum"], ["🔭", "Telescope"], ["🧭", "Compass"], ["⚓", "Anchor"], ["💎", "Gem"],
];

export type CodeNameMethod = "emoji" | "last_names";

/** A code name that is just the team's own name (what older versions stored) counts as none. */
export function hasCodeName(team: Pick<Team, "name" | "codeName">): boolean {
  const code = team.codeName?.trim();
  return Boolean(code) && code !== team.name.trim();
}

/** Teams in a stable order (by id), so the result depends only on the data and the random source. */
function stableOrder<T extends Pick<Team, "id">>(teams: T[]): T[] {
  return [...teams].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Gives every team without an emoji an unused one. When the pool runs out, emoji are reused
 * (Tabbycat does the same), so the result is never short.
 */
export function assignTeamEmoji(teams: Team[], random: Rng): Team[] {
  const used = new Set(teams.map((team) => team.emoji).filter(Boolean));
  const free = shuffled(TEAM_EMOJI.filter(([emoji]) => !used.has(emoji)), random);
  const reuse = shuffled(TEAM_EMOJI, random);
  let next = 0;
  return stableOrder(teams)
    .filter((team) => !team.emoji)
    .map((team) => {
      const pick = next < free.length ? free[next] : reuse[(next - free.length) % reuse.length];
      next += 1;
      return { ...team, emoji: pick[0] };
    });
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** "Jones & Smith" from the speakers' last names (stored `lastName`, else the last word of the name), as Tabbycat's last-names standard. */
export function lastNamesCodeName(team: Pick<Team, "speakers">): string {
  const names = (team.speakers ?? []).map((speaker) => speaker.lastName?.trim() || lastName(speaker.name)).filter(Boolean);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/**
 * Code names for teams that have none. "emoji" names a team after its emoji (assigning one first
 * if needed); "last_names" joins the speakers' last names. Duplicates get " 2", " 3", ... so every
 * code name is unique. Returns only the teams that changed.
 */
export function generateTeamCodeNames(teams: Team[], method: CodeNameMethod, random: Rng): Team[] {
  const emojiAssigned = new Map(assignTeamEmoji(teams, random).map((team) => [team.id, team.emoji]));
  const emojiName = new Map(TEAM_EMOJI.map(([emoji, name]) => [emoji, name]));
  const taken = new Set(teams.filter(hasCodeName).map((team) => team.codeName!.trim().toLowerCase()));
  const unique = (base: string) => {
    let candidate = base;
    for (let suffix = 2; taken.has(candidate.toLowerCase()); suffix += 1) candidate = `${base} ${suffix}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  };
  return stableOrder(teams)
    .filter((team) => !hasCodeName(team))
    .flatMap((team) => {
      if (method === "emoji") {
        const emoji = team.emoji || emojiAssigned.get(team.id);
        const base = (emoji && emojiName.get(emoji)) || emoji;
        return base ? [{ ...team, ...(team.emoji ? {} : { emoji }), codeName: unique(base) }] : [];
      }
      const base = lastNamesCodeName(team);
      return base ? [{ ...team, codeName: unique(base) }] : [];
    });
}

/** A team name as the tab room shows it, with the other name for a tooltip when the mode adds one. */
export interface TabroomTeamName {
  name: string;
  tooltip?: { kind: "code" | "real"; name: string };
}

/**
 * Team names on tab-room pages under Tabbycat's `team_code_names` (TabbycatTableBuilder for admins):
 * - "all-tooltips" / "admin-tooltips-code": the real name, the code name in a tooltip;
 * - "admin-tooltips-real": the code name, the real name in a tooltip;
 * - "off" / "everywhere": the real name only. (Tabbycat also shows code names to admins under
 *   "everywhere"; CrabbyTab keeps real names in the tab room for that mode.)
 * A team without a code name always shows its real name with no tooltip.
 */
export function tabroomTeamName(
  team: Pick<Team, "name" | "codeName"> | undefined,
  storedName: string | undefined,
  mode: TeamCodeNameMode
): TabroomTeamName {
  const real = storedName || team?.name || "";
  if (!team || !hasCodeName(team)) return { name: real };
  const code = team.codeName!.trim();
  if (mode === "all-tooltips" || mode === "admin-tooltips-code") return { name: real, tooltip: { kind: "code", name: code } };
  if (mode === "admin-tooltips-real") return { name: code, tooltip: { kind: "real", name: real } };
  return { name: real };
}

/**
 * The team without a code name that is only a (current or previous) real name. Older versions
 * stored the team name as its code name; after a rename that old name would no longer match the
 * team name and would be published as if it were a code name, so it is cleared instead.
 */
export function withoutRealNameCodeName<T extends Pick<Team, "name" | "codeName">>(team: T, previousName?: string): T {
  const code = team.codeName?.trim();
  if (code === undefined) return team;
  const realNames = [team.name, previousName].map((name) => name?.trim()).filter(Boolean);
  if (code !== "" && !realNames.includes(code)) return team;
  return { ...team, codeName: undefined };
}
