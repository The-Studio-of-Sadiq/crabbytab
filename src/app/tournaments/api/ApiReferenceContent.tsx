"use client";

import React from "react";
import type { ApiResource } from "@/lib/apiScopes";
import type { HttpMethod } from "@/lib/api/v1/router";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import type { MessageKey } from "@/lib/i18n";

/** A route as the reference page shows it; plain data so the server page can pass it in. */
export interface ApiReferenceRoute {
  operationId: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  /** "none" and "participant" are described in words; a token scope is shown as written. */
  scope: { kind: "none" } | { kind: "participant" } | { kind: "token"; text: string };
  paginated: boolean;
}

// The method name is always shown as text; the tone only helps scanning.
const METHOD_TONES: Record<HttpMethod, Tone> = {
  GET: "info",
  POST: "success",
  PUT: "warning",
  PATCH: "accent",
  DELETE: "danger",
};

/** Same descriptions as the API access page (/[slug]/api). */
const RESOURCE_KEYS: Record<ApiResource, MessageKey> = {
  tournament: "setup.staff.api.resourceTournament",
  rounds: "setup.staff.api.resourceRounds",
  participants: "setup.staff.api.resourceParticipants",
  venues: "setup.staff.api.resourceVenues",
  breaks: "setup.staff.api.resourceBreaks",
  draws: "setup.staff.api.resourceDraws",
  results: "setup.staff.api.resourceResults",
  feedback: "setup.staff.api.resourceFeedback",
  checkins: "setup.staff.api.resourceCheckins",
  standings: "setup.staff.api.resourceStandings",
  staff: "setup.staff.api.resourceStaff",
};

const linkClass = cn("rounded-sm text-accent-text underline underline-offset-2", focusRing);
const code = (text: string) => <code className="font-mono text-fg">{text}</code>;

/**
 * The API reference text, translated. Route summaries and descriptions come from the English route
 * definitions (the same ones that build /api/openapi.json) and stay in English.
 */
export function ApiReferenceContent({
  groups,
  resources,
  rateLimits,
}: {
  groups: Array<{ tag: string; routes: ApiReferenceRoute[] }>;
  resources: readonly ApiResource[];
  rateLimits: { perTokenPerMinute: number; writesPerTokenPerHour: number };
}) {
  const { t, rich } = useI18n();
  const scopeText = (scope: ApiReferenceRoute["scope"]) =>
    scope.kind === "none" ? t("setup.data.api.noAuth") : scope.kind === "participant" ? t("setup.data.api.participantAuth") : scope.text;

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div className="space-y-3 border-b border-border pb-6">
        <PageHeader
          title={t("setup.data.api.title")}
          description={rich("setup.data.api.intro", {
            b: (text) => <strong className="font-semibold text-fg">{text}</strong>,
            link: (text) => <a className={linkClass} href="/api/openapi.json">{text}</a>,
          })}
        />
        <nav aria-label={t("setup.data.api.groupsNav")} className="flex flex-wrap gap-2 text-xs">
          {groups.map(({ tag }) => (
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
        <h2 className="text-[15px] font-semibold text-fg">{t("setup.data.api.authTitle")}</h2>
        <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs text-fg">{`curl -H "Authorization: Bearer $CRABBYTAB_API_TOKEN" \\
  "https://YOUR_CRABBYTAB_HOST/api/v1/tournaments/YOUR_SLUG/rounds/1/pairings"`}</pre>
        <p>
          {rich("setup.data.api.scopesIntro", { code }, { readPublic: "read:public", readArea: "read:<area>", writeArea: "write:<area>" })}
        </p>
        <ul className="list-disc space-y-1 ps-5">
          {resources.map((resource) => (
            <li key={resource}><code className="font-mono text-fg">{resource}</code>: {t(RESOURCE_KEYS[resource])}</li>
          ))}
        </ul>
        <p>
          {rich("setup.data.api.writes", { code }, {
            conflict: "409 rule_violation",
            override: `"override": {"reason": "..."}`,
            limit: "limit",
            cursor: "cursor",
            page: "{ data, nextCursor }",
            perMinute: rateLimits.perTokenPerMinute,
            perHour: rateLimits.writesPerTokenPerHour,
          })}
        </p>
        <p>
          {rich("setup.data.api.moreExamples", {
            link: (text) => <a className={linkClass} href="https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/api.md">{text}</a>,
          })}
        </p>
      </section>

      {groups.map(({ tag, routes }) => (
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
                    {rich("setup.data.api.scope", { code: (text) => <span className="font-mono">{text}</span> }, { scope: scopeText(route.scope) })}
                    {route.paginated ? t("setup.data.api.paginated") : ""}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
