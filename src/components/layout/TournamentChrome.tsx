"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";
import { Navbar } from "@/components/layout/Navbar";
import { Sidebar } from "@/components/layout/Sidebar";

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

  if (isPublicRoute) {
    return isDisplay
      ? <div className="min-h-screen bg-[#1b1f23]">{children}</div>
      : <>{children}</>;
  }

  if (authLoading || !user) {
    return <div role="status" className="p-6 text-sm text-gray-600">Redirecting to sign in…</div>;
  }

  if (tournamentLoading || staffAccessLoading) {
    return <div role="status" className="p-6 text-sm text-gray-600">Checking tournament access…</div>;
  }

  if (!tournament || (!isOwnerOrAdmin && !isDataEntryAssistant)) {
    return (
      <div role="alert" className="m-6 max-w-2xl space-y-2 border border-red-200 bg-red-50 p-5 text-sm text-red-900">
        <h1 className="font-semibold">Tournament access denied</h1>
        <p>{staffAccessError || cloudLoadError || "Your account is not assigned to this tournament."}</p>
        <p>Ask a tournament administrator to grant your account access.</p>
      </div>
    );
  }

  if (isAdminRoute && !isOwnerOrAdmin) {
    return (
      <div role="alert" className="m-6 max-w-2xl space-y-2 border border-red-200 bg-red-50 p-5 text-sm text-red-900">
        <h1 className="font-semibold">Tournament access could not be confirmed</h1>
        <p>{staffAccessError || "Your signed-in account is not authorized for this operation."}</p>
        <p className="text-red-800">
          Private URLs, email tools, draws, allocations, and settings require a verified tournament administrator.
          If you own this tournament, check the server Firebase credentials and that your account is listed as its owner or admin.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f8fa] flex flex-col">
      <Navbar tournamentSlug={tournamentSlug} />
      <div className="flex flex-1 overflow-hidden max-md:flex-col max-md:overflow-visible">
        <Sidebar tournamentSlug={tournamentSlug} />
        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6 bg-white max-w-7xl mx-auto w-full max-md:overflow-visible max-sm:px-3 max-sm:py-4">
          {children}
        </main>
      </div>
    </div>
  );
}
