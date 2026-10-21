"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button, buttonClasses } from "@/components/ui/Button";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { ThemeToggle, useThemePreference } from "@/components/ui/ThemeToggle";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

/** Theme and language buttons for pages outside the tournament shell (home, sign-in, setup). */
export function EntryPreferenceControls({ className }: { className?: string }) {
  const { preference, setPreference } = useThemePreference();
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <LanguageSwitcher />
      <ThemeToggle preference={preference} onChange={setPreference} />
    </div>
  );
}

/** The CrabbyTab logo and name, linking to `href`. */
export function EntryBrandLink({ href, className }: { href: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 rounded-md text-fg", focusRing, className)}>
      <Image src="/crabbytab.svg" alt="" width={28} height={28} className="h-7 w-7 shrink-0" />
      <span className="font-semibold">CrabbyTab</span>
    </Link>
  );
}

export function SetupShell({
  children,
  maxWidth = "max-w-3xl",
}: {
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const { user, logout } = useAuth();

  return (
    <div className="themed flex min-h-screen flex-col bg-background text-fg">
      <header className="border-b border-border bg-surface px-6 py-2.5 max-sm:px-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <EntryBrandLink href="/tournaments" />
          <div className="flex min-w-0 items-center gap-2">
            {user && (
              <span className="hidden truncate text-xs text-fg-muted sm:inline" title={t("setup.entry.signedInAs", { email: user.email || "" })}>
                {user.email}
              </span>
            )}
            <EntryPreferenceControls />
            {user && (
              <Link
                href="/account/password"
                className={buttonClasses({ variant: "ghost", size: "sm" })}
                title={t("setup.entry.account.changePassword")}
              >
                <KeyRound aria-hidden="true" />
                <span className="max-sm:sr-only">{t("setup.entry.account.changePassword")}</span>
              </Link>
            )}
            {user && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await logout();
                  router.replace("/login");
                }}
              >
                <LogOut aria-hidden="true" />
                <span className="max-sm:sr-only">{t("setup.entry.signOut")}</span>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className={`flex-1 w-full ${maxWidth} mx-auto px-4 py-10 max-sm:py-6`}>{children}</main>
    </div>
  );
}
