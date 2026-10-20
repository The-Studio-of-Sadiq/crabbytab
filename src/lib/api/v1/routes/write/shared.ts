import { isTournamentRuleError } from "@/features/tournament/application/stateGuards";
import type { Tournament } from "@/types";
import { ApiError, notFound } from "../../errors";
import type { RouteContext } from "../../router";
import { s } from "../../schema";
import { ApiCommandSession } from "../../session";
import { SessionTabRoom } from "../../tabRoom";

export type WriteContext = RouteContext<unknown, unknown, unknown>;

/** Lets a write proceed past overridable tournament rules; the reason is audited. */
export const overrideSchema = s.optional(s.object({
  reason: s.string({ min: 1, max: 500, description: "Why the tab room proceeds anyway; recorded in the audit log." }),
}, { description: "Proceed past overridable rule violations (409 rule_violation with overridable: true)." }));

/** Optimistic concurrency: the write fails with 409 conflict when the record's syncVersion differs. */
export const expectedVersionSchema = s.optional(s.integer({
  min: 0,
  description: "The record's syncVersion as last read; the write is refused (409) when it has changed since.",
}));

export function apiActorId(context: WriteContext): string {
  if (!context.token) throw new ApiError(401, "unauthenticated", "A token is required.");
  return `api-token:${context.token.id}`;
}

export function apiActorName(context: WriteContext): string {
  return `API token “${context.token?.name ?? "API"}”`;
}

/**
 * Runs a write atomically: the tab-room command runs in a session over one Firestore
 * transaction and its changes are committed only if it succeeds.
 */
export async function runWrite<T>(
  context: WriteContext,
  /** May return a function: it runs after the commit, so responses show the stored versions. */
  operation: (tabRoom: SessionTabRoom, session: ApiCommandSession) => Promise<T | (() => T)>
): Promise<T> {
  const store = context.store;
  const token = context.token;
  if (!store || !token) throw new ApiError(403, "forbidden", "Writes need an administrator token.");
  return store.transaction(async (transaction) => {
    const tournament = await transaction.getTournament();
    if (!tournament) throw notFound("Tournament");
    const session = new ApiCommandSession(
      transaction,
      tournament as unknown as Tournament,
      { tokenId: token.id, tokenName: token.name, requestId: context.requestId },
      context.now
    );
    const tabRoom = new SessionTabRoom(session, apiActorId(context));
    let result: T | (() => T);
    try {
      result = await operation(tabRoom, session);
    } catch (error) {
      throw commandError(error);
    }
    await session.commit();
    return typeof result === "function" ? (result as () => T)() : result;
  });
}

/**
 * Commands report refusals that are not rule violations as errors of their own: named ones
 * (e.g. DrawHasResultsError) become 409, plain `Error`s with a user-facing message (e.g. "That
 * round no longer exists.") become 422. Rule violations, API errors and infrastructure errors
 * (which carry a `code`) pass through.
 */
export function commandError(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof ApiError || isTournamentRuleError(error)) return error;
  if ("code" in error || error.name === "SchemaValidationError") return error;
  if (error.name === "DrawHasResultsError" || error.name === "RoundChangedDuringComputeError") {
    return new ApiError(409, "conflict", error.message);
  }
  if (error.constructor === Error) return new ApiError(422, "validation_failed", error.message);
  return error;
}

export function requireFound<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw notFound(what);
  return value;
}
