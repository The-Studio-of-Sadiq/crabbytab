import { hashValue, stableStringify } from "@/lib/publicView/hash";
import {
  buildPublicCheckinsSource,
  buildPublicProjection,
  PUBLIC_COLLECTION_NAMES,
  type PublicCheckinsSource,
  type PublicCollectionName,
  type PublicProjection,
  type PublicSourceData,
  type SourceRecord,
} from "@/lib/publicView/projection";
import { isAvailableForRound } from "@/lib/roundAvailability";
import type { PublicDerived, PublicTabs } from "@/lib/publicView/derived";
import type { Tournament } from "@/types";
import { buildPublicMotionSummary, type PublicMotionSummary } from "@/lib/motions/publicSummary";

/**
 * Sections are stored as separate chunked documents so no single Firestore document approaches the
 * 1 MiB limit, and so an unchanged section is neither rewritten nor re-downloaded. Debates and
 * ballots are split by round (`round-{roundId}`): for a 1000-team tournament the whole projection
 * is ~4 MB (ballots ~2.5 MB), over Vercel's 2 MB Data Cache entry limit, while one round's section
 * is a few hundred KB. Base sections hold everything else.
 */
export const PUBLIC_BASE_SECTIONS = [
  "tournament",
  "rounds",
  "teams",
  "adjudicators",
  "venues",
  "motions",
  "breakCategories",
  "institutions",
  "checkins",
  "tabs",
  "derived",
] as const;
export type PublicBaseSection = (typeof PUBLIC_BASE_SECTIONS)[number];
export type PublicRoundSection = `round-${string}`;
export type PublicViewSection = PublicBaseSection | PublicRoundSection;
/** Base sections of the participant-facing projection (check-in counts have their own route). */
export const PUBLIC_PROJECTION_BASE_SECTIONS = PUBLIC_BASE_SECTIONS.filter(
  (section) => section !== "checkins"
) as Exclude<PublicBaseSection, "checkins">[];
/**
 * Version of what a publish builds and how the root is laid out. Bump it when the projection or the
 * layout changes, so views published by older code are rebuilt instead of skipped (it is part of
 * the source token). Roots without it (format 1) hold whole-tournament `debates` and `ballots`
 * sections; format 2 splits them by round; format 3 adds the `tabs` and `derived` sections (read as
 * absent from a format-2 root until it is republished).
 */
export const PUBLIC_VIEW_FORMAT = 3;

/** Whether a root stores debates and ballots per round (format 2 and later). */
export function hasRoundSections(root: Pick<PublicViewRoot, "format">): boolean {
  return (root.format ?? 1) >= 2;
}

export interface PublicRoundContent {
  debates: Record<string, unknown>[];
  ballots: Record<string, unknown>[];
}

export function roundSectionName(roundId: string): PublicRoundSection {
  return `round-${roundId}`;
}

/** Stay well below Firestore's 1 MiB document limit (strings are counted in UTF-8 bytes). */
export const MAX_CHUNK_BYTES = 700_000;

export interface PublicViewSectionMeta {
  hash: string;
  chunks: number;
}

export interface PublicViewRoot {
  format?: number;
  tournamentId: string;
  slug: string;
  /** Combined hash of every section; changes whenever any public data changes. */
  version: string;
  /** Base sections and one `round-{roundId}` section per public round. */
  sections: Record<string, PublicViewSectionMeta>;
  /** Public rounds with a section, in round order. */
  roundIds?: string[];
  /** Fingerprint reported by the publishing client, used to skip redundant rebuilds. */
  clientFingerprint?: string;
  /** The cloud source state this view was built from (see `publicSourceToken`). */
  sourceToken?: string;
  publishedAt: string;
  /**
   * This tournament's public motion statistics, pooled by the public cross-tournament motions page
   * (one root read per tournament instead of every round section). Absent unless released.
   */
  motionSummary?: PublicMotionSummary;
}

export type PublicViewSections = Record<PublicBaseSection, unknown> & {
  [section: PublicRoundSection]: PublicRoundContent;
};

/** Groups a projection's debates and ballots into one section per public round (in round order). */
export function splitByRound(
  roundIds: string[],
  debates: Record<string, unknown>[],
  ballots: Record<string, unknown>[]
): Map<string, PublicRoundContent> {
  const byRound = new Map<string, PublicRoundContent>(roundIds.map((id) => [id, { debates: [], ballots: [] }]));
  for (const debate of debates) byRound.get(String(debate.roundId))?.debates.push(debate);
  for (const ballot of ballots) byRound.get(String(ballot.roundId))?.ballots.push(ballot);
  return byRound;
}

