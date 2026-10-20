"use client";

import React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemePreference } from "@/lib/theme";
import type { MessageKey } from "@/lib/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useThemePreference } from "@/components/ui/ThemeToggle";
import { DropdownMenu, DropdownMenuLabel, DropdownMenuRadioItem } from "@/components/ui/DropdownMenu";
import { iconButtonClasses } from "@/components/ui/Button";

const OPTIONS: { value: ThemePreference; label: MessageKey; icon: React.ReactNode }[] = [
  { value: "light", label: "public.theme.light", icon: <Sun /> },
  { value: "dark", label: "public.theme.dark", icon: <Moon /> },
  { value: "system", label: "public.theme.system", icon: <Monitor /> },
];

/**
 * Theme button for public pages and private portals. Same preference store as the staff shell's
 * toggle, with translated labels because participants read these pages in the public language.
 */
export function PublicThemeToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const { preference, setPreference } = useThemePreference();
  const current = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[2];
  return (
    <div className={className}>
      <DropdownMenu
        align="end"
        triggerLabel={t("public.theme.trigger", { theme: t(current.label) })}
        triggerClassName={iconButtonClasses({ size: "md" })}
        menuClassName="min-w-[9rem]"
        trigger={current.icon}
      >
        <DropdownMenuLabel>{t("public.theme.label")}</DropdownMenuLabel>
        {OPTIONS.map((option) => (
          <DropdownMenuRadioItem
            key={option.value}
            checked={preference === option.value}
            onSelect={() => setPreference(option.value)}
            icon={option.icon}
          >
            {t(option.label)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenu>
    </div>
  );
}
