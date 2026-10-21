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
export type CloudRecord = {
  id: string;
  syncVersion?: number;
  deletedAt?: string;
};
