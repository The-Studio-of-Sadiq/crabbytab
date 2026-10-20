import type { Metadata } from "next";
import { API_RESOURCE_LABELS, API_RESOURCES } from "@/lib/apiScopes";
import { RATE_LIMITS } from "@/lib/api/v1/rateLimit";
import { API_ROUTES } from "@/lib/api/v1/routes";
import type { ApiRoute } from "@/lib/api/v1/router";

export const metadata: Metadata = {
  title: "API reference · CrabbyTab",
  description: "CrabbyTab tournament REST API: endpoints, scopes, pagination and examples.",
};

const METHOD_STYLES: Record<ApiRoute["method"], string> = {
  GET: "bg-blue-100 text-blue-900",
  POST: "bg-emerald-100 text-emerald-900",
  PUT: "bg-amber-100 text-amber-900",
  PATCH: "bg-violet-100 text-violet-900",
  DELETE: "bg-red-100 text-red-900",
};

function scopeText(route: ApiRoute): string {
  if (route.auth.kind === "none") return "No authentication";
  if (route.auth.kind === "participant") return "Private URL key + passcode";
  const base = `${route.auth.access}:${route.auth.resource}`;
  return route.auth.public ? `${base} · read:public` : base;
}

function groupByTag(routes: readonly ApiRoute[]): Array<[string, ApiRoute[]]> {
  const groups = new Map<string, ApiRoute[]>();
  for (const route of routes) groups.set(route.tag, [...(groups.get(route.tag) ?? []), route]);
  return [...groups].sort(([left], [right]) => left.localeCompare(right));
}

/** Server-rendered from the same route definitions as /api/openapi.json; ships no client JavaScript. */
export default function ApiReferencePage() {
  const groups = groupByTag(API_ROUTES);
  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-8 text-gray-900">
      <header className="space-y-2 border-b border-gray-200 pb-6">
        <h1 className="text-2xl font-bold">CrabbyTab API reference</h1>
        <p className="text-sm text-gray-700">
          A REST API for one tournament at a time, with bearer tokens issued by its administrators (tournament
          menu → <strong>API access</strong>). Machine-readable contract:{" "}
          <a className="text-blue-700 underline" href="/api/openapi.json">/api/openapi.json</a> (OpenAPI 3.1).
        </p>
        <nav aria-label="Endpoint groups" className="flex flex-wrap gap-2 pt-2 text-xs">
          {groups.map(([tag]) => (
            <a key={tag} href={`#${tag}`} className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50">{tag}</a>
          ))}
        </nav>
      </header>

      <section className="space-y-3 text-sm text-gray-700">
        <h2 className="text-lg font-semibold text-gray-900">Authentication and scopes</h2>
        <pre className="overflow-x-auto rounded bg-gray-950 p-3 text-xs text-gray-100">{`curl -H "Authorization: Bearer $CRABBYTAB_API_TOKEN" \\
  "https://YOUR_CRABBYTAB_HOST/api/v1/tournaments/YOUR_SLUG/rounds/1/pairings"`}</pre>
        <p>
          <code className="font-mono">read:public</code> sees exactly what the public site shows. Administrator tokens
          get <code className="font-mono">read:&lt;area&gt;</code> or <code className="font-mono">write:&lt;area&gt;</code>{" "}
          (write implies read) for each area:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {API_RESOURCES.map((resource) => (
            <li key={resource}><code className="font-mono">{resource}</code>: {API_RESOURCE_LABELS[resource]}</li>
          ))}
        </ul>
        <p>
          Writes use the same commands and tournament rules as the tab room. A change blocked by an overridable rule
          returns <code className="font-mono">409 rule_violation</code>; retry with{" "}
          <code className="font-mono">{`"override": {"reason": "..."}`}</code> to proceed (the reason is audited).
          List endpoints take <code className="font-mono">limit</code> and <code className="font-mono">cursor</code> and
          return <code className="font-mono">{"{ data, nextCursor }"}</code>. Limits: {RATE_LIMITS.perTokenPerMinute} requests
          per token per minute, {RATE_LIMITS.writesPerTokenPerHour} writes per token per hour.
        </p>
        <p>
          More examples: <a className="text-blue-700 underline" href="https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/api.md">docs/api.md</a>.
        </p>
      </section>

      {groups.map(([tag, routes]) => (
        <section key={tag} id={tag} className="space-y-3">
          <h2 className="text-lg font-semibold capitalize">{tag.replace(/-/g, " ")}</h2>
          <ul className="space-y-2">
            {routes.map((route) => (
              <li key={route.operationId} className="rounded border border-gray-200 bg-white p-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-bold ${METHOD_STYLES[route.method]}`}>{route.method}</span>
                  <code className="break-all font-mono text-sm">/api/v1{route.path === "/" ? "" : route.path}</code>
                </p>
                <p className="mt-1 text-sm font-medium">{route.summary}</p>
                {route.description && <p className="mt-1 text-sm text-gray-600">{route.description}</p>}
                <p className="mt-1 text-xs text-gray-500">
                  Scope: <span className="font-mono">{scopeText(route)}</span>
                  {route.paginated ? " · paginated" : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
