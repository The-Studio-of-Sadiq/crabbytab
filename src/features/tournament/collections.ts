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
  deleteIds: string[];
  recordsToWrite: CloudRecord[];
}

export function planCollectionReconciliation(
  collectionName: CloudCollectionName,
  remoteIds: string[],
  localRecords: CloudRecord[]
): CollectionReconciliationPlan {
  const localIds = new Set(localRecords.map((record) => record.id));
  if (collectionName === "auditEvents") {
    const remoteIdSet = new Set(remoteIds);
    return {
      deleteIds: [],
      recordsToWrite: localRecords.filter((record) => !remoteIdSet.has(record.id)),
    };
  }
  return {
    deleteIds: remoteIds.filter((id) => !localIds.has(id)),
    recordsToWrite: localRecords,
  };
}