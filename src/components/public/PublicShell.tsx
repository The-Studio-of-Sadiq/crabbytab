"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { PublicThemeToggle } from "@/components/public/PublicThemeToggle";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

const widths = { wide: "max-w-6xl", narrow: "max-w-3xl" };

/**
 * Frame for every public page and private portal: skip link, a sticky header with the tournament
 * name, language and theme controls, optional section navigation, and the main landmark. It opts
 * into the design-system theme (`themed`), so these pages follow the viewer's light/dark choice.
 */
export function PublicShell({
  title,
  subtitle,
  titleAs = "p",
  backHref,
  backLabel,
  actions,
  nav,
  width = "wide",
  footer = true,
  children,
}: {
  /** Usually the tournament name. */
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Use "h1" when the header title is the page's heading (the public tab). */
  titleAs?: "h1" | "p";
  backHref?: string;
  backLabel?: string;
  /** Extra header controls, placed before the language and theme buttons. */
  actions?: React.ReactNode;
  /** Section navigation shown under the title row, inside the sticky header. */
  nav?: React.ReactNode;
  width?: keyof typeof widths;
  footer?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const Title = titleAs;
  return (
    <div className="themed flex min-h-screen flex-col bg-background text-fg">
      <a
        href="#main-content"
        className="sr-only z-[90] rounded-md bg-surface px-3 py-2 text-[13px] font-medium text-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-2 focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {t("public.skipToContent")}
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-surface">
        <div className={cn("mx-auto flex w-full items-center justify-between gap-3 px-4 py-2.5 sm:px-6", widths[width])}>
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" aria-label={t("public.homeLink")} className={cn("shrink-0 rounded-md", focusRing)}>
              <Image src="/crabbytab.svg" alt="" width={28} height={28} className="h-7 w-7" />
            </Link>
            <div className="min-w-0">
              {backHref && (
                <Link
                  href={backHref}
                  className={cn("inline-flex items-center gap-1 rounded-sm text-xs text-fg-muted hover:text-fg", focusRing)}
                >
                  <ArrowLeft className="h-3 w-3 rtl:-scale-x-100" aria-hidden="true" />
                  {backLabel}
                </Link>
              )}
              <Title className="truncate text-[15px] font-semibold leading-tight text-fg">{title}</Title>
              {subtitle && <p className="truncate text-xs text-fg-muted">{subtitle}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <LanguageSwitcher />
            <PublicThemeToggle />
          </div>
        </div>
        {nav && <div className={cn("mx-auto w-full px-2 sm:px-4", widths[width])}>{nav}</div>}
      </header>
      <main id="main-content" tabIndex={-1} className={cn("mx-auto w-full flex-1 space-y-6 px-4 py-6 focus:outline-none sm:px-6", widths[width])}>
        {children}
      </main>
      {footer && (
        <footer className="border-t border-border bg-surface px-4 py-4 text-center text-xs text-fg-muted">
          {t("public.footer")}
        </footer>
      )}
    </div>
  );
}

/** Centred single-card state (loading, unavailable, passcode) inside the public frame. */
export function PublicCenteredCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="flex justify-center py-6 sm:py-12">
      <div className={cn("w-full max-w-md space-y-4 rounded-lg border border-border bg-surface p-6 sm:p-8", className)}>{children}</div>
    </div>
  );
}
