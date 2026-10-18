import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, buildSecurityHeaders } from "../../securityHeaders.mjs";

function directives(policy: string): Map<string, string[]> {
  return new Map(policy.split("; ").map((directive) => {
    const [name, ...values] = directive.split(" ");
    return [name, values];
  }));
}

describe("security headers", () => {
  it("allows Firebase Auth/Firestore and forbids framing by other sites", () => {
    const policy = directives(buildContentSecurityPolicy({ authDomain: "crabbytab.firebaseapp.com" }));
    expect(policy.get("connect-src")).toEqual(expect.arrayContaining([
      "'self'", "https://*.googleapis.com", "wss://*.googleapis.com",
    ]));
    expect(policy.get("frame-src")).toContain("https://crabbytab.firebaseapp.com");
    expect(policy.get("frame-ancestors")).toEqual(["'self'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("only relaxes eval and websockets for the dev server", () => {
    const policy = directives(buildContentSecurityPolicy({ dev: true }));
    expect(policy.get("script-src")).toContain("'unsafe-eval'");
    expect(policy.get("connect-src")).toContain("ws:");
  });

  it("ignores a malformed auth domain", () => {
    const policy = directives(buildContentSecurityPolicy({ authDomain: "evil.com; script-src *" }));
    expect(policy.get("frame-src")).not.toContain("https://evil.com;");
    expect(policy.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("sends the standard hardening headers", () => {
    const headers = new Map(buildSecurityHeaders().map(({ key, value }) => [key, value]));
    expect(headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});
