/** Browser-only: saves text as a file. CSVs get a UTF-8 BOM so Excel reads accents correctly. */
export function downloadTextFile(fileName: string, content: string, type: string): void {
  const prefix = type.startsWith("text/csv") ? "﻿" : "";
  const blob = new Blob([prefix + content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadCsv(fileName: string, csv: string): void {
  downloadTextFile(fileName.endsWith(".csv") ? fileName : `${fileName}.csv`, csv, "text/csv;charset=utf-8");
}
