import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { OfflineSupport } from "@/components/OfflineSupport";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CrabbyTab",
  description: "Next.js serverless clone of Tabbycat for British Parliamentary and parliamentary debate tournament tabulation.",
  openGraph: {
    title: "CrabbyTab",
    description: "Next.js serverless clone of Tabbycat for British Parliamentary and parliamentary debate tournament tabulation.",
  },
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
