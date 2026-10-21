"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { PublicThemeToggle } from "@/components/public/PublicThemeToggle";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

/** Frame for public, signed-out forms (staff invitations, self-registration). */
export function PublicFormShell({
  children,
  width = "md",
}: {
  children: React.ReactNode;
  width?: "md" | "lg";
}) {
  const { t } = useI18n();
  return (
    <div className="themed flex min-h-screen flex-col bg-background text-fg">
      <a
        href="#main-content"
        className="sr-only z-[90] rounded-md bg-surface px-3 py-2 text-[13px] font-medium text-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-2 focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {t("public.skipToContent")}
      </a>
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3 max-sm:px-4">
        <Link href="/" className={cn("inline-flex items-center gap-2 rounded-md text-fg", focusRing)}>
          <Image src="/crabbytab.svg" alt="" width={28} height={28} className="h-7 w-7" />
          <span className="font-semibold">CrabbyTab</span>
        </Link>
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <PublicThemeToggle />
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className={cn("mx-auto w-full flex-1 px-4 py-10 focus:outline-none max-sm:py-6", width === "md" ? "max-w-md" : "max-w-3xl")}
      >
        {children}
      </main>
    </div>
  );
}
