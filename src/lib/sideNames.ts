import type { DebateSide, SideNames, TournamentPreferences } from "@/types";

/**
 * What each side is called (Tabbycat's `side_names` and `get_side_name`). Every user-facing side
 * label goes through `sideLabel`, so the tournament's choice (Gov/Opp, Prop/Opp, ...) shows the
 * same everywhere. Stored data keeps the internal codes AFF/NEG and OG/OO/CG/CO.
 */

export type SideLabelKind = "abbr" | "full" | "team";

interface SideNameSet {
  label: string;
  full: [string, string];
  team: [string, string];
  abbr: [string, string];
}

export const SIDE_NAME_SETS: Record<SideNames, SideNameSet> = {
  "aff-neg": { label: "Affirmative, Negative", full: ["Affirmative", "Negative"], team: ["Affirmative team", "Negative team"], abbr: ["Aff", "Neg"] },
  "gov-opp": { label: "Government, Opposition", full: ["Government", "Opposition"], team: ["Government team", "Opposition team"], abbr: ["Gov", "Opp"] },
  "prop-opp": { label: "Proposition, Opposition", full: ["Proposition", "Opposition"], team: ["Proposition team", "Opposition team"], abbr: ["Prop", "Opp"] },
  "pro-con": { label: "Pro, Con", full: ["Pro", "Con"], team: ["Pro team", "Con team"], abbr: ["Pro", "Con"] },
  "appellant-respondent": { label: "Appellant, Respondent", full: ["Appellant", "Respondent"], team: ["Appellant team", "Respondent team"], abbr: ["App", "Res"] },
  // Tabbycat abbreviates these to a bare "1"/"2"; "Team 1" reads better next to scores.
  "1-2": { label: "Team 1, Team 2", full: ["Team 1", "Team 2"], team: ["1st team", "2nd team"], abbr: ["Team 1", "Team 2"] },
  "pl-def": { label: "Plaintiff/Prosecution, Defense", full: ["Plaintiff/Prosecution", "Defense"], team: ["Plaintiff/prosecution team", "Defense team"], abbr: ["Pl", "Def"] },
};

export const SIDE_NAME_OPTIONS = Object.keys(SIDE_NAME_SETS) as SideNames[];

const BP_NAMES: Record<string, Record<SideLabelKind, string>> = {
  OG: { abbr: "OG", full: "Opening Government", team: "Opening government team" },
  OO: { abbr: "OO", full: "Opening Opposition", team: "Opening opposition team" },
  CG: { abbr: "CG", full: "Closing Government", team: "Closing government team" },
  CO: { abbr: "CO", full: "Closing Opposition", team: "Closing opposition team" },
};

export function sideNamesFor(preferences: Partial<Pick<TournamentPreferences, "sideNames">> | undefined): SideNames {
  const value = preferences?.sideNames;
  return value && value in SIDE_NAME_SETS ? value : "aff-neg";
}

/** The name of `side` in this tournament. BP positions are not renamed, as in Tabbycat. */
export function sideLabel(
  side: DebateSide | string,
  preferences?: Partial<Pick<TournamentPreferences, "sideNames">>,
  kind: SideLabelKind = "abbr"
): string {
  if (side in BP_NAMES) return BP_NAMES[side][kind];
  if (side !== "AFF" && side !== "NEG") return String(side);
  return SIDE_NAME_SETS[sideNamesFor(preferences)][kind][side === "AFF" ? 0 : 1];
}

/**
 * Full side name for translated pages: the default Affirmative/Negative (and BP positions) use the
 * page's `side.*` messages; other side names are not translated yet and use the English names.
 */
export function translatedSideName(
  t: (key: `side.${DebateSide}`) => string,
  side: DebateSide,
  preferences?: Partial<Pick<TournamentPreferences, "sideNames">>
): string {
  if (side in BP_NAMES || sideNamesFor(preferences) === "aff-neg") return t(`side.${side}`);
  return sideLabel(side, preferences, "full");
}
