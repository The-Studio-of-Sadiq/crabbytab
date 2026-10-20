/**
 * Room (venue) rules shared by the draw, allocation, check-ins and displays: per-round
 * availability, check-in expiry, soft ranked constraints, category display names and room links.
 */
import type {
  Adjudicator,
  Debate,
  Institution,
  Team,
  Venue,
  VenueCategoryInfo,
  VenueConstraint,
} from "@/types";

// ─── Availability and check-in ──────────────────────────────────────

/** A room is available in a round unless that round's entry (or, without one, its default) says no. */
export function isVenueAvailableForRound(venue: Pick<Venue, "available" | "roundAvailability">, roundId?: string): boolean {
  const roundValue = roundId ? venue.roundAvailability?.[roundId] : undefined;
  return (roundValue ?? venue.available) !== false;
}

export function setVenueRoundAvailability<T extends Pick<Venue, "roundAvailability">>(
  venue: T,
  roundId: string,
  available: boolean
): T {
  return { ...venue, roundAvailability: { ...venue.roundAvailability, [roundId]: available } };
}

/**
 * Whether a room counts as checked in now. `checkedIn` false is never checked in; with an expiry
 * window (Tabbycat checkin_window_venues) a check-in older than the window has lapsed. Rooms
 * checked in before check-in times were recorded stay checked in.
 */
export function isVenueCheckedIn(
  venue: Pick<Venue, "checkedIn" | "checkedInAt">,
  expiresAfterHours?: number,
  now = Date.now()
): boolean {
  if (venue.checkedIn === false) return false;
  if (!venue.checkedInAt || !expiresAfterHours || !Number.isFinite(expiresAfterHours) || expiresAfterHours <= 0) {
    return true;
  }
  const at = Date.parse(venue.checkedInAt);
  if (!Number.isFinite(at)) return false;
  return now - at < expiresAfterHours * 60 * 60 * 1000;
}

// ─── Soft ranked constraints ────────────────────────────────────────

export interface VenueConstraintContext {
  teams?: Team[];
  adjudicators?: Adjudicator[];
  institutions?: Institution[];
}

export interface ApplicableVenueConstraint extends VenueConstraint {
  subjectKind: "team" | "adjudicator" | "institution";
  subjectId: string;
  subjectName: string;
}

