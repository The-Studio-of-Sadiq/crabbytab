export const CLOUD_COLLECTIONS = [
  "rounds",
  "teams",
  "adjudicators",
  "venues",
  "motions",
  "breakCategories",
  "debates",
  "ballots",
  "feedback",
  "institutions",
  "auditEvents",
] as const;

export type CloudCollectionName = (typeof CLOUD_COLLECTIONS)[number];
export type CloudRecord = { id: string };

export interface CollectionReconciliationPlan {
  recordsToWrite: CloudRecord[];
}

export function planCollectionReconciliation(
  collectionName: CloudCollectionName,
  remoteIds: string[],
  localRecords: CloudRecord[]
): CollectionReconciliationPlan {
  if (collectionName === "auditEvents") {
    const remoteIdSet = new Set(remoteIds);
    return {
      recordsToWrite: localRecords.filter((record) => !remoteIdSet.has(record.id)),
    };
  }
  return {
    recordsToWrite: localRecords,
  };
}