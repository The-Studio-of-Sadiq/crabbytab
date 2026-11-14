import type { BallotSubmission, FeedbackSubmission } from "@/types";

/**
 * Ballots and feedback a private-URL participant saved on their device, waiting for
 * /api/private/sync. Each private link has its own queue, so a phone that opened several links
 * (or a link before a draw was regenerated) never sends one participant's items with another's.
 */
export type PrivateSyncItem =
  | { collection: "ballots"; record: BallotSubmission }
  | { collection: "feedback"; record: FeedbackSubmission };

/** A saved item the server refused; it is skipped, and the rest of the sync goes ahead. */
export interface PrivateSyncRejection {
  id: string;
  collection: PrivateSyncItem["collection"];
  reason: string;
}

export const PRIVATE_SYNC_NOT_ASSIGNED =
  "This debate is not one of this private link's debates in a released draw. It may have been saved for another private link on this device, or the draw has changed since.";

const QUEUE_SUFFIX = "privateSyncQueue";

/**
 * The storage key (after the tournament's storage prefix) of a private link's queue. Without a
 * key it is the queue every link shared before queues were kept per link.
 */
export function privateSyncQueueName(privateUrlKey?: string): string {
  return privateUrlKey ? `${QUEUE_SUFFIX}_${encodeURIComponent(privateUrlKey)}` : QUEUE_SUFFIX;
}

function isQueueItem(value: unknown): value is PrivateSyncItem {
  if (!value || typeof value !== "object") return false;
  const item = value as { collection?: unknown; record?: unknown };
  return (
    (item.collection === "ballots" || item.collection === "feedback") &&
    !!item.record &&
    typeof item.record === "object" &&
    typeof (item.record as { id?: unknown }).id === "string"
  );
}

/** Reads a stored queue, dropping entries that are not queue items (a damaged store would otherwise fail every sync). */
export function parsePrivateSyncQueue(value: unknown): PrivateSyncItem[] {
  return Array.isArray(value) ? value.filter(isQueueItem) : [];
}

/** Adds an item; it replaces the same record, and a new ballot replaces an earlier one for the same debate. */
export function enqueuePrivateSyncItem(current: readonly PrivateSyncItem[], item: PrivateSyncItem): PrivateSyncItem[] {
  return [
    ...current.filter((entry) => {
      if (entry.record.id === item.record.id) return false;
      return !(
        item.collection === "ballots" &&
        entry.collection === "ballots" &&
        entry.record.debateId === item.record.debateId
      );
    }),
    item,
  ];
}

/**
 * The items one sync sends: this link's queue, then items left in the old shared queue that are
 * not already in it. Items of the same record are sent once.
 */
export function privateSyncItemsToSend(
  own: readonly PrivateSyncItem[],
  legacy: readonly PrivateSyncItem[]
): PrivateSyncItem[] {
  const ids = new Set(own.map((item) => `${item.collection}/${item.record.id}`));
  return [...own, ...legacy.filter((item) => !ids.has(`${item.collection}/${item.record.id}`))];
}

export function parsePrivateSyncRejections(value: unknown): PrivateSyncRejection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { id, collection, reason } = entry as Record<string, unknown>;
    if (typeof id !== "string" || (collection !== "ballots" && collection !== "feedback")) return [];
    return [{ id, collection, reason: typeof reason === "string" ? reason : "Refused by the server." }];
  });
}

/**
 * What stays queued after a successful sync: only the refused items. They are kept (never
 * silently deleted) until the participant discards them, since a refusal can be temporary
 * (a draw released again) or the item can belong to another private link on this device.
 */
export function remainingAfterPrivateSync(
  queue: readonly PrivateSyncItem[],
  rejections: readonly PrivateSyncRejection[]
): PrivateSyncItem[] {
  const refused = new Set(rejections.map((rejection) => `${rejection.collection}/${rejection.id}`));
  return queue.filter((item) => refused.has(`${item.collection}/${item.record.id}`));
}

/** Removes the given items (by collection and id) from a queue. */
export function withoutPrivateSyncItems(
  queue: readonly PrivateSyncItem[],
  items: ReadonlyArray<Pick<PrivateSyncRejection, "id" | "collection">>
): PrivateSyncItem[] {
  const drop = new Set(items.map((item) => `${item.collection}/${item.id}`));
  return queue.filter((item) => !drop.has(`${item.collection}/${item.record.id}`));
}