export function normaliseCategory(name: string | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

type CategorisedVenue = Pick<Venue, "category" | "categories">;

/**
 * Every category a room belongs to (Tabbycat VenueCategory is many-to-many): the `categories` list
 * plus the older single `category` field, which older data and clients still write. Trimmed,
 * de-duplicated ignoring case, in stored order with `category` first.
 */
export function venueCategoryNames(venue: Partial<CategorisedVenue>): string[] {
  const byKey = new Map<string, string>();
  for (const name of [venue.category, ...(Array.isArray(venue.categories) ? venue.categories : [])]) {
    if (typeof name !== "string") continue;
    const trimmed = name.trim();
    const key = normaliseCategory(trimmed);
    if (key && !byKey.has(key)) byKey.set(key, trimmed);
  }
  return [...byKey.values()];
}

/**
 * The room with these categories: `category` keeps the first (so older readers still see one) and
 * `categories` the full list; with at most one category, `categories` is cleared (set undefined, so
 * a merge-style save also drops a stale list).
 */
export function withVenueCategories<T extends object>(venue: T, names: string[]): T & Partial<CategorisedVenue> {
  const list = venueCategoryNames({ categories: names });
  return { ...venue, category: list[0], categories: list.length > 1 ? list : undefined };
}

/** Splits "Accessible, Large" into category names. */
export function parseVenueCategoryList(text: string): string[] {
  return venueCategoryNames({ categories: text.split(/[,;]/) });
}

export function venueInCategory(venue: Partial<CategorisedVenue>, category: string): boolean {
  const wanted = normaliseCategory(category);
  return wanted !== "" && venueCategoryNames(venue).some((name) => normaliseCategory(name) === wanted);
}

export function validVenueConstraints(constraints: VenueConstraint[] | undefined): VenueConstraint[] {
  return (constraints ?? []).filter(
    (constraint) => normaliseCategory(constraint.category) !== "" && Number.isFinite(constraint.priority)
  );
}

/** Lookup maps for constraint collection, built once per draw. */
export function constraintLookup(context: VenueConstraintContext) {
  return {
    teams: new Map((context.teams ?? []).map((team) => [team.id, team])),
    adjudicators: new Map((context.adjudicators ?? []).map((adjudicator) => [adjudicator.id, adjudicator])),
    institutions: new Map((context.institutions ?? []).map((institution) => [institution.id, institution])),
  };
}

export type ConstraintLookup = ReturnType<typeof constraintLookup>;

/**
 * Constraints on a debate (Tabbycat collect_constraints): those of its teams, its adjudicators and
 * its teams' institutions, highest priority first (ties keep that subject order).
 */
export function debateVenueConstraints(debate: Debate, lookup: ConstraintLookup): ApplicableVenueConstraint[] {
  const result: ApplicableVenueConstraint[] = [];
  const add = (
    constraints: VenueConstraint[] | undefined,
    subjectKind: ApplicableVenueConstraint["subjectKind"],
    subjectId: string,
    subjectName: string
  ) => {
    for (const constraint of validVenueConstraints(constraints)) {
      result.push({ ...constraint, subjectKind, subjectId, subjectName });
    }
  };
  const teams = Object.values(debate.teams ?? {})
    .map((slot) => (slot?.teamId ? lookup.teams.get(slot.teamId) : undefined))
    .filter((team): team is Team => team !== undefined);
  for (const team of teams) add(team.venueConstraints, "team", team.id, team.name);
  const adjudicatorIds = [
    debate.adjudicators?.chairId,
    ...(debate.adjudicators?.panellistIds ?? []),
    ...(debate.adjudicators?.traineeIds ?? []),
  ].filter((id): id is string => Boolean(id));
  for (const id of adjudicatorIds) {
    const adjudicator = lookup.adjudicators.get(id);
    if (adjudicator) add(adjudicator.venueConstraints, "adjudicator", adjudicator.id, adjudicator.name);
  }
  const seenInstitutions = new Set<string>();
  for (const team of teams) {
    if (!team.institutionId || seenInstitutions.has(team.institutionId)) continue;
    seenInstitutions.add(team.institutionId);
    const institution = lookup.institutions.get(team.institutionId);
    if (institution) add(institution.venueConstraints, "institution", institution.id, institution.name);
  }
  return result.sort((a, b) => b.priority - a.priority);
}

/** Constraints of the debate its room does not meet. */
export function unmetVenueConstraints(
  debate: Debate,
  venue: Partial<CategorisedVenue>,
  lookup: ConstraintLookup
): ApplicableVenueConstraint[] {
  return debateVenueConstraints(debate, lookup).filter((constraint) => !venueInCategory(venue, constraint.category));
}

// ─── Display ────────────────────────────────────────────────────────

export function venueCategoryInfo(
  categories: VenueCategoryInfo[] | undefined,
  name: string | undefined
): VenueCategoryInfo | undefined {
  const wanted = normaliseCategory(name);
  if (!wanted) return undefined;
  return (categories ?? []).find((category) => normaliseCategory(category.name) === wanted);
}

/** The room's name with its categories as prefix or suffix, as configured (Tabbycat display_name). */
export function venueDisplayName(
  venue: Pick<Venue, "name"> & Partial<CategorisedVenue>,
  categories: VenueCategoryInfo[] | undefined
): string {
  const prefixes: string[] = [];
  const suffixes: string[] = [];
  for (const name of venueCategoryNames(venue)) {
    const info = venueCategoryInfo(categories, name);
    if (info?.displayInName === "prefix") prefixes.push(name);
    else if (info?.displayInName === "suffix") suffixes.push(name);
  }
  return [...prefixes, venue.name, ...suffixes].join(" ");
}

/**
 * Tooltip text for a room ("This room has step-free access."), one sentence per category with a
 * description. On public pages only categories marked for the public tooltip are described; admin
 * pages always describe them.
 */
export function venueTooltip(
  venue: Partial<CategorisedVenue>,
  categories: VenueCategoryInfo[] | undefined,
  audience: "admin" | "public"
): string | undefined {
  const sentences = venueCategoryNames(venue).flatMap((name) => {
    const info = venueCategoryInfo(categories, name);
    const description = info?.description?.trim();
    if (!description || (audience === "public" && !info?.publicTooltip)) return [];
    return [`This room ${description.replace(/[.\s]+$/, "")}.`];
  });
  return sentences.length > 0 ? sentences.join(" ") : undefined;
}

/**
 * The room link if it is a safe http(s) URL, else undefined. Imported or typed links are
 * untrusted: anything else (javascript:, data:, relative paths) is never rendered as a link.
 */
export function safeVenueUrl(url: string | undefined): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
