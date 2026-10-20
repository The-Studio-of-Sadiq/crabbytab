import type { ApiAccess, ApiResource, ApiTokenScope } from "@/lib/apiScopes";
import type { Tournament } from "@/types";
import type { TournamentData } from "./data";
import { s, type Schema } from "./schema";
import type { TournamentStore } from "./store";

/**
 * Route definitions. Each route declares its path, the scope it needs, and schemas for its path
 * parameters, query, body and response. The dispatcher (http.ts) enforces them and the OpenAPI
 * document (openapi.ts) is generated from them.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiTokenIdentity {
  id: string;
  name: string;
  scopes: ApiTokenScope[];
  publicOnly: boolean;
}

export interface ParticipantIdentity {
  type: "team" | "adjudicator";
  id: string;
  name: string;
}

export interface RouteContext<P, Q, B> {
  params: P;
  query: Q;
  body: B;
  /** The tournament: the live record for administrator tokens, the public projection's for public ones. */
  tournament: Tournament;
  data: TournamentData;
  token: ApiTokenIdentity | null;
  participant: ParticipantIdentity | null;
  /** Live store; only for administrator tokens (writes always go through it). */
  store: TournamentStore | null;
  now: Date;
  /** Request id, echoed in X-Request-Id and recorded with written audit events. */
  requestId: string;
}

export type RouteAuth =
  /** An administrator scope; `public: true` also admits read:public tokens (public view). */
  | { kind: "token"; resource: ApiResource; access: ApiAccess; public?: boolean }
  /** A participant's private URL key and passcode (the `/me` endpoint). */
  | { kind: "participant" }
  | { kind: "none" };

export interface RouteResponse<R> {
  status?: number;
  body: R;
  headers?: Record<string, string>;
}

export interface ApiRoute<P = unknown, Q = unknown, B = unknown> {
  method: HttpMethod;
  /** OpenAPI-style template relative to /api/v1, e.g. "/tournaments/{slug}/teams/{teamId}". */
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tag: string;
  auth: RouteAuth;
  params?: Schema<P>;
  query?: Schema<Q>;
  body?: Schema<B>;
  /** Response body schema for the success status. */
  response: Schema<unknown>;
  successStatus?: number;
  /** List endpoint with `limit` / `cursor` pagination. */
  paginated?: boolean;
  /** Request bodies larger than this are refused with 413 (default 256 KB). */
  maxBodyBytes?: number;
  handler(context: RouteContext<P, Q, B>): Promise<RouteResponse<unknown> | unknown>;
}

/** Helper that keeps each route's handler typed by its own schemas. */
export function defineRoute<P = Record<string, never>, Q = Record<string, never>, B = undefined>(
  route: ApiRoute<P, Q, B>
): ApiRoute {
  return route as unknown as ApiRoute;
}

export function isRouteResponse(value: unknown): value is RouteResponse<unknown> {
  return value !== null && typeof value === "object" && "body" in value &&
    Object.keys(value).every((key) => key === "body" || key === "status" || key === "headers");
}

/* ------------------------------------------------------------------------ */
/* Path matching                                                             */
/* ------------------------------------------------------------------------ */

const PARAM = /^\{([A-Za-z]+)\}$/;

export function matchPath(template: string, path: string): Record<string, string> | null {
  const templateParts = template.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (templateParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < templateParts.length; index += 1) {
    const param = PARAM.exec(templateParts[index]);
    let part: string;
    try {
      part = decodeURIComponent(pathParts[index]);
    } catch {
      return null;
    }
    if (param) params[param[1]] = part;
    else if (templateParts[index] !== part) return null;
  }
  return params;
}

/* ------------------------------------------------------------------------ */
/* Shared parameter schemas                                                  */
/* ------------------------------------------------------------------------ */

export const slugParam = s.string({ min: 1, max: 40, pattern: /^[a-z0-9-]+$/, description: "Tournament slug." });
export const idParam = (description: string) =>
  s.string({ min: 1, max: 128, pattern: /^[A-Za-z0-9_.:-]+$/, description });

export const pageQueryShape = {
  limit: s.optional(s.integer({ min: 1, max: 200, description: "Page size (default 50, at most 200)." })),
  cursor: s.optional(s.string({ min: 1, max: 200, pattern: /^[A-Za-z0-9_-]+$/, description: "`nextCursor` from the previous page." })),
};

export const DEFAULT_PAGE_SIZE = 50;

export function pageRequest(query: { limit?: number; cursor?: string }) {
  return { limit: query.limit ?? DEFAULT_PAGE_SIZE, cursor: query.cursor };
}

export function pageOf(item: Schema<unknown>) {
  return s.object({
    data: s.array(item, { max: 200 }),
    nextCursor: s.nullable(s.string({ description: "Cursor for the next page; null on the last page." })),
  });
}

export function listOf(item: Schema<unknown>) {
  return s.object({ data: s.array(item, { max: 10_000 }) });
}
