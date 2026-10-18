"use client";

import React from "react";
import { Languages } from "lucide-react";
import { LOCALES, getLocaleDefinition, type Locale } from "@/lib/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { DropdownMenu, DropdownMenuLabel, DropdownMenuRadioItem } from "@/components/ui/DropdownMenu";
import { cn } from "@/components/ui/cn";

/** Radio items for choosing the UI language, for use inside an existing menu. */
export function LanguageMenuItems() {
  const { preference, setPreference, t } = useI18n();
  return (
    <>
      <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
      <DropdownMenuRadioItem
        checked={preference === null}
        onSelect={() => setPreference(null)}
        description={t("language.automaticHelp")}
      >
        {t("language.automatic")}
      </DropdownMenuRadioItem>
      {LOCALES.map((definition) => (
        <DropdownMenuRadioItem
          key={definition.code}
          checked={preference === definition.code}
          onSelect={() => setPreference(definition.code as Locale)}
          description={"machineDrafted" in definition && definition.machineDrafted ? t("language.machineDrafted") : undefined}
        >
          {/* The language's own name, tagged so screen readers pronounce it correctly. */}
          <span lang={definition.code}>{definition.nativeName}</span>
        </DropdownMenuRadioItem>
      ))}
    </>
  );
}

/**
 * Stand-alone language button for pages without the account menu (public pages, private portals).
 * Shows the active language's native name so a viewer who cannot read the current language can
 * still find it.
 */
export function LanguageSwitcher({ className, triggerClassName }: { className?: string; triggerClassName?: string }) {
  const { locale, t } = useI18n();
  const current = getLocaleDefinition(locale);
  return (
    <div className={className}>
      <DropdownMenu
        align="end"
        triggerLabel={t("language.trigger", { language: current.nativeName })}
        triggerClassName={cn("h-8 px-2", triggerClassName)}
        menuClassName="min-w-[13rem]"
        trigger={
          <>
            <Languages className="h-4 w-4" aria-hidden="true" />
            <span lang={current.code}>{current.nativeName}</span>
          </>
        }
      >
        <LanguageMenuItems />
      </DropdownMenu>
    </div>
  );
}