export function buildPublicViewSections(
  tournamentRecord: SourceRecord,
  source: PublicSourceData
): PublicViewSections {
  const projection = buildPublicProjection(tournamentRecord, source);
  const checkins = buildPublicCheckinsSource(tournamentRecord, source);
  const { debates, ballots, feedback: _feedback, ...base } = projection.collections;
  const roundIds = base.rounds.map((round) => String(round.id));
  const sections = {
    tournament: projection.tournament,
    ...base,
    checkins,
    tabs: projection.tabs ?? null,
    derived: projection.derived,
  } as PublicViewSections;
  for (const [roundId, content] of splitByRound(roundIds, debates, ballots)) sections[roundSectionName(roundId)] = content;
  return sections;
}

/** Public rounds that have a section, in round order. */
export function sectionRoundIds(sections: Partial<PublicViewSections>): string[] {
  return ((sections.rounds as Array<{ id?: unknown }> | undefined) || [])
    .map((round) => String(round.id))
    .filter((roundId) => sections[roundSectionName(roundId)] !== undefined);
}

/** Every section name, base sections first, then rounds in order. */
export function sectionNames(sections: PublicViewSections): PublicViewSection[] {
  return [...PUBLIC_BASE_SECTIONS, ...sectionRoundIds(sections).map(roundSectionName)];
}

/** The projection from whichever sections are present; debates and ballots of absent rounds are left out. */
export function assembleProjection(sections: Partial<PublicViewSections>): PublicProjection {
  const rounds = sectionRoundIds(sections).map((roundId) => sections[roundSectionName(roundId)]!);
  const collections = Object.fromEntries(
    PUBLIC_COLLECTION_NAMES.map((name) => [
      name,
      name === "debates" || name === "ballots"
        ? rounds.flatMap((round) => round[name])
        : (sections[name as PublicBaseSection] as Record<string, unknown>[] | undefined) || [],
    ])
  ) as Record<PublicCollectionName, Record<string, unknown>[]>;
  return {
    tournament: sections.tournament as Tournament,
    collections: { ...collections, feedback: [] },
    ...(sections.tabs ? { tabs: sections.tabs as PublicTabs } : {}),
    derived: (sections.derived as PublicDerived | undefined) ?? {},
  };
}

/** The round public pages open on: the latest round that is not cancelled. */
export function latestPublicRoundId(rounds: Array<Record<string, unknown>>): string | undefined {
  return [...rounds]
    .filter((round) => round.cancelled !== true)
    .sort((left, right) => Number(right.seq) - Number(left.seq))[0]?.id as string | undefined;
}

/**
 * A fingerprint of everything the public can see. `updatedAt` is excluded because every cloud
 * upload bumps it even when nothing visible changed.
 */
export function fingerprintSections(sections: PublicViewSections): string {
  const tournament = { ...(sections.tournament as Record<string, unknown>) };
  delete tournament.updatedAt;
  return hashValue({ ...sections, tournament });
}

