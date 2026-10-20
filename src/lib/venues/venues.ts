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

export function venueInCategory(venue: Pick<Venue, "category">, category: string): boolean {
  const wanted = normaliseCategory(category);
  return wanted !== "" && normaliseCategory(venue.category) === wanted;
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
  venue: Pick<Venue, "category">,
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

/** The room's name with its category as prefix or suffix, as configured (Tabbycat display_name). */
export function venueDisplayName(
  venue: Pick<Venue, "name" | "category">,
  categories: VenueCategoryInfo[] | undefined
): string {
  const info = venueCategoryInfo(categories, venue.category);
  if (!info || !venue.category?.trim()) return venue.name;
  if (info.displayInName === "prefix") return `${venue.category.trim()} ${venue.name}`;
  if (info.displayInName === "suffix") return `${venue.name} ${venue.category.trim()}`;
  return venue.name;
}

/**
 * Tooltip text for a room ("This room has step-free access."). On public pages only categories
 * marked for the public tooltip are described; admin pages always describe them.
 */
export function venueTooltip(
  venue: Pick<Venue, "category">,
  categories: VenueCategoryInfo[] | undefined,
  audience: "admin" | "public"
): string | undefined {
  const info = venueCategoryInfo(categories, venue.category);
  const description = info?.description?.trim();
  if (!description || (audience === "public" && !info?.publicTooltip)) return undefined;
  return `This room ${description.replace(/[.\s]+$/, "")}.`;
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
