import { describe, expect, it } from "vitest";
import {
  createApiToken,
  hashApiToken,
  isApiTokenScope,
  isPublicOnlyToken,
  parseRequestedScopes,
  readBearerToken,
  scopesAllow,
  storedTokenScopes,
} from "./apiTokens";

describe("API token helpers", () => {
  it("creates random credentials with a stable non-reversible digest", () => {
    const first = createApiToken();
    const second = createApiToken();
    expect(first).toMatch(/^ct_live_[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    expect(hashApiToken(first)).toHaveLength(64);
    expect(hashApiToken(first)).toBe(hashApiToken(first));
    expect(hashApiToken(first)).not.toContain(first);
  });

  it("accepts only well-formed bearer credentials", () => {
    const token = createApiToken();
    expect(readBearerToken(`Bearer ${token}`)).toBe(token);
    expect(readBearerToken(`bearer ${token}`)).toBe(token);
    expect(readBearerToken(`Bearer ${token}x`)).toBeNull();
    expect(readBearerToken(token)).toBeNull();
  });

  it("recognizes supported scopes", () => {
    expect(isApiTokenScope("read:public")).toBe(true);
    expect(isApiTokenScope("read:draws")).toBe(true);
    expect(isApiTokenScope("write:results")).toBe(true);
    expect(isApiTokenScope("write:standings")).toBe(false);
    expect(isApiTokenScope("write:everything")).toBe(false);
  });

  it("reads legacy single-scope and current multi-scope tokens", () => {
    expect(storedTokenScopes({ scope: "read:draws" })).toEqual(["read:draws"]);
    expect(storedTokenScopes({ scopes: ["read:rounds", "bogus", "read:rounds"] })).toEqual(["read:rounds"]);
    expect(storedTokenScopes({})).toEqual([]);
  });

  it("validates requested scopes", () => {
    expect(parseRequestedScopes("read:public")).toEqual(["read:public"]);
    expect(parseRequestedScopes(["write:draws", "read:teams"])).toBeNull();
    expect(parseRequestedScopes([])).toBeNull();
    expect(parseRequestedScopes(["read:public", "read:draws"])).toBeNull();
    expect(parseRequestedScopes(["write:draws", "write:draws"])).toEqual(["write:draws"]);
  });

  it("lets write imply read, never the reverse", () => {
    expect(scopesAllow(["write:draws"], "draws", "read")).toBe(true);
    expect(scopesAllow(["read:draws"], "draws", "write")).toBe(false);
    expect(scopesAllow(["write:draws"], "results", "read")).toBe(false);
    expect(isPublicOnlyToken(["read:public"])).toBe(true);
    expect(isPublicOnlyToken(["read:draws"])).toBe(false);
  });
});
