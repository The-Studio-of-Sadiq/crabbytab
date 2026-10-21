import { isTournamentRuleError, type RuleOverride, type TournamentRuleError } from "./stateGuards";

/** Asks the person for a reason to proceed past the error's rules; null when they decline. */
export type RuleOverrideRequester = (error: TournamentRuleError) => Promise<RuleOverride | null>;

let requester: RuleOverrideRequester | null = null;

/**
 * Registers the dialog that asks for override reasons (one per page). Returns the unregister
 * function. Without a registered dialog an overridable rule simply blocks the action.
 */
export function registerRuleOverrideRequester(next: RuleOverrideRequester): () => void {
  requester = next;
  return () => {
    if (requester === next) requester = null;
  };
}

/**
 * Runs a command without an override first. If it is refused only by overridable rules and
 * overrides are allowed, the person is asked for a reason and the command runs again with it.
 * Commands check their rules before changing anything, so the first attempt leaves no trace.
 */
export async function withRuleOverride<T>(
  action: (override?: RuleOverride) => Promise<T>,
  allowOverride: boolean
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!allowOverride || !requester || !isTournamentRuleError(error) || !error.overridable) throw error;
    const override = await requester(error);
    if (!override) throw error;
    return action(override);
  }
}
