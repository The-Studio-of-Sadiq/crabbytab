import type { Metadata } from "next";
import { API_RESOURCES } from "@/lib/apiScopes";
import { RATE_LIMITS } from "@/lib/api/v1/rateLimit";
import { API_ROUTES } from "@/lib/api/v1/routes";
import type { ApiRoute } from "@/lib/api/v1/router";
import { ApiReferenceContent, type ApiReferenceRoute } from "./ApiReferenceContent";

export const metadata: Metadata = {
  title: "API reference · CrabbyTab",
  description: "CrabbyTab tournament REST API: endpoints, scopes, pagination and examples.",
};

function scopeOf(route: ApiRoute): ApiReferenceRoute["scope"] {
  if (route.auth.kind === "none") return { kind: "none" };
  if (route.auth.kind === "participant") return { kind: "participant" };
  const base = `${route.auth.access}:${route.auth.resource}`;
  return { kind: "token", text: route.auth.public ? `${base} · read:public` : base };
}

/** The serializable fields the client content needs (route handlers and schemas stay on the server). */
function toReferenceRoute(route: ApiRoute): ApiReferenceRoute {
  return {
    operationId: route.operationId,
    method: route.method,
    path: route.path,
    summary: route.summary,
    ...(route.description ? { description: route.description } : {}),
    scope: scopeOf(route),
    paginated: Boolean(route.paginated),
  };
}

function groupByTag(routes: readonly ApiRoute[]): Array<[string, ApiRoute[]]> {
  const groups = new Map<string, ApiRoute[]>();
  for (const route of routes) groups.set(route.tag, [...(groups.get(route.tag) ?? []), route]);
  return [...groups].sort(([left], [right]) => left.localeCompare(right));
}

/**
 * Built on the server from the same route definitions as /api/openapi.json. The surrounding text is
 * translated by a small client component (the i18n provider is client-side); route summaries and
 * descriptions stay in English, like the OpenAPI document.
 */
export default function ApiReferencePage() {
  const groups = groupByTag(API_ROUTES).map(([tag, routes]) => ({ tag, routes: routes.map(toReferenceRoute) }));
  return (
    <div className="themed min-h-screen bg-background text-fg">
      <ApiReferenceContent
        groups={groups}
        resources={API_RESOURCES}
        rateLimits={{
          perTokenPerMinute: RATE_LIMITS.perTokenPerMinute,
          writesPerTokenPerHour: RATE_LIMITS.writesPerTokenPerHour,
        }}
      />
    </div>
  );
}
