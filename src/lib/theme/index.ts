/**
 * Colour-scheme preference, persisted per viewer in localStorage.
 *
 * "system" follows `prefers-color-scheme`. The resolved scheme is written to
 * `<html data-theme>` so CSS (see globals.css) only has to match one attribute.
 */
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "crabbytab:theme";
export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * Inline script for the root layout. It runs before first paint so the page
 * never flashes the wrong scheme. Storage access is guarded because it throws
 * in some privacy modes.
 */
export const themeInitScript = `(function(){try{var p=null;try{p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)})}catch(e){}if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}})();`;
