import { describe, expect, it } from "vitest";

import { shouldRecheckStaffAccess, staffAccessKey, STAFF_ACCESS_RECHECK_MS } from "./staffAccessCheck";

describe("re-checking tournament access", () => {
  const key = staffAccessKey("user-1", "tourn-1");
  const verified = { key, verifiedAt: 1_000_000 };

  it("does not ask the server again on navigations within the re-check window", () => {
    expect(shouldRecheckStaffAccess(verified, key, verified.verifiedAt)).toBe(false);
    expect(shouldRecheckStaffAccess(verified, key, verified.verifiedAt + STAFF_ACCESS_RECHECK_MS - 1)).toBe(false);
  });

  it("asks again once the last successful check is older than the window", () => {
    expect(shouldRecheckStaffAccess(verified, key, verified.verifiedAt + STAFF_ACCESS_RECHECK_MS)).toBe(true);
  });

  it("asks at once for another account or tournament, or with no successful check yet", () => {
    expect(shouldRecheckStaffAccess(verified, staffAccessKey("user-2", "tourn-1"), verified.verifiedAt)).toBe(true);
    expect(shouldRecheckStaffAccess(verified, staffAccessKey("user-1", "tourn-2"), verified.verifiedAt)).toBe(true);
    expect(shouldRecheckStaffAccess(null, key, verified.verifiedAt)).toBe(true);
  });

  it("asks again if the device clock went backwards", () => {
    expect(shouldRecheckStaffAccess(verified, key, verified.verifiedAt - 1)).toBe(true);
  });

  it("has no key without both an account and a tournament", () => {
    expect(staffAccessKey(undefined, "tourn-1")).toBe("");
    expect(staffAccessKey("user-1", undefined)).toBe("");
    expect(shouldRecheckStaffAccess(verified, "", verified.verifiedAt)).toBe(true);
  });
});
