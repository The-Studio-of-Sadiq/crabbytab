import { buildSecurityHeaders } from "./securityHeaders.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders({
          dev: process.env.NODE_ENV !== "production",
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        }),
      },
    ];
  },
};

export default nextConfig;
