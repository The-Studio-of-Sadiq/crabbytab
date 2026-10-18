// @ts-check

/**
 * Builds the Content-Security-Policy for CrabbyTab. Next.js injects inline
 * bootstrap scripts, so script-src needs 'unsafe-inline' until nonces are
 * wired through middleware; the dev server additionally needs 'unsafe-eval'
 * and a websocket for HMR. Firebase Auth and Firestore talk to
 * *.googleapis.com (https + wss) and may frame the auth domain.
 *
 * @param {{ dev?: boolean; authDomain?: string }} [options]
 * @returns {string}
 */
export function buildContentSecurityPolicy({ dev = false, authDomain } = {}) {
  const authOrigin =
    authDomain && /^[a-z0-9.-]+$/i.test(authDomain) ? `https://${authDomain}` : undefined;
  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      "https://*.googleapis.com",
      "wss://*.googleapis.com",
      "https://*.firebaseio.com",
      "wss://*.firebaseio.com",
      ...(dev ? ["ws:"] : []),
    ],
    "frame-src": [
      "'self'",
      "https://*.firebaseapp.com",
      "https://*.web.app",
      ...(authOrigin ? [authOrigin] : []),
    ],
    "frame-ancestors": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "worker-src": ["'self'", "blob:"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${[...new Set(values)].join(" ")}`)
    .join("; ");
}

/**
 * @param {{ dev?: boolean; authDomain?: string }} [options]
 * @returns {Array<{ key: string; value: string }>}
 */
export function buildSecurityHeaders(options = {}) {
  return [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(options) },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}
