import type { Metadata } from "next";
import { API_RESOURCE_LABELS, API_RESOURCES } from "@/lib/apiScopes";
import { RATE_LIMITS } from "@/lib/api/v1/rateLimit";
import { API_ROUTES } from "@/lib/api/v1/routes";
import type { ApiRoute } from "@/lib/api/v1/router";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

export const metadata: Metadata = {
  title: "API reference · CrabbyTab",
  description: "CrabbyTab tournament REST API: endpoints, scopes, pagination and examples.",
};

// The method name is always shown as text; the tone only helps scanning.
const METHOD_TONES: Record<ApiRoute["method"], Tone> = {
  GET: "info",
  POST: "success",
  PUT: "warning",
  PATCH: "accent",
  DELETE: "danger",
};

const linkClass = cn("rounded-sm text-accent-text underline underline-offset-2", focusRing);

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

/**
 * Server-rendered from the same route definitions as /api/openapi.json; ships no client JavaScript.
 * It stays in English: it is developer documentation generated from English route definitions,
 * and translating it would need client JavaScript (the i18n provider is client-side).
 */
export default function ApiReferencePage() {
  const groups = groupByTag(API_ROUTES);
  return (
    <div className="themed min-h-screen bg-background text-fg">
      <main className="mx-auto max-w-4xl space-y-8 px-4 py-8">
        <div className="space-y-3 border-b border-border pb-6">
          <PageHeader
            title="CrabbyTab API reference"
            description={
              <>
                A REST API for one tournament at a time, with bearer tokens issued by its administrators (tournament
                menu → <strong className="font-semibold text-fg">API access</strong>). Machine-readable contract:{" "}
                <a className={linkClass} href="/api/openapi.json">/api/openapi.json</a> (OpenAPI 3.1).
              </>
            }
          />
          <nav aria-label="Endpoint groups" className="flex flex-wrap gap-2 text-xs">
            {groups.map(([tag]) => (
              <a
                key={tag}
                href={`#${tag}`}
                className={cn("rounded-md border border-border bg-surface px-2 py-1 text-fg-muted hover:bg-muted hover:text-fg", focusRing)}
              >
                {tag}
              </a>
            ))}
          </nav>
        </div>

        <section className="space-y-3 text-[13px] text-fg-muted">
          <h2 className="text-[15px] font-semibold text-fg">Authentication and scopes</h2>
          <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs text-fg">{`curl -H "Authorization: Bearer $CRABBYTAB_API_TOKEN" \\
  "https://YOUR_CRABBYTAB_HOST/api/v1/tournaments/YOUR_SLUG/rounds/1/pairings"`}</pre>
          <p>
            <code className="font-mono text-fg">read:public</code> sees exactly what the public site shows. Administrator tokens
            get <code className="font-mono text-fg">read:&lt;area&gt;</code> or <code className="font-mono text-fg">write:&lt;area&gt;</code>{" "}
            (write implies read) for each area:
          </p>
          <ul className="list-disc space-y-1 ps-5">
            {API_RESOURCES.map((resource) => (
              <li key={resource}><code className="font-mono text-fg">{resource}</code>: {API_RESOURCE_LABELS[resource]}</li>
            ))}
          </ul>
          <p>
            Writes use the same commands and tournament rules as the tab room. A change blocked by an overridable rule
            returns <code className="font-mono text-fg">409 rule_violation</code>; retry with{" "}
            <code className="font-mono text-fg">{`"override": {"reason": "..."}`}</code> to proceed (the reason is audited).
            List endpoints take <code className="font-mono text-fg">limit</code> and <code className="font-mono text-fg">cursor</code> and
            return <code className="font-mono text-fg">{"{ data, nextCursor }"}</code>. Limits: {RATE_LIMITS.perTokenPerMinute} requests
            per token per minute, {RATE_LIMITS.writesPerTokenPerHour} writes per token per hour.
          </p>
          <p>
            More examples: <a className={linkClass} href="https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/api.md">docs/api.md</a>.
          </p>
        </section>

        {groups.map(([tag, routes]) => (
          <section key={tag} id={tag} className="scroll-mt-4 space-y-3">
            <h2 className="text-[15px] font-semibold capitalize text-fg">{tag.replace(/-/g, " ")}</h2>
            <ul className="space-y-2">
              {routes.map((route) => (
                <li key={route.operationId}>
                  <Card className="p-3">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone={METHOD_TONES[route.method]} className="font-mono font-semibold">{route.method}</Badge>
                      <code className="break-all font-mono text-[13px] text-fg">/api/v1{route.path === "/" ? "" : route.path}</code>
                    </p>
                    <p className="mt-1 text-[13px] font-medium text-fg">{route.summary}</p>
                    {route.description && <p className="mt-1 text-[13px] text-fg-muted">{route.description}</p>}
                    <p className="mt-1 text-xs text-fg-subtle">
                      Scope: <span className="font-mono">{scopeText(route)}</span>
                      {route.paginated ? " · paginated" : ""}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
