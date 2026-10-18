import type { CloudCollectionName, CloudRecord } from "@/features/tournament/collections";
import {
  PUBLIC_SOURCE_COLLECTIONS,
  type PublicSourceData,
  type SourceRecord,
} from "@/lib/publicView/projection";
import { fingerprintPublicSource } from "@/lib/publicView/snapshot";
import type { Tournament } from "@/types";

export interface PublishPublicViewResponse {
  status: "published" | "unchanged";
  slug: string;
  version: string;
  changedSections: string[];
}

/** Fingerprint of what the public could see if this device's records were published. */
export function fingerprintLocalPublicView(
  tournament: Tournament,
  collections: Record<CloudCollectionName, CloudRecord[]>
): string {
  const source = Object.fromEntries(
    PUBLIC_SOURCE_COLLECTIONS.map((name) => [name, (collections[name] || []) as unknown as SourceRecord[]])
  ) as PublicSourceData;
  return fingerprintPublicSource(tournament as unknown as SourceRecord, source);
}

export async function publishPublicViewCommand(input: {
  tournament: Tournament;
  collections: Record<CloudCollectionName, CloudRecord[]>;
  idToken: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<PublishPublicViewResponse> {
  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl(
    `/api/tournaments/${encodeURIComponent(input.tournament.id)}/public-view`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        clientFingerprint: fingerprintLocalPublicView(input.tournament, input.collections),
        force: input.force === true,
      }),
      cache: "no-store",
    }
  );
  const result = (await response.json().catch(() => ({}))) as Partial<PublishPublicViewResponse> & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(typeof result.error === "string" ? result.error : "Could not publish the public view.");
  }
  return result as PublishPublicViewResponse;
}

export const PUBLIC_VIEW_POLL_MILLISECONDS = 45_000;

export interface PublicProjectionResponse {
  version?: string;
  tournament: Tournament;
  collections: Record<string, unknown[]>;
}

export async function fetchPublicProjection(
  slug: string,
  fetchImpl: typeof fetch = fetch
): Promise<PublicProjectionResponse> {
  const response = await fetchImpl(`/api/public/tournaments/${encodeURIComponent(slug)}`);
  const result = (await response.json().catch(() => ({}))) as Partial<PublicProjectionResponse> & {
    error?: string;
  };
  if (!response.ok || !result.tournament || !result.collections) {
    throw new Error(typeof result.error === "string" ? result.error : "Could not load public tournament data.");
  }
  return result as PublicProjectionResponse;
}

export async function fetchPublicViewVersion(slug: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const response = await fetchImpl(`/api/public/tournaments/${encodeURIComponent(slug)}/version`);
  if (!response.ok) return null;
  const result = (await response.json().catch(() => ({}))) as { version?: unknown };
  return typeof result.version === "string" ? result.version : null;
}
