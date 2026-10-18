"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";
import { DropdownMenu, DropdownMenuLabel, DropdownMenuRadioItem } from "@/components/ui/DropdownMenu";
import { iconButtonClasses } from "@/components/ui/Button";

const OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
  { value: "system", label: "System", icon: <Monitor /> },
];

function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can be unavailable (privacy mode); fall back to the system scheme.
    return "system";
  }
}

function applyPreference(preference: ThemePreference) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = resolveTheme(preference, prefersDark);
}

/** Theme preference persisted per viewer; follows the OS while set to "system". */
export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    setPreferenceState(readStoredPreference());
  }, []);

  useEffect(() => {
    applyPreference(preference);
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyPreference("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Not persisted when storage is unavailable; the choice still applies to this page view.
    }
  }, []);

  return { preference, setPreference };
}

/** Radio items for choosing the theme, for use inside an existing menu. */
export function ThemeMenuItems({
  preference,
  onChange,
}: {
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
}) {
  return (
    <>
      <DropdownMenuLabel>Theme</DropdownMenuLabel>
      {OPTIONS.map((option) => (
        <DropdownMenuRadioItem
          key={option.value}
          checked={preference === option.value}
          onSelect={() => onChange(option.value)}
          icon={option.icon}
        >
          {option.label}
        </DropdownMenuRadioItem>
      ))}
    </>
  );
}

export function ThemeToggle({
  preference,
  onChange,
  className,
}: {
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
  className?: string;
}) {
  const current = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[2];
  return (
    <div className={className}>
      <DropdownMenu
        align="end"
        triggerLabel={`Theme: ${current.label}`}
        triggerClassName={iconButtonClasses({ size: "md" })}
        menuClassName="min-w-[9rem]"
        trigger={current.icon}
      >
        <ThemeMenuItems preference={preference} onChange={onChange} />
      </DropdownMenu>
    </div>
  );
}
