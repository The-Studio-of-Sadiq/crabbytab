"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export function SetupShell({
  children,
  maxWidth = "max-w-3xl",
}: {
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const router = useRouter();
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-[#f6f8fa] flex flex-col">
      <header className="bg-[#24292e] text-white py-4 px-6 max-sm:px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/tournaments" className="inline-flex items-center space-x-2">
            <Image src="/crabbytab.svg" alt="" width={32} height={32} className="h-8 w-8" />
            <span className="font-bold">CrabbyTab</span>
          </Link>
          {user && (
            <div className="flex items-center space-x-3 text-xs text-gray-300">
              <span className="hidden sm:inline">{user.email}</span>
              <button
                onClick={async () => {
                  await logout();
                  router.replace("/login");
                }}
                className="inline-flex items-center space-x-1 px-2 py-1 rounded hover:bg-white/10"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </header>
      <main className={`flex-1 w-full ${maxWidth} mx-auto px-4 py-10 max-sm:py-6`}>{children}</main>
    </div>
  );
}
