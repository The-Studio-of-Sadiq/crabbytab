import Papa from "papaparse";
import type { Adjudicator } from "@/types";
import { ADJ_SCORE_MAX, ADJ_SCORE_MIN } from "@/lib/feedback/scores";

/**
 * Bulk base-score update (Tabbycat adjfeedback-update-scores-bulk): one `adjudicator,score` line
 * per adjudicator, the adjudicator named by id or by exact name (case and surrounding spaces
 * ignored). Nothing is applied while any line has an error, so a typo never leaves half the panel
 * re-scored.
 */

export type BulkScoreError =
  | "missingScore"
  | "tooManyColumns"
  | "unknownAdjudicator"
  | "ambiguousName"
  | "invalidScore"
  | "duplicate";

export interface BulkScoreRow {
  /** 1-based line number among the non-blank lines. */
  line: number;
  name: string;
  adjudicatorId?: string;
  score?: number;
  previous?: number;
  error?: BulkScoreError;
}

export interface BulkScorePlan {
  rows: BulkScoreRow[];
  /** Adjudicators whose base score changes (empty while any row has an error). */
  updates: Array<{ adjudicatorId: string; baseScore: number }>;
  errorCount: number;
}

const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export function planBulkScoreUpdate(text: string, adjudicators: readonly Adjudicator[]): BulkScorePlan {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const byId = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const byName = new Map<string, Adjudicator[]>();
  for (const adjudicator of adjudicators) {
    const key = normalizeName(adjudicator.name);
    byName.set(key, [...(byName.get(key) ?? []), adjudicator]);
  }
  const seen = new Set<string>();
  const rows: BulkScoreRow[] = parsed.data.map((cells, index) => {
    const line = index + 1;
    const values = cells.map((cell) => String(cell ?? "").trim());
    const name = values[0] ?? "";
    if (values.length < 2 || values[1] === "") return { line, name, error: "missingScore" };
    if (values.slice(2).some((value) => value !== "")) return { line, name, error: "tooManyColumns" };
    const named = byName.get(normalizeName(name)) ?? [];
    const adjudicator = byId.get(name) ?? (named.length === 1 ? named[0] : undefined);
    if (!adjudicator) return { line, name, error: named.length > 1 ? "ambiguousName" : "unknownAdjudicator" };
    const score = Number(values[1]);
    const base = { line, name: adjudicator.name, adjudicatorId: adjudicator.id, previous: adjudicator.baseScore };
    if (!/^-?\d+(\.\d+)?$/.test(values[1]) || !Number.isFinite(score) || score < ADJ_SCORE_MIN || score > ADJ_SCORE_MAX) {
      return { ...base, error: "invalidScore" };
    }
    if (seen.has(adjudicator.id)) return { ...base, score, error: "duplicate" };
    seen.add(adjudicator.id);
    return { ...base, score };
  });
  const errorCount = rows.filter((row) => row.error).length;
  const updates = errorCount > 0
    ? []
    : rows
        .filter((row) => row.adjudicatorId && row.score !== undefined && row.score !== row.previous)
        .map((row) => ({ adjudicatorId: row.adjudicatorId!, baseScore: row.score! }));
  return { rows, updates, errorCount };
}
