import Papa from "papaparse";

/** One CSV data row; `rowNumber` is the spreadsheet row (the header is row 1). */
export interface CsvRecord {
  rowNumber: number;
  values: Record<string, string>;
  /** A problem PapaParse found in this row (wrong number of cells, unclosed quote). */
  parseError?: string;
  /** PapaParse's error code, e.g. "TooManyFields". */
  parseErrorCode?: string;
}

export interface CsvTable {
  headers: string[];
  records: CsvRecord[];
  /** Problems with the file as a whole; nothing in it can be imported. */
  fileErrors: string[];
}

/** Largest CSV the import screens read (a 1000-team tournament is well under 1 MB). */
export const MAX_CSV_BYTES = 5 * 1024 * 1024;

/**
 * Reads CSV text with a header row. Strips a UTF-8 BOM, trims header names, skips blank lines
 * (including rows of empty cells from spreadsheets) and keeps quoted commas and newlines in values.
 * Values are plain strings: nothing is evaluated or rendered as HTML.
 */
export function readCsvTable(text: string): CsvTable {
  if (text.length > MAX_CSV_BYTES) {
    return { headers: [], records: [], fileErrors: ["The file is larger than 5 MB."] };
  }
  const content = text.replace(/^﻿/, "");
  if (!content.trim()) return { headers: [], records: [], fileErrors: ["The file is empty."] };

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.replace(/^﻿/, "").trim(),
  });
  const headers = (parsed.meta.fields ?? []).filter((header) => header !== "");
  const fileErrors: string[] = [];
  if (headers.length === 0) fileErrors.push("The first row must hold column names.");
  const duplicates = headers.filter((header, index) =>
    headers.findIndex((other) => other.toLowerCase() === header.toLowerCase()) !== index
  );
  if (duplicates.length > 0) fileErrors.push(`Repeated column names: ${[...new Set(duplicates)].join(", ")}.`);

  const rowErrors = new Map<number, { code: string; message: string }>();
  for (const error of parsed.errors) {
    // A single-column file has no delimiter to detect; PapaParse falls back to commas, which is right.
    if (error.code === "UndetectableDelimiter") continue;
    // An unclosed quote swallows the rest of the file into one cell, so no row after it can be trusted.
    if (error.code === "MissingQuotes") {
      fileErrors.push("A quoted value is never closed, so the rest of the file would be read as one cell. Check for a stray double quote.");
      continue;
    }
    if (error.row === undefined || error.row === null) {
      fileErrors.push(error.message);
      continue;
    }
    if (!rowErrors.has(error.row)) {
      rowErrors.set(error.row, {
        code: error.code,
        message: error.code === "TooManyFields"
          ? "This row has more cells than there are columns (an unquoted comma?)."
          : error.code === "TooFewFields"
            ? "This row has fewer cells than there are columns."
            : error.message,
      });
    }
  }

  const records = parsed.data.map((values, index) => ({
    rowNumber: index + 2,
    values,
    parseError: rowErrors.get(index)?.message,
    parseErrorCode: rowErrors.get(index)?.code,
  }));
  if (records.length === 0 && fileErrors.length === 0) fileErrors.push("The file has a header row but no data rows.");
  return { headers, records, fileErrors };
}

/** Case- and spacing-insensitive key for matching names: "  Oxford  A" and "oxford a" match. */
export function normalizeName(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeEmail(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Headers present in the file that no known column alias uses. */
export function unknownColumns(headers: string[], known: string[]): string[] {
  const knownKeys = new Set(known.map((column) => column.toLowerCase()));
  return headers.filter((header) => !knownKeys.has(header.toLowerCase()));
}
