import { createHash, randomUUID } from "node:crypto";
import { hashApiToken, isPublicOnlyToken, readBearerToken, scopesAllow, storedTokenScopes } from "@/lib/apiTokens";
import { passcodesMatch } from "@/lib/passcode";
import type { PublicViewReader } from "@/lib/publicView/store";
import { isTournamentRuleError } from "@/features/tournament/application/stateGuards";
import type { Tournament } from "@/types";
import { createAdminData, createPublicData, type TournamentData } from "./data";
import { ApiError, type ApiErrorBody } from "./errors";
import { MemoryRateLimiter, RATE_LIMITS } from "./rateLimit";
import {
  isRouteResponse,
  matchPath,
  type ApiRoute,
  type ApiTokenIdentity,
  type HttpMethod,
  type ParticipantIdentity,
  type RouteContext,
} from "./router";
import { SchemaValidationError, type JsonSchema } from "./schema";
import { isActive, type ApiStore, type StoredRecord, type TournamentStore } from "./store";

export interface ApiServices {
  store: ApiStore;
  /** The published public view of a tournament (throws PublicViewError-like `{status}` errors). */
  publicView(slug: string): Promise<PublicViewReader>;
  routes: readonly ApiRoute[];
  limiter: MemoryRateLimiter;
  now(): Date;
}

export interface ApiRequest {
  method: string;
  /** Path below /api/v1, e.g. "/tournaments/demo/teams". */
  path: string;
  searchParams: URLSearchParams;
  headers: Pick<Headers, "get">;
  text(): Promise<string>;
  clientAddress: string;
}

export interface ApiResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

const BODY_METHODS = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
/** lastUsedAt is refreshed at most this often, so reads do not each cost a write. */
const TOKEN_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

function literalSegments(template: string): number {
  return template.split("/").filter((part) => part && !part.startsWith("{")).length;
}

function hashed(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

function rateLimited(retryAfterSeconds: number, message = "Too many API requests. Try again later."): ApiError {
  return new ApiError(429, "rate_limited", message, {}, { "Retry-After": String(retryAfterSeconds) });
}

/** Query strings arrive as text; convert each to the type its schema declares before validating. */
export function coerceQuery(searchParams: URLSearchParams, schema: JsonSchema | undefined): Record<string, unknown> {
  const properties = (schema?.properties ?? {}) as Record<string, JsonSchema>;
  const result: Record<string, unknown> = {};
  for (const [key, raw] of searchParams.entries()) {
    if (key in result) throw new ApiError(400, "bad_request", `Query parameter ${key} is given more than once.`);
    const type = properties[key]?.type;
    if ((type === "integer" || type === "number") && raw.trim() !== "" && Number.isFinite(Number(raw))) {
      result[key] = Number(raw);
    } else if (type === "boolean" && (raw === "true" || raw === "false")) {
      result[key] = raw === "true";
    } else {
      result[key] = raw;
    }
  }
  return result;
}

async function readJsonBody(request: ApiRequest, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, "payload_too_large", `Request body must be at most ${maxBytes} bytes.`);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new ApiError(413, "payload_too_large", `Request body must be at most ${maxBytes} bytes.`);
  }
  if (text.trim() === "") return undefined;
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    throw new ApiError(415 as number, "bad_request", "Send the request body as application/json.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "bad_request", "Request body is not valid JSON.");
  }
}

function errorResult(error: unknown, requestId: string): ApiResult {
  const headers: Record<string, string> = {};
  let apiError: ApiError;
  if (error instanceof ApiError) {
    apiError = error;
    Object.assign(headers, error.headers);
  } else if (error instanceof SchemaValidationError) {
    apiError = new ApiError(422, "validation_failed", "The request is not valid.", { issues: error.issues });
  } else if (isTournamentRuleError(error)) {
    // The same rules the tab-room UI enforces (stateGuards.ts); overridable ones can be retried with
    // an `override.reason`, which is recorded in the audit log.
    apiError = new ApiError(409, "rule_violation", error.message, {
      violations: error.violations.map(({ rule, message, overridable, roundId, debateId }) => ({
        rule,
        message,
        overridable,
        ...(roundId ? { roundId } : {}),
        ...(debateId ? { debateId } : {}),
      })),
    });
  } else if (error !== null && typeof error === "object" && typeof (error as { status?: unknown }).status === "number" &&
    (error as { status: number }).status === 404) {
    apiError = new ApiError(404, "not_found", "Tournament not found.");
  } else {
    console.error(`API request ${requestId} failed:`, error);
    apiError = new ApiError(500, "internal", "The request could not be completed.");
  }
  return { status: apiError.status, body: apiError.body() satisfies ApiErrorBody, headers };
}

interface Authenticated {
  tournament: Tournament;
  data: TournamentData;
  store: TournamentStore | null;
  token: ApiTokenIdentity | null;
  participant: ParticipantIdentity | null;
}

