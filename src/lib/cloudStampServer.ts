import { FieldValue } from "firebase-admin/firestore";

import { CLOUD_COLLECTIONS } from "@/features/tournament/collections";
import { CLOUD_UPDATED_AT_FIELD } from "@/lib/cloudRecordFields";

/**
 * The server-time stamp every Admin SDK write of a tournament record must carry, so devices that
 * download only what changed see it (lib/cloudRecordFields.ts). Spread it last into the written
 * data: data built from the stored record still holds that record's older stamp.
 */
export function serverStamp(): { [CLOUD_UPDATED_AT_FIELD]: FieldValue } {
  return { [CLOUD_UPDATED_AT_FIELD]: FieldValue.serverTimestamp() };
}

/** Whether `collection` is one of the record collections devices download (and so is stamped). */
export function isStampedCollection(collection: string): boolean {
  return (CLOUD_COLLECTIONS as readonly string[]).includes(collection);
}
