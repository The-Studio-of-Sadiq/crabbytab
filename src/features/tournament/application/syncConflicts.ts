import type { CloudRecord } from "@/features/tournament/collections";
import type { DivergedRecord, SyncedRecordKind } from "./cloudSync";

const KIND_LABELS: Record<SyncedRecordKind, string> = {
  tournament: "Tournament settings",
  rounds: "Round",
  teams: "Team",
  adjudicators: "Adjudicator",
  venues: "Room",
  motions: "Motion",
  breakCategories: "Break category",
  debates: "Debate",
  ballots: "Ballot",
  feedback: "Feedback",
  institutions: "Institution",
  auditEvents: "Audit event",
};

/** Fields the cloud stamps, which say nothing about what changed. */
const IGNORED_FIELDS = new Set(["syncVersion", "updatedAt"]);

export interface FieldDifference {
  field: string;
  local: string;
  cloud: string;
}

export interface DivergedRecordSummary {
  key: string;
  kind: string;
  name: string;
  /** Top-level fields whose values differ; empty when this device no longer holds the record. */
  differences: FieldDifference[];
  missingLocally: boolean;
}

function displayName(record: CloudRecord): string {
  const fields = record as CloudRecord & Record<string, unknown>;
  for (const field of ["name", "text", "submitterName", "sourceName"]) {
    const value = fields[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return record.id;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return value === undefined ? "—" : JSON.stringify(value);
}

function preview(value: unknown, maxLength = 80): string {
  const text = typeof value === "string" ? value : stableJson(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/**
 * Describes a diverged record for someone choosing a version: what it is and which top-level fields
 * differ between this device's copy and the cloud's. Values are shortened for display only.
 */
export function summarizeDivergedRecord(
  diverged: DivergedRecord,
  localRecord: CloudRecord | undefined,
  key: string
): DivergedRecordSummary {
  const cloud = diverged.cloudRecord as CloudRecord & Record<string, unknown>;
  const kind = KIND_LABELS[diverged.collectionName] ?? diverged.collectionName;
  if (!localRecord) {
    return { key, kind, name: displayName(cloud), differences: [], missingLocally: true };
  }
  const local = localRecord as CloudRecord & Record<string, unknown>;
  const fields = [...new Set([...Object.keys(local), ...Object.keys(cloud)])]
    .filter((field) => !IGNORED_FIELDS.has(field))
    .sort();
  const differences = fields
    .filter((field) => stableJson(local[field]) !== stableJson(cloud[field]))
    .map((field) => ({ field, local: preview(local[field]), cloud: preview(cloud[field]) }));
  return { key, kind, name: displayName(local), differences, missingLocally: false };
}
