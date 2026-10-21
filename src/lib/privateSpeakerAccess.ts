import type { Team } from "@/types";
import { passcodesMatch } from "@/lib/passcode";

/**
 * Server side of per-speaker private URLs (see privateSpeakerUrls.ts): finding the team a private
 * key belongs to and checking the key and passcode. Server-only (node:crypto).
 */

export interface PrivateTeamCredentialMatch {
  /** Set when the key is a speaker's: the speaker the URL belongs to. */
  speakerId?: string;
}

/**
 * Whether `key` + `passcode` open this team's portal: the team's own credentials, or one of its
 * speakers'. Unknown keys and wrong passcodes both give null.
 */
export function matchPrivateTeamCredential(
  team: Pick<Team, "privateUrlKey" | "privatePasscode" | "speakers"> | Record<string, unknown> | undefined,
  key: string,
  passcode: string
): PrivateTeamCredentialMatch | null {
  if (!team || !key) return null;
  const record = team as Record<string, unknown>;
  if (record.privateUrlKey === key) {
    return passcodesMatch(record.privatePasscode as string | undefined, passcode) ? {} : null;
  }
  const speakers = Array.isArray(record.speakers) ? record.speakers : [];
  const speaker = speakers.find(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && (item as Record<string, unknown>).privateUrlKey === key
  );
  if (!speaker || typeof speaker.id !== "string") return null;
  return passcodesMatch(speaker.privatePasscode as string | undefined, passcode) ? { speakerId: speaker.id } : null;
}

interface TeamDocument {
  id: string;
  data(): Record<string, unknown> | undefined;
}
interface TeamQuerySource<D extends TeamDocument> {
  where(field: string, operator: "==" | "array-contains", value: unknown): { get(): Promise<{ docs: D[] }> };
}

/**
 * The live (not deleted) teams a private key could belong to: by the team key, and by the
 * speakers' key index. Two indexed queries; the credential is checked by the caller.
 */
export async function findTeamsByPrivateKey<D extends TeamDocument>(teams: TeamQuerySource<D>, key: string): Promise<D[]> {
  const [byTeamKey, bySpeakerKey] = await Promise.all([
    teams.where("privateUrlKey", "==", key).get(),
    teams.where("speakerUrlKeys", "array-contains", key).get(),
  ]);
  const seen = new Set<string>();
  return [...byTeamKey.docs, ...bySpeakerKey.docs].filter((document) => {
    if (seen.has(document.id) || typeof document.data()?.deletedAt === "string") return false;
    seen.add(document.id);
    return true;
  });
}
