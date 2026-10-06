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
      <div className="flex flex-1 overflow-hidden">
        <Sidebar tournamentSlug={tournamentSlug} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-white max-w-7xl mx-auto w-full">{children}</main>
      </div>
    </div>
  );
}
