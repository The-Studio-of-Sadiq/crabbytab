/** A return location to print, or null for empty / "TBA" (Tabbycat hides "TBA"). */
export function returnLocation(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed && trimmed.toUpperCase() !== "TBA" ? trimmed : null;
}
