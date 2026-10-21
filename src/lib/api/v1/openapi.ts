import { API_RESOURCE_LABELS, API_RESOURCES } from "@/lib/apiScopes";
import { RATE_LIMITS } from "./rateLimit";
import type { ApiRoute } from "./router";
import type { JsonSchema } from "./schema";
import { componentSchemasJson } from "./serializers";

/**
 * OpenAPI 3.1 document generated from the route definitions, so the published contract is the
 * one the dispatcher enforces.
 */

const ERROR_RESPONSES: Record<string, string> = {
  "400": "Malformed request (bad JSON, unknown query value, bad cursor).",
  "401": "Missing, invalid or revoked credentials.",
  "403": "The token's scopes do not allow this, or the data is not released to the public.",
  "404": "Tournament or record not found.",
  "409": "A tournament rule blocks the change (`rule_violation`, with `violations`) or the record changed meanwhile (`conflict`).",
  "422": "The request body failed validation (`validation_failed`, with `issues`).",
  "429": "Rate limited; see Retry-After.",
};

function pathParameters(route: ApiRoute): JsonSchema[] {
  const schema = route.params?.json();
  const properties = (schema?.properties ?? {}) as Record<string, JsonSchema>;
  return [...route.path.matchAll(/\{([A-Za-z]+)\}/g)].map(([, name]) => ({
    name,
    in: "path",
    required: true,
    schema: properties[name] ?? { type: "string" },
    ...(typeof properties[name]?.description === "string" ? { description: properties[name].description } : {}),
  }));
}

function queryParameters(route: ApiRoute): JsonSchema[] {
  const schema = route.query?.json();
  const properties = (schema?.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema?.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, property]) => {
    const { description, ...rest } = property;
    return {
      name,
      in: "query",
      required: required.has(name),
      schema: rest,
      ...(typeof description === "string" ? { description } : {}),
    };
  });
}

function security(route: ApiRoute): JsonSchema[] {
  if (route.auth.kind === "none") return [];
  if (route.auth.kind === "participant") return [{ participantKey: [], participantPasscode: [] }];
  // Public reads also work without credentials (the public view, rate-limited per address).
  if (route.auth.public && route.auth.access === "read") return [{ bearerAuth: [] }, {}];
  return [{ bearerAuth: [] }];
}

function scopeNote(route: ApiRoute): string {
  if (route.auth.kind !== "token") return "";
  const scope = `${route.auth.access}:${route.auth.resource}`;
  const scopes = route.auth.access === "read" ? `\`${scope}\` or \`write:${route.auth.resource}\`` : `\`${scope}\``;
  return `\n\n**Scope:** ${scopes}${route.auth.public ? ", or `read:public` or no token at all (public view only)" : ""}.`;
}

function operation(route: ApiRoute): JsonSchema {
  const status = String(route.successStatus ?? (route.method === "POST" ? 201 : 200));
  const errors = Object.fromEntries(
    Object.entries(ERROR_RESPONSES)
      .filter(([code]) => (route.body ? true : code !== "422"))
      .map(([code, description]) => [code, {
        description,
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      }])
  );
  return {
    operationId: route.operationId,
    summary: route.summary,
    description: `${route.description ?? ""}${scopeNote(route)}`.trim() || undefined,
    tags: [route.tag],
    security: security(route),
    parameters: [...pathParameters(route), ...queryParameters(route)],
    ...(route.body ? {
      requestBody: { required: true, content: { "application/json": { schema: route.body.json() } } },
    } : {}),
    responses: {
      [status]: status === "204"
        ? { description: "Done." }
        : { description: "Success.", content: { "application/json": { schema: route.response.json() } } },
      ...errors,
    },
    ...(route.auth.kind === "token" ? { "x-crabbytab-scope": `${route.auth.access}:${route.auth.resource}` } : {}),
  };
}

export function buildOpenApiDocument(routes: readonly ApiRoute[]): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {};
  for (const route of routes) {
    const path = `/api/v1${route.path === "/" ? "" : route.path}`;
    paths[path] = { ...paths[path], [route.method.toLowerCase()]: operation(route) };
  }
  const tags = [...new Set(routes.map((route) => route.tag))].sort().map((name) => ({ name }));
  return {
    openapi: "3.1.0",
    info: {
      title: "CrabbyTab Tournament API",
      version: "1.0.0",
      description: [
        "Read and write tournament data with scoped bearer tokens issued by a tournament administrator",
        "(tournament menu → API access). Tokens belong to one tournament.",
        "",
        "**Scopes.** `read:public` sees exactly what the public site shows. Administrator scopes are",
        "per resource group, `read:<group>` or `write:<group>` (write implies read):",
        ...API_RESOURCES.map((resource) => `- \`${resource}\`: ${API_RESOURCE_LABELS[resource]}`),
        "",
        "**Writes** run the same commands and tournament rules as the tab-room UI. A write blocked by",
        "an overridable rule can be retried with `\"override\": {\"reason\": \"...\"}`; the reason is",
        "recorded in the audit log. Every write bumps the record's `syncVersion`; tab-room devices",
        "pick the change up on their next download, and a device holding an older copy has its",
        "upload archived as a sync conflict instead of overwriting the API's change.",
        "",
        "**Pagination.** List endpoints marked paginated take `limit` (≤ 200) and `cursor`, and",
        "return `{ data, nextCursor }`.",
        "",
        `**Rate limits.** ${RATE_LIMITS.perTokenPerMinute} requests per token per minute and ` +
          `${RATE_LIMITS.perAddressPerMinute} per client address per minute (per server instance), ` +
          `${RATE_LIMITS.writesPerTokenPerHour} writes per token per hour (global).`,
      ].join("\n"),
    },
    servers: [{ url: "/" }],
    tags,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "ct_live_…" },
        participantKey: {
          type: "apiKey",
          in: "header",
          name: "Authorization",
          description: "`Key <private URL key>` from a participant's private URL.",
        },
        participantPasscode: { type: "apiKey", in: "header", name: "X-Passcode" },
      },
      schemas: componentSchemasJson(),
    },
  };
}