async function authenticateToken(
  route: ApiRoute & { auth: { kind: "token" } },
  request: ApiRequest,
  slug: string,
  services: ApiServices,
  now: Date
): Promise<Authenticated> {
  const bearer = readBearerToken(request.headers.get("authorization"));
  if (!bearer) throw new ApiError(401, "unauthenticated", "A valid API bearer token is required.", {}, { "WWW-Authenticate": "Bearer" });
  const tournamentRecord = await services.store.findTournamentBySlug(slug);
  if (!tournamentRecord) throw new ApiError(404, "not_found", "Tournament not found.");
  const tokenRecord = await services.store.findToken(tournamentRecord.id, hashApiToken(bearer));
  const scopes = tokenRecord ? storedTokenScopes(tokenRecord) : [];
  if (!tokenRecord || scopes.length === 0) {
    throw new ApiError(401, "unauthenticated", "API token is invalid or has been revoked.", {}, { "WWW-Authenticate": "Bearer" });
  }
  const perToken = services.limiter.consume(`token:${tokenRecord.id}`, RATE_LIMITS.perTokenPerMinute, 60_000, now.getTime());
  if (!perToken.allowed) throw rateLimited(perToken.retryAfterSeconds);

  const token: ApiTokenIdentity = {
    id: tokenRecord.id,
    name: typeof tokenRecord.name === "string" ? tokenRecord.name : "API token",
    scopes,
    publicOnly: isPublicOnlyToken(scopes),
  };
  const lastUsed = typeof tokenRecord.lastUsedAt === "string" ? Date.parse(tokenRecord.lastUsedAt) : NaN;
  if (!Number.isFinite(lastUsed) || now.getTime() - lastUsed > TOKEN_TOUCH_INTERVAL_MS) {
    services.store.touchToken(tournamentRecord.id, tokenRecord.id, now.toISOString()).catch((error: unknown) => {
      console.warn("Could not record API token use:", error instanceof Error ? error.message : error);
    });
  }

  const { resource, access } = route.auth;
  if (token.publicOnly) {
    if (!route.auth.public || access !== "read") {
      throw new ApiError(403, "forbidden", "This endpoint needs an administrator token; read:public tokens only see the public site's data.");
    }
    const reader = await services.publicView(slug);
    const publicTournament = await reader.readBase("tournament");
    if (!publicTournament || typeof publicTournament !== "object") throw new ApiError(404, "not_found", "Tournament not found.");
    return {
      tournament: publicTournament as Tournament,
      data: createPublicData(reader),
      store: null,
      token,
      participant: null,
    };
  }
  if (!scopesAllow(scopes, resource, access)) {
    throw new ApiError(403, "forbidden", `This token lacks the ${access}:${resource} scope.`);
  }
  const store = services.store.forTournament(tournamentRecord.id);
  return {
    tournament: tournamentRecord as unknown as Tournament,
    data: createAdminData(store),
    store,
    token,
    participant: null,
  };
}

/**
 * `/me`: a participant identifies with their private URL key (`Authorization: Key <key>`) and
 * passcode (`X-Passcode`), exactly the two secrets the private portal asks for. Lookups are
 * throttled per client address so keys cannot be guessed.
 */
async function authenticateParticipant(
  request: ApiRequest,
  slug: string,
  services: ApiServices,
  now: Date
): Promise<Authenticated> {
  const key = /^Key ([A-Za-z0-9_-]{1,128})$/.exec(request.headers.get("authorization")?.trim() ?? "")?.[1];
  const passcode = request.headers.get("x-passcode")?.trim() ?? "";
  if (!key || passcode.length === 0 || passcode.length > 128) {
    throw new ApiError(401, "unauthenticated", "Send your private URL key as `Authorization: Key <key>` and your passcode as `X-Passcode`.");
  }
  const tournamentRecord = await services.store.findTournamentBySlug(slug);
  if (!tournamentRecord) throw new ApiError(404, "not_found", "Tournament not found.");
  const limit = await services.store.consumeHourlyRateLimit(
    `me:${tournamentRecord.id}:${request.clientAddress}`,
    RATE_LIMITS.participantLookupsPerAddressPerHour,
    now.getTime()
  );
  if (!limit.allowed) throw rateLimited(limit.retryAfterSeconds, "Too many private key attempts. Try again later.");
  const store = services.store.forTournament(tournamentRecord.id);
  const [teams, adjudicators] = await Promise.all([
    store.query("teams", { filters: [{ field: "privateUrlKey", op: "==", value: key }], limit: 2 }),
    store.query("adjudicators", { filters: [{ field: "privateUrlKey", op: "==", value: key }], limit: 2 }),
  ]);
  const candidates: Array<{ type: "team" | "adjudicator"; record: StoredRecord }> = [
    ...teams.filter(isActive).map((record) => ({ type: "team" as const, record })),
    ...adjudicators.filter(isActive).map((record) => ({ type: "adjudicator" as const, record })),
  ];
  const match = candidates.length === 1 ? candidates[0] : undefined;
  // Unknown key and wrong passcode get the same answer, so valid keys cannot be enumerated.
  if (!match || !passcodesMatch(match.record.privatePasscode, passcode)) {
    throw new ApiError(401, "unauthenticated", "Invalid private URL key or passcode.");
  }
  return {
    tournament: tournamentRecord as unknown as Tournament,
    data: createAdminData(store),
    store: null,
    token: null,
    participant: {
      type: match.type,
      id: match.record.id,
      name: typeof match.record.name === "string" ? match.record.name : "",
    },
  };
}

