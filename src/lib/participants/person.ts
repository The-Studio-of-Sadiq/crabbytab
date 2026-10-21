import type { Adjudicator, Speaker } from "@/types";

/**
 * A name with its pronoun pre-printed, as Tabbycat offers on printed ballots ("Alex Kim (they/them)").
 * Without a pronoun the name is returned unchanged.
 */
export function nameWithPronoun(person: Pick<Speaker | Adjudicator, "name" | "pronoun">, name = person.name): string {
  const pronoun = person.pronoun?.trim();
  return pronoun ? `${name} (${pronoun})` : name;
}

/** The stored last name, else the last word of the name (Tabbycat Person.last_name fallback). */
export function personLastName(person: Pick<Speaker | Adjudicator, "name" | "lastName">): string {
  const stored = person.lastName?.trim();
  if (stored) return stored;
  const parts = person.name.trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
