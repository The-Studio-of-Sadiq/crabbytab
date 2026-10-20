import type { GuardViolation } from "@/features/tournament/application/stateGuards";
import type { ValidationIssue } from "./schema";

/**
 * Error codes returned in `error.code`. They distinguish validation failures, tournament-rule
 * violations, permission failures and unexpected errors (AGENTS.md §13).
 */
export type ApiErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "conflict"
  | "rule_violation"
  | "payload_too_large"
  | "rate_limited"
  | "unavailable"
  | "internal";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    issues?: ValidationIssue[];
    violations?: Array<Pick<GuardViolation, "rule" | "message" | "overridable" | "roundId" | "debateId">>;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly extra: Omit<ApiErrorBody["error"], "code" | "message"> = {},
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
    this.name = "ApiError";
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found.`);
export const badRequest = (message: string) => new ApiError(400, "bad_request", message);
export const conflict = (message: string) => new ApiError(409, "conflict", message);
