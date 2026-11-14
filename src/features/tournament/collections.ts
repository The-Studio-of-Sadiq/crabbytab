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
  "ballotIntake",
] as const;

export type CloudCollectionName = (typeof CLOUD_COLLECTIONS)[number];

/**
 * Collections an administrator's device does not download when it opens a tournament. The audit
 * log grows with every command and only its own page shows it, so reading it on every open was
 * most of the cost of an open. It is read when the audit log page opens, and by a full download.
 */
export const ON_DEMAND_COLLECTIONS = ["auditEvents"] as const satisfies readonly CloudCollectionName[];

/** The collections read when an administrator's device opens a cloud tournament. */
export const OPEN_COLLECTIONS: readonly CloudCollectionName[] = CLOUD_COLLECTIONS.filter(
  (name) => !(ON_DEMAND_COLLECTIONS as readonly CloudCollectionName[]).includes(name)
);
export type CloudRecord = {
  id: string;
  syncVersion?: number;
  deletedAt?: string;
};
