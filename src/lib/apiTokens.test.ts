import { describe, expect, it } from "vitest";
import { createApiToken, hashApiToken, isApiTokenScope, readBearerToken } from "./apiTokens";

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

  it("recognizes supported read-only scopes", () => {
    expect(isApiTokenScope("read:public")).toBe(true);
    expect(isApiTokenScope("read:draws")).toBe(true);
    expect(isApiTokenScope("write:everything")).toBe(false);
  });
});
