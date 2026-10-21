import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { OfflineSupport } from "@/components/OfflineSupport";
import { themeInitScript } from "@/lib/theme";
import { localeInitScript } from "@/lib/i18n/config";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { resolveSiteUrl, SITE_DESCRIPTION, SITE_NAME, SITE_OG_IMAGE } from "@/lib/seo/site";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  metadataBase: new URL(resolveSiteUrl()),
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/crabbytab.svg", type: "image/svg+xml" },
      { url: "/crabbytab.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/crabbytab.png", sizes: "512x512" }],
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [SITE_OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [SITE_OG_IMAGE.url],
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
