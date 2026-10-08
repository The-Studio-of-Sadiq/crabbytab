import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { OfflineSupport } from "@/components/OfflineSupport";

const inter = Inter({ subsets: ["latin"] });
const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  title: "CrabbyTab",
  description: "Next.js serverless clone of Tabbycat for British Parliamentary and parliamentary debate tournament tabulation.",
  metadataBase: new URL(siteUrl),
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/crabbytab.svg", type: "image/svg+xml" },
      { url: "/crabbytab.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/crabbytab.png", sizes: "512x512" }],
  },
  openGraph: {
    title: "CrabbyTab",
    description: "Next.js serverless clone of Tabbycat for British Parliamentary and parliamentary debate tournament tabulation.",
    images: [{ url: "/og-image.png", width: 1254, height: 834, alt: "CrabbyTab" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "CrabbyTab",
    description: "Offline-first parliamentary debate tournament tabulation.",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1220",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <OfflineSupport />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
