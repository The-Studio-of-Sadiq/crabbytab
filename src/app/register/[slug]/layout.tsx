import React from "react";
import type { Metadata } from "next";
import { publicRobotsMetadata } from "@/lib/publicView/robots";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return publicRobotsMetadata(slug, false);
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