export async function handleApiRequest(request: ApiRequest, services: ApiServices): Promise<ApiResult> {
  const requestId = randomUUID();
  const now = services.now();
  const baseHeaders: Record<string, string> = {
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": requestId,
  };
  const withHeaders = (result: ApiResult): ApiResult => ({ ...result, headers: { ...baseHeaders, ...result.headers } });

  try {
    const method = request.method.toUpperCase() as HttpMethod;
    const matching = services.routes
      .map((route) => ({ route, params: matchPath(route.path, request.path) }))
      .filter((candidate): candidate is { route: ApiRoute; params: Record<string, string> } => candidate.params !== null)
      // "/teams/standings" must win over "/teams/{teamId}": prefer the template with more literal segments.
      .sort((left, right) => literalSegments(right.route.path) - literalSegments(left.route.path));
    if (matching.length === 0) throw new ApiError(404, "not_found", "No such API endpoint.");
    const specificity = literalSegments(matching[0].route.path);
    const found = matching.find((candidate) => candidate.route.method === method);
    if (!found) {
      const allow = [...new Set(matching.filter((candidate) => literalSegments(candidate.route.path) === specificity).map((candidate) => candidate.route.method))].join(", ");
      throw new ApiError(405, "method_not_allowed", `Use ${allow} for this endpoint.`, {}, { Allow: allow });
    }
    const { route } = found;

    const address = services.limiter.consume(
      `address:${hashed(request.clientAddress)}`,
      RATE_LIMITS.perAddressPerMinute,
      60_000,
      now.getTime()
    );
    if (!address.allowed) throw rateLimited(address.retryAfterSeconds);

    let params: unknown = found.params;
    if (route.params) {
      try {
        params = route.params.parse(found.params);
      } catch (error) {
        if (error instanceof SchemaValidationError) throw new ApiError(404, "not_found", "No such API endpoint or record.");
        throw error;
      }
    }
    const query = route.query ? route.query.parse(coerceQuery(request.searchParams, route.query.json())) : {};
    let body: unknown;
    if (BODY_METHODS.has(method)) {
      const raw = await readJsonBody(request, route.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
      if (route.body) {
        if (raw === undefined) throw new ApiError(400, "bad_request", "A JSON request body is required.");
        body = route.body.parse(raw);
      } else if (raw !== undefined) {
        throw new ApiError(400, "bad_request", "This endpoint takes no request body.");
      }
    }

    const slug = (params as { slug?: string }).slug;
    let authenticated: Authenticated | null = null;
    if (route.auth.kind !== "none") {
      if (!slug) throw new Error(`Route ${route.operationId} needs a {slug} parameter.`);
      authenticated = route.auth.kind === "participant"
        ? await authenticateParticipant(request, slug, services, now)
        : await authenticateToken(route as ApiRoute & { auth: { kind: "token" } }, request, slug, services, now);
    }
    if (method !== "GET" && authenticated?.token) {
      const writes = await services.store.consumeHourlyRateLimit(
        `token-write:${authenticated.token.id}`,
        RATE_LIMITS.writesPerTokenPerHour,
        now.getTime()
      );
      if (!writes.allowed) throw rateLimited(writes.retryAfterSeconds, "This token has made too many writes. Try again later.");
    }

    const context: RouteContext<unknown, unknown, unknown> = {
      params,
      query,
      body,
      tournament: authenticated?.tournament as Tournament,
      data: authenticated?.data as TournamentData,
      store: authenticated?.store ?? null,
      token: authenticated?.token ?? null,
      participant: authenticated?.participant ?? null,
      now,
      requestId,
    };
    const result = await route.handler(context);
    const response = isRouteResponse(result) ? result : { body: result };
    const status = response.status ?? route.successStatus ?? (method === "POST" ? 201 : 200);
    return withHeaders({ status, body: status === 204 ? null : response.body, headers: response.headers ?? {} });
  } catch (error) {
    return withHeaders(errorResult(error, requestId));
  }
}
