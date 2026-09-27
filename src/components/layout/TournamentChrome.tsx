"use client";

import React, { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
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
  const { user, loading } = useAuth();

  const isPublic = pathname?.includes("/public");
  const isDisplay = pathname?.includes("/display");
  const isStaff = !isPublic;

  useEffect(() => {
    if (loading || !isStaff) return;
    if (!user) {
      const next = pathname || `/${tournamentSlug}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [loading, isStaff, user, pathname, router, tournamentSlug]);

  if (isPublic) {
    return <>{children}</>;
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[#f6f8fa] flex items-center justify-center text-sm text-gray-600">
        {loading ? "Checking sign-in…" : "Redirecting to sign in…"}
      </div>
    );
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
