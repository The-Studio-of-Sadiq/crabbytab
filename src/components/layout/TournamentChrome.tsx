"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";
import { Navbar } from "@/components/layout/Navbar";
import { Sidebar } from "@/components/layout/Sidebar";
import { ToastProvider } from "@/components/ui/Toast";
import { Alert } from "@/components/ui/Feedback";
import { cn } from "@/components/ui/cn";
import { useI18n, useTournamentLocale } from "@/components/i18n/I18nProvider";
import { RuleOverrideHost } from "@/features/tournament/components/RuleOverrideHost";
import { meetsRouteRequirement, routeRequirement, sharedRouteKind, tournamentSubpathSegments } from "@/lib/tournamentRoutes";

/**
 * Tournament pages already rebuilt on the design system (docs/design-system.md).
 * Every other page renders inside a `.theme-light` panel so its hard-coded
 * light colours stay legible when the shell is in dark mode. Add a route here
 * once it has been migrated.
 */
const THEMED_SUBPATHS = new Set(["", "/results", "/results/intake", "/standings", "/schedule", "/draw", "/allocation", "/allocation/panels", "/checkins"]);

/**
 * Migrated route sections matched by prefix, so their sub-pages (`/config/draw`,
 * `/imports/teams`, …) are themed too. Setup and admin pages.
 */
const THEMED_SECTIONS = ["/config", "/imports", "/staff", "/api", "/email", "/registration", "/private-urls", "/audit"];
// Results area: ballot entry (/results/[roundSeq]/[debateId]), feedback detail pages, breaks, analytics.
THEMED_SECTIONS.push("/results", "/feedback", "/break", "/analytics");

function isThemedRoute(pathname: string | null, tournamentSlug: string) {
  if (!pathname) return false;
  const prefix = `/${tournamentSlug}`;
  if (!pathname.startsWith(prefix)) return false;
  const subpath = pathname.slice(prefix.length).replace(/\/$/, "");
  return THEMED_SUBPATHS.has(subpath) || THEMED_SECTIONS.some((section) => subpath === section || subpath.startsWith(`${section}/`));
}

function ShellMessage({ children }: { children: React.ReactNode }) {
  return <div className="themed flex min-h-screen items-start justify-center p-6">{children}</div>;
}

export function TournamentChrome({
  tournamentSlug,
  children,
}: {
  tournamentSlug: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const {
    tournament,
    loading: tournamentLoading,
    cloudLoadError,
    isOwnerOrAdmin,
    isDataEntryAssistant,
    staffPermissions,
    staffAccessLoading,
    staffAccessError,
  } = useTournament();
  const { t } = useI18n();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  // Matched on the segments after the slug, so a slug like "public-speaking-open" stays a staff route.
  const segments = tournamentSubpathSegments(pathname, tournamentSlug) ?? [];
  const sharedKind = sharedRouteKind(segments);
  const isDisplay = sharedKind === "display";
  const isPublicRoute = sharedKind !== null;
  const requirement = routeRequirement(segments);

  React.useEffect(() => {
    if (!isPublicRoute && !authLoading && !user) {
      const next = pathname || `/${tournamentSlug}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [authLoading, isPublicRoute, pathname, router, tournamentSlug, user]);

  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Participants are the most likely non-English readers, so the organiser's public language
  // applies to public pages and private portals only.
  useTournamentLocale(isPublicRoute ? tournament?.preferences?.publicLanguage : null);

  if (isPublicRoute) {
    return isDisplay
      ? <div className="min-h-screen bg-[#1b1f23]">{children}</div>
      : <>{children}</>;
  }

  if (authLoading || !user) {
    return (
      <ShellMessage>
        <p role="status" className="text-[13px] text-fg-muted">{t("setup.shell.redirectingToSignIn")}</p>
      </ShellMessage>
    );
  }

  if (tournamentLoading || staffAccessLoading) {
    return (
      <ShellMessage>
        <p role="status" className="text-[13px] text-fg-muted">{t("setup.shell.checkingAccess")}</p>
      </ShellMessage>
    );
  }

  if (!tournament || (!isOwnerOrAdmin && !isDataEntryAssistant)) {
    return (
      <ShellMessage>
        <Alert role="alert" tone="danger" title={<span className="text-sm">{t("setup.shell.accessDeniedTitle")}</span>} className="w-full max-w-2xl">
          <p>{staffAccessError || cloudLoadError || t("setup.shell.accessNotAssigned")}</p>
          <p className="mt-1">{t("setup.shell.accessAskAdmin")}</p>
        </Alert>
      </ShellMessage>
    );
  }

  const themed = isThemedRoute(pathname, tournamentSlug);

  return (
    <ToastProvider>
      <div className="themed flex min-h-screen flex-col">
        <a
          href="#main-content"
          className="sr-only z-[90] rounded-md bg-surface px-3 py-2 text-[13px] font-medium text-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-2 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          {t("setup.shell.skipToContent")}
        </a>
        <Navbar
          tournamentSlug={tournamentSlug}
          navOpen={mobileNavOpen}
          onOpenNav={() => setMobileNavOpen(true)}
        />
        <div className="flex flex-1">
          <Sidebar
            tournamentSlug={tournamentSlug}
            mobileOpen={mobileNavOpen}
            onMobileClose={() => setMobileNavOpen(false)}
          />
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
            <div className="mx-auto w-full max-w-content px-3 py-4 sm:px-4 lg:px-6 lg:py-6">
              {!meetsRouteRequirement(requirement, { isOwnerOrAdmin, permissions: staffPermissions }) ? (
                <Alert
                  role="alert"
                  tone="danger"
                  title={<span className="text-sm">{t(requirement.kind === "admin" ? "setup.shell.adminAccessTitle" : "setup.shell.permissionAccessTitle")}</span>}
                  className="max-w-2xl"
                >
                  <p>{staffAccessError || t(requirement.kind === "admin" ? "setup.shell.adminAccessNotAuthorized" : "setup.shell.permissionAccessNotAuthorized")}</p>
                  <p className="mt-1">{t(requirement.kind === "admin" ? "setup.shell.adminAccessHelp" : "setup.shell.permissionAccessHelp")}</p>
                </Alert>
              ) : (
                <div
                  className={cn(
                    !themed && "theme-light rounded-lg border border-border bg-surface p-4 text-fg md:p-6"
                  )}
                >
                  {children}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
      {/* Overriding a tournament rule is an administrator decision; assistants are never asked.
          Rendered last so it stacks above a dialog that triggered it (e.g. a release dialog). */}
      {isOwnerOrAdmin && <RuleOverrideHost />}
    </ToastProvider>
  );
}
