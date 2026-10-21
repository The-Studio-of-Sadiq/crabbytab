import React from "react";
import type { Metadata } from "next";
import { NOINDEX_METADATA } from "@/lib/seo/site";

/** Account pages are not indexed. */
export const metadata: Metadata = NOINDEX_METADATA;

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
