import { afterEach, describe, expect, it } from "vitest";
import { getGlobalAdminUids, isGlobalAdminUid } from "./globalAdmin";

const originalAdminUids = process.env.FIREBASE_ADMIN_UIDS;

afterEach(() => {
  if (originalAdminUids === undefined) {
    delete process.env.FIREBASE_ADMIN_UIDS;
  } else {
    process.env.FIREBASE_ADMIN_UIDS = originalAdminUids;
  }
});

describe("global administrator configuration", () => {
  it("parses comma- or whitespace-separated Firebase UIDs", () => {
    process.env.FIREBASE_ADMIN_UIDS = " uid-one,uid-two\nuid-three ";

    expect(getGlobalAdminUids()).toEqual(new Set(["uid-one", "uid-two", "uid-three"]));
    expect(isGlobalAdminUid("uid-two")).toBe(true);
    expect(isGlobalAdminUid("assistant")).toBe(false);
  });

  it("does not grant global access when the allowlist is empty", () => {
    delete process.env.FIREBASE_ADMIN_UIDS;

    expect(isGlobalAdminUid("any-user")).toBe(false);
  });
});
