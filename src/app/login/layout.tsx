import React from "react";
import type { Metadata } from "next";
import { NOINDEX_METADATA } from "@/lib/seo/site";

/** Sign-in pages are not indexed. */
export const metadata: Metadata = NOINDEX_METADATA;

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
