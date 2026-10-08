"use client";

import React from "react";
import { usePathname } from "next/navigation";
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

  const isPublic = pathname?.includes("/public");
  const isParticipantPortal = pathname?.includes("/private/");
  const isDisplay = pathname?.includes("/display");

  if (isPublic || isParticipantPortal) {
    return <>{children}</>;
  }

  if (isDisplay) {
    return <div className="min-h-screen bg-[#1b1f23]">{children}</div>;
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