export function fingerprintPublicSource(tournamentRecord: SourceRecord, source: PublicSourceData): string {
  return fingerprintSections(buildPublicViewSections(tournamentRecord, source));
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Splits a section's JSON into strings that each fit within `maxBytes` of UTF-8. */
export function chunkSectionJson(value: unknown, maxBytes = MAX_CHUNK_BYTES): string[] {
  const json = stableStringify(value);
  if (utf8Length(json) <= maxBytes) return [json];
  const chunks: string[] = [];
  let start = 0;
  while (start < json.length) {
    // A UTF-16 code unit encodes to at most 3 UTF-8 bytes, so this slice always fits.
    let end = Math.min(json.length, start + Math.floor(maxBytes / 3));
    // Never split a surrogate pair across chunks.
    const lastCode = json.charCodeAt(end - 1);
    if (end < json.length && lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1;
    chunks.push(json.slice(start, end));
    start = end;
  }
  return chunks;
}

export function parseSectionChunks(chunks: string[]): unknown {
  return JSON.parse(chunks.join(""));
}

export function buildPublicViewRoot(input: {
  tournamentId: string;
  slug: string;
  sections: PublicViewSections;
  clientFingerprint?: string;
  sourceToken?: string;
  publishedAt: string;
}): { root: PublicViewRoot; chunks: Record<string, string[]> } {
  const chunks: Record<string, string[]> = {};
  const sectionMeta: Record<string, PublicViewSectionMeta> = {};
  const names = sectionNames(input.sections);
  const motionSummary = buildPublicMotionSummary({
    tournamentId: input.tournamentId,
    slug: input.slug,
    tournament: input.sections.tournament,
    motions: input.sections.motions,
    rounds: sectionRoundIds(input.sections).map((roundId) => input.sections[roundSectionName(roundId)] ?? {}),
  });
  for (const section of names) {
    const sectionChunks = chunkSectionJson(input.sections[section]);
    chunks[section] = sectionChunks;
    sectionMeta[section] = { hash: hashValue(sectionChunks.join("")), chunks: sectionChunks.length };
  }
  return {
    root: {
      format: PUBLIC_VIEW_FORMAT,
      tournamentId: input.tournamentId,
      slug: input.slug,
      version: hashValue(names.map((section) => [section, sectionMeta[section].hash])),
      sections: sectionMeta,
      roundIds: sectionRoundIds(input.sections),
      ...(input.clientFingerprint ? { clientFingerprint: input.clientFingerprint } : {}),
      ...(input.sourceToken ? { sourceToken: input.sourceToken } : {}),
      publishedAt: input.publishedAt,
      ...(motionSummary ? { motionSummary } : {}),
    },
    chunks,
  };
}

/** Sections whose content differs from the previously published root (all, if none). */
export function changedSections(
  previous: Pick<PublicViewRoot, "sections"> | null | undefined,
  next: Pick<PublicViewRoot, "sections">
): string[] {
  return Object.keys(next.sections).filter((section) => {
    const before = previous?.sections?.[section];
    const after = next.sections[section];
    return !before || before.hash !== after.hash || before.chunks !== after.chunks;
  });
}

/**
 * Chunk documents are content-addressed by section hash: new chunks are written before the root
 * points at them, so a reader holding the previous root never sees a half-written section.
 */
export function chunkDocumentId(section: string, hash: string, index: number): string {
  // Round ids come from the working copy; keep "/" (invalid in document ids) out.
  return `${encodeURIComponent(section)}-${hash}-${index}`;
}

/** Per-round availability counts; computed per request because check-ins can expire over time. */
/**
 * Each listed team and adjudicator with whether they count as checked in for each round (same rule
 * as the counts). Empty when the source has no per-person list. A team without a public name (code
 * names on, none set) keeps an empty name; the page shows a placeholder.
 */
export function listCheckins(source: PublicCheckinsSource, now: number) {
  const status = (person: { name: string } & Parameters<typeof isAvailableForRound>[0]) => ({
    name: person.name,
    present: Object.fromEntries(
      source.rounds.map((round) => [round.id, isAvailableForRound(person, round.id, source.expiresAfterHours, now)])
    ) as Record<string, boolean>,
  });
  return {
    teams: (source.people?.teams ?? []).map(status),
    adjudicators: (source.people?.adjudicators ?? []).map(status),
  };
}

export function countCheckins(source: PublicCheckinsSource, now: number) {
  const present = (records: PublicCheckinsSource["teams"], roundId: string) =>
    records.filter((record) => isAvailableForRound(record, roundId, source.expiresAfterHours, now)).length;
  return source.rounds.map((round) => ({
    id: round.id,
    name: round.name,
    teamsPresent: present(source.teams, round.id),
    teamsTotal: source.teams.length,
    adjudicatorsPresent: present(source.adjudicators, round.id),
    adjudicatorsTotal: source.adjudicators.length,
  }));
}

/**
 * Cheap aggregates of one source collection, read with Firestore aggregation queries (about one
 * read per 1,000 documents) instead of reading every document. Every cloud write path bumps a
 * record's `syncVersion` (the upload repository, data-entry sync, self check-in) or adds a record,
 * so a change to the collection changes `count` or `versionSum`. Ballots are also written by the
 * private-portal route, which increments the per-debate `version` instead.
 */
export interface PublicSourceCollectionStats {
  count: number;
  versionSum: number;
  ballotVersionSum?: number;
}

export type PublicSourceStats = Record<string, PublicSourceCollectionStats>;

/**
 * Identifies the cloud state a public view is built from: the tournament document (without the
 * `updatedAt` stamp every upload rewrites) plus each source collection's aggregates.
 */
export function publicSourceToken(tournamentData: Record<string, unknown>, stats: PublicSourceStats): string {
  const { updatedAt: _updatedAt, ...tournament } = tournamentData;
  return hashValue({ format: PUBLIC_VIEW_FORMAT, tournament, stats });
}

/**
 * Whether a publish can keep the previous view instead of rebuilding it. The client fingerprint
 * only describes the publishing device's records, so on its own it would skip changes another
 * device or a server route wrote to the cloud. Skipping therefore also needs the cloud source
 * token to match the one the previous view was built from.
 */
export function canSkipPublish(
  previous: Pick<PublicViewRoot, "clientFingerprint" | "sourceToken"> | null | undefined,
  input: { clientFingerprint?: string; sourceToken: string; force?: boolean }
): boolean {
  if (input.force || !previous || !input.clientFingerprint) return false;
  return previous.clientFingerprint === input.clientFingerprint && previous.sourceToken === input.sourceToken;
}
