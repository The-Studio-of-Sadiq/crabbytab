import { describe, expect, it } from "vitest";
import { passwordChangeProblem } from "./passwordChange";

describe("passwordChangeProblem", () => {
  it("accepts a new password that meets the rules", () => {
    expect(passwordChangeProblem({ current: "old-secret", next: "new-secret", confirm: "new-secret" })).toBeNull();
  });

  it("reports each problem", () => {
    expect(passwordChangeProblem({ current: "", next: "new-secret", confirm: "new-secret" })).toBe("currentRequired");
    expect(passwordChangeProblem({ current: "old-secret", next: "short", confirm: "short" })).toBe("tooShort");
    expect(passwordChangeProblem({ current: "old-secret", next: "new-secret", confirm: "new-secreT" })).toBe("mismatch");
    expect(passwordChangeProblem({ current: "same-secret", next: "same-secret", confirm: "same-secret" })).toBe("unchanged");
  });
});
