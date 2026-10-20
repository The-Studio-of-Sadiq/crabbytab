import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Staff invitations and registration live under `tournaments/{id}/serverOnly`, which only server
 * routes (Admin SDK) may touch. There is no rules emulator in CI, so this keeps the rules text in
 * step: the catch-all tournament rule must exclude the namespace and an explicit rule deny it.
 */
const rules = readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");

describe("server-only Firestore namespace", () => {
  it("is excluded from the administrator catch-all rule for reads, creates, deletes and updates", () => {
    const catchAll = rules.slice(rules.indexOf("match /{collection}/{document} {"), rules.indexOf("match /staff/{staffId}"));
    expect(catchAll.match(/collection != "serverOnly" && isTournamentAdmin\(\)/g)).toHaveLength(3);
  });

  it("denies every client read and write below it", () => {
    expect(rules).toMatch(/match \/serverOnly\/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
  });
});
