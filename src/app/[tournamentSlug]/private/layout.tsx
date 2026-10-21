import React from "react";
import type { Metadata } from "next";
import { NOINDEX_METADATA } from "@/lib/seo/site";

/** Participants' private URLs carry their access key: never indexed (also set by the tournament layout). */
export const metadata: Metadata = NOINDEX_METADATA;

export default function PrivateUrlLayout({ children }: { children: React.ReactNode }) {
  return children;
}
