import { PARTICIPANT_IDS_FIELD } from "@/lib/privateSync";

/**
 * Server time of a record's last cloud write, stamped by every writer of the tournament record
 * collections (FieldValue/serverTimestamp). Devices download only records stamped after the last
 * one they saw (docs/storage-and-scale.md, "Downloading only what changed"). Cloud-only: the
 * working copy never holds it, so it never changes a record's content hash.
 */
export const CLOUD_UPDATED_AT_FIELD = "cloudUpdatedAt";

const CLOUD_ONLY_FIELDS = [PARTICIPANT_IDS_FIELD, CLOUD_UPDATED_AT_FIELD] as const;

/** A cloud document's data without the fields only the cloud keeps (participant index, stamp). */
export function withoutCloudOnlyFields<T extends object>(record: T): T {
  if (!CLOUD_ONLY_FIELDS.some((field) => field in record)) return record;
  const rest = { ...(record as Record<string, unknown>) };
  for (const field of CLOUD_ONLY_FIELDS) delete rest[field];
  return rest as T;
}

/** Milliseconds of a stamp read from Firestore (client or Admin SDK Timestamp), if it is one. */
export function cloudStampMillis(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return undefined;
  const millis = (toMillis as () => unknown).call(value);
  return typeof millis === "number" && Number.isFinite(millis) ? millis : undefined;
}
