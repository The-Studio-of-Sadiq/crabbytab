"use client";

import React from "react";
import { usePathname } from "next/navigation";
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
  const { user } = useAuth();
  const { isOwnerOrAdmin, staffAccessLoading } = useTournament();

  const isPublic = pathname?.includes("/public");
  const isParticipantPortal = pathname?.includes("/private/");
  const isDisplay = pathname?.includes("/display");
  const isAdminRoute = Boolean(pathname && (
    /\/(draw|allocation|config|staff|private-urls|email|break)(\/|$)/.test(pathname) ||
    /\/imports\/(venues|motions)(\/|$)/.test(pathname) ||
    /\/audit(\/|$)/.test(pathname)
  ));

  if (isPublic || isParticipantPortal) {
    return <>{children}</>;
  }

  if (isDisplay) {
    return <div className="min-h-screen bg-[#1b1f23]">{children}</div>;
  }

  if (user && isAdminRoute && staffAccessLoading) {
    return <div role="status" className="p-6 text-sm text-gray-600">Checking tournament access…</div>;
  }

  if (user && isAdminRoute && !isOwnerOrAdmin) {
    return <div role="alert" className="p-6 text-sm text-red-700">You do not have access to this tournament operation.</div>;
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
