import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { OfflineSupport } from "@/components/OfflineSupport";
import { themeInitScript } from "@/lib/theme";
import { localeInitScript } from "@/lib/i18n/config";
import { I18nProvider } from "@/components/i18n/I18nProvider";

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
    // data-theme, lang and dir are set by the inline scripts before hydration.
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: localeInitScript }} />
      </head>
      <body className={inter.className}>
        <I18nProvider>
          <AuthProvider>
            <OfflineSupport />
            {children}
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
