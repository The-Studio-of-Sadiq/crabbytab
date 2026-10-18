import { afterEach, describe, expect, it, vi } from "vitest";

import { registerRuleOverrideRequester, withRuleOverride } from "./ruleOverridePrompt";
import { TournamentRuleError, enforceGuards, type GuardViolation, type RuleOverride } from "./stateGuards";

const soft: GuardViolation = { rule: "draw_released", message: "Published.", overridable: true };
const hard: GuardViolation = { rule: "round_cancelled", message: "Cancelled.", overridable: false };

/** A command that checks its rules the way real commands do. */
function command(violations: GuardViolation[]) {
  return vi.fn(async (override?: RuleOverride) => {
    enforceGuards(violations, override);
    return override?.reason ?? "no override";
  });
}

let unregister: (() => void) | undefined;
afterEach(() => unregister?.());

describe("withRuleOverride", () => {
  it("runs an allowed command once without asking", async () => {
    const ask = vi.fn();
    unregister = registerRuleOverrideRequester(ask);
    const action = command([]);
    await expect(withRuleOverride(action, true)).resolves.toBe("no override");
    expect(action).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks for a reason and retries with it", async () => {
    unregister = registerRuleOverrideRequester(async () => ({ reason: "Late check-in" }));
    const action = command([soft]);
    await expect(withRuleOverride(action, true)).resolves.toBe("Late check-in");
    expect(action).toHaveBeenLastCalledWith({ reason: "Late check-in" });
  });

  it("keeps the refusal when the person cancels", async () => {
    unregister = registerRuleOverrideRequester(async () => null);
    await expect(withRuleOverride(command([soft]), true)).rejects.toBeInstanceOf(TournamentRuleError);
  });

  it("never asks for hard rules, for people who may not override, or without a dialog", async () => {
    const ask = vi.fn(async () => ({ reason: "x" }));
    unregister = registerRuleOverrideRequester(ask);
    await expect(withRuleOverride(command([soft, hard]), true)).rejects.toBeInstanceOf(TournamentRuleError);
    await expect(withRuleOverride(command([soft]), false)).rejects.toBeInstanceOf(TournamentRuleError);
    expect(ask).not.toHaveBeenCalled();
    unregister();
    await expect(withRuleOverride(command([soft]), true)).rejects.toBeInstanceOf(TournamentRuleError);
  });

  it("passes other errors through", async () => {
    unregister = registerRuleOverrideRequester(async () => ({ reason: "x" }));
    await expect(withRuleOverride(async () => { throw new Error("offline"); }, true)).rejects.toThrow("offline");
  });
});
