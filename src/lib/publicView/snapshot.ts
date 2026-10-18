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
import type { Tournament } from "@/types";

/**
 * Sections are stored as separate chunked documents so no single Firestore document approaches the
 * 1 MiB limit, and so an unchanged section is neither rewritten nor re-downloaded.
 */
export const PUBLIC_VIEW_SECTIONS = ["tournament", ...PUBLIC_COLLECTION_NAMES, "checkins"] as const;
export type PublicViewSection = (typeof PUBLIC_VIEW_SECTIONS)[number];

/** Stay well below Firestore's 1 MiB document limit (strings are counted in UTF-8 bytes). */
export const MAX_CHUNK_BYTES = 700_000;

export interface PublicViewSectionMeta {
  hash: string;
  chunks: number;
}

export interface PublicViewRoot {
  tournamentId: string;
  slug: string;
  /** Combined hash of every section; changes whenever any public data changes. */
  version: string;
  sections: Record<PublicViewSection, PublicViewSectionMeta>;
  /** Fingerprint reported by the publishing client, used to skip redundant rebuilds. */
  clientFingerprint?: string;
  publishedAt: string;
}

export type PublicViewSections = Record<PublicViewSection, unknown>;

export function buildPublicViewSections(
  tournamentRecord: SourceRecord,
  source: PublicSourceData
): PublicViewSections {
  const projection = buildPublicProjection(tournamentRecord, source);
  const checkins = buildPublicCheckinsSource(tournamentRecord, source);
  return {
    tournament: projection.tournament,
    ...projection.collections,
    checkins,
  } as PublicViewSections;
}

export function assembleProjection(sections: Partial<PublicViewSections>): PublicProjection {
  const collections = Object.fromEntries(
    PUBLIC_COLLECTION_NAMES.map((name) => [name, (sections[name] as Record<string, unknown>[] | undefined) || []])
  ) as Record<PublicCollectionName, Record<string, unknown>[]>;
  return {
    tournament: sections.tournament as Tournament,
    collections: { ...collections, feedback: [] },
  };
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
  publishedAt: string;
}): { root: PublicViewRoot; chunks: Record<PublicViewSection, string[]> } {
  const chunks = {} as Record<PublicViewSection, string[]>;
  const sectionMeta = {} as Record<PublicViewSection, PublicViewSectionMeta>;
  for (const section of PUBLIC_VIEW_SECTIONS) {
    const sectionChunks = chunkSectionJson(input.sections[section]);
    chunks[section] = sectionChunks;
    sectionMeta[section] = { hash: hashValue(sectionChunks.join("")), chunks: sectionChunks.length };
  }
  return {
    root: {
      tournamentId: input.tournamentId,
      slug: input.slug,
      version: hashValue(PUBLIC_VIEW_SECTIONS.map((section) => sectionMeta[section].hash)),
      sections: sectionMeta,
      ...(input.clientFingerprint ? { clientFingerprint: input.clientFingerprint } : {}),
      publishedAt: input.publishedAt,
    },
    chunks,
  };
}

/** Sections whose content differs from the previously published root (all, if none). */
export function changedSections(
  previous: Pick<PublicViewRoot, "sections"> | null | undefined,
  next: Pick<PublicViewRoot, "sections">
): PublicViewSection[] {
  return PUBLIC_VIEW_SECTIONS.filter((section) => {
    const before = previous?.sections?.[section];
    const after = next.sections[section];
    return !before || before.hash !== after.hash || before.chunks !== after.chunks;
  });
}

/**
 * Chunk documents are content-addressed by section hash: new chunks are written before the root
 * points at them, so a reader holding the previous root never sees a half-written section.
 */
export function chunkDocumentId(section: PublicViewSection, hash: string, index: number): string {
  return `${section}-${hash}-${index}`;
}

/** Per-round availability counts; computed per request because check-ins can expire over time. */
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
