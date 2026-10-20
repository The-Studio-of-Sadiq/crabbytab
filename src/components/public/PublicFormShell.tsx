"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { cn } from "@/components/ui/cn";

/** Frame for public, signed-out forms (staff invitations, self-registration). */
export function PublicFormShell({
  children,
  width = "md",
}: {
  children: React.ReactNode;
  width?: "md" | "lg";
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3 max-sm:px-4">
        <Link href="/" className="inline-flex items-center gap-2 text-fg">
          <Image src="/crabbytab.svg" alt="" width={28} height={28} className="h-7 w-7" />
          <span className="font-semibold">CrabbyTab</span>
        </Link>
        <LanguageSwitcher />
      </header>
      <main className={cn("mx-auto w-full flex-1 px-4 py-10 max-sm:py-6", width === "md" ? "max-w-md" : "max-w-3xl")}>
        {children}
      </main>
    </div>
  );
}
