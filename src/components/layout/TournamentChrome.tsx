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
import { useTournamentLocale } from "@/components/i18n/I18nProvider";
import { RuleOverrideHost } from "@/features/tournament/components/RuleOverrideHost";

/**
 * Tournament pages already rebuilt on the design system (docs/design-system.md).
 * Every other page renders inside a `.theme-light` panel so its hard-coded
 * light colours stay legible when the shell is in dark mode. Add a route here
 * once it has been migrated.
 */
const THEMED_SUBPATHS = new Set(["", "/results", "/results/intake", "/standings", "/schedule"]);

function isThemedRoute(pathname: string | null, tournamentSlug: string) {
  if (!pathname) return false;
  const prefix = `/${tournamentSlug}`;
  if (!pathname.startsWith(prefix)) return false;
  return THEMED_SUBPATHS.has(pathname.slice(prefix.length).replace(/\/$/, ""));
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
    staffAccessLoading,
    staffAccessError,
  } = useTournament();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const isDisplay = pathname?.includes("/display");
  const isPublicRoute = Boolean(pathname && (
    /\/(public|display)(\/|$)/.test(pathname) ||
    /\/private\//.test(pathname)
  ));
  const isAdminRoute = Boolean(pathname && (
    /\/(draw|allocation|config|staff|private-urls|email|break)(\/|$)/.test(pathname) ||
    /\/imports\/(venues|motions|assistants)(\/|$)/.test(pathname) ||
    /\/audit(\/|$)/.test(pathname)
  ));

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
        <p role="status" className="text-[13px] text-fg-muted">Redirecting to sign in…</p>
      </ShellMessage>
    );
  }

  if (tournamentLoading || staffAccessLoading) {
    return (
      <ShellMessage>
        <p role="status" className="text-[13px] text-fg-muted">Checking tournament access…</p>
      </ShellMessage>
    );
  }

  if (!tournament || (!isOwnerOrAdmin && !isDataEntryAssistant)) {
    return (
      <ShellMessage>
        <Alert role="alert" tone="danger" title={<span className="text-sm">Tournament access denied</span>} className="w-full max-w-2xl">
          <p>{staffAccessError || cloudLoadError || "Your account is not assigned to this tournament."}</p>
          <p className="mt-1">Ask a tournament administrator to grant your account access.</p>
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
          className="sr-only z-[90] rounded-md bg-surface px-3 py-2 text-[13px] font-medium text-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-2 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          Skip to content
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
              {isAdminRoute && !isOwnerOrAdmin ? (
                <Alert role="alert" tone="danger" title={<span className="text-sm">Tournament access could not be confirmed</span>} className="max-w-2xl">
                  <p>{staffAccessError || "Your signed-in account is not authorized for this operation."}</p>
                  <p className="mt-1">
                    Private URLs, email tools, draws, allocations, and settings require a verified tournament administrator.
                    If you own this tournament, check the server Firebase credentials and that your account is listed as its owner or admin.
                  </p>
                </Alert>
              ) : (
                <div
                  className={cn(
                    !themed && "theme-light rounded-lg border border-border bg-white p-4 text-gray-900 md:p-6"
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
