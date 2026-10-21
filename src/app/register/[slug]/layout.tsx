import React from "react";
import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/publicView/robots";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return publicPageMetadata(slug, { homepage: false, path: `/register/${encodeURIComponent(slug)}`, page: "Registration" });
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
