"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, KeyRound, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  API_RESOURCES,
  WRITABLE_API_RESOURCES,
  type ApiResource,
  type ApiTokenScope,
} from "@/lib/apiScopes";

type ResourceAccess = "none" | "read" | "write";

function scopesFor(mode: "public" | "admin", access: Record<ApiResource, ResourceAccess>): ApiTokenScope[] {
  if (mode === "public") return ["read:public"];
  return API_RESOURCES.flatMap((resource): ApiTokenScope[] =>
    access[resource] === "write" ? [`write:${resource}`] : access[resource] === "read" ? [`read:${resource}`] : []
  );
}

const NO_ACCESS = Object.fromEntries(API_RESOURCES.map((resource) => [resource, "none"])) as Record<ApiResource, ResourceAccess>;

/** Display descriptions for each API resource (the lib's English labels stay for the OpenAPI document). */
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

const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

const radioClasses = cn(
  "h-4 w-4 shrink-0 cursor-pointer accent-[rgb(var(--color-accent))] disabled:cursor-not-allowed",
  focusRing
);

interface ApiTokenSummary {
  id: string;
  name: string;
  scopes: ApiTokenScope[];
  createdAt: string;
  lastUsedAt?: string | null;
}

interface CreatedApiToken extends ApiTokenSummary {
  secret: string;
}

/** A server-supplied message (shown verbatim) or a translated message from this page. */
type Notice = { text: string } | { key: MessageKey };

function errorNotice(caught: unknown, fallback: MessageKey): Notice {
  return caught instanceof Error && caught.message ? { text: caught.message } : { key: fallback };
}

export default function ApiTokensPage() {
  const { t, rich, formatDateTime } = useI18n();
  const { tournament, isOwnerOrAdmin } = useTournament();
  const { user, loading: authLoading } = useAuth();
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"public" | "admin">("public");
  const [access, setAccess] = useState<Record<ApiResource, ResourceAccess>>(NO_ACCESS);
  const scopes = scopesFor(mode, access);
  const [createdToken, setCreatedToken] = useState<CreatedApiToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Notice | null>(null);
  const [message, setMessage] = useState<Notice | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ApiTokenSummary | null>(null);

  const renderNotice = (notice: Notice) => ("text" in notice ? notice.text : t(notice.key));

  const loadTokens = useCallback(async () => {
    if (!user || !tournament || !isOwnerOrAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/api-tokens`, {
        headers: { Authorization: `Bearer ${idToken}` },
        cache: "no-store",
      });
      const result = await response.json() as { error?: string; tokens?: ApiTokenSummary[] };
      if (!response.ok) throw new Error(result.error || "");
      setTokens(result.tokens || []);
    } catch (loadError) {
      setError(errorNotice(loadError, "setup.staff.api.loadError"));
    } finally {
      setLoading(false);
    }
  }, [user, tournament, isOwnerOrAdmin]);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  const createToken = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !tournament) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    setCreatedToken(null);
    setCopied(false);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/api-tokens`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, scopes }),
      });
      const result = await response.json() as { error?: string; token?: CreatedApiToken };
      if (!response.ok || !result.token) throw new Error(result.error || "");
      setCreatedToken(result.token);
      setTokens((current) => [result.token!, ...current]);
      setName("");
      setMessage({ key: "setup.staff.api.created" });
    } catch (createError) {
      setError(errorNotice(createError, "setup.staff.api.createError"));
    } finally {
      setBusy(false);
    }
  };

  const revokeToken = async (token: ApiTokenSummary) => {
    if (!user || !tournament) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/api-tokens`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: token.id }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "");
      setTokens((current) => current.filter((item) => item.id !== token.id));
      if (createdToken?.id === token.id) setCreatedToken(null);
      setMessage({ key: "setup.staff.api.revoked" });
    } catch (revokeError) {
      setError(errorNotice(revokeError, "setup.staff.api.revokeError"));
    } finally {
      setBusy(false);
      setPendingRevoke(null);
    }
  };

  const copyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken.secret);
      setCopied(true);
      setMessage({ key: "setup.staff.api.copied" });
    } catch {
      setError({ key: "setup.staff.api.copyFailed" });
    }
  };

  if (authLoading || loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <p role="status" className="text-[13px] text-fg-muted">{t("setup.staff.api.loading")}</p>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (!user || !isOwnerOrAdmin) {
    return <Alert role="alert" tone="danger">{t("setup.staff.api.signInRequired")}</Alert>;
  }

  const strong = { b: (text: string) => <strong className="font-semibold text-fg">{text}</strong> };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("setup.staff.api.title")} description={t("setup.staff.api.description")} />

      <Alert tone="warning" title={t("setup.staff.api.warningTitle")}>
        {rich("setup.staff.api.warning", strong)}
      </Alert>

      <Card>
        <CardHeader icon={<KeyRound aria-hidden="true" />} title={t("setup.staff.api.createTitle")} />
        <CardBody>
          <form onSubmit={createToken} className="space-y-4">
            <Input
              label={t("setup.staff.api.nameLabel")}
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("setup.staff.api.namePlaceholder")}
            />
            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-xs font-medium text-fg">{t("setup.staff.api.accessLegend")}</legend>
              <label className="flex items-center gap-2 text-[13px] text-fg">
                <input
                  type="radio"
                  name="token-mode"
                  checked={mode === "public"}
                  onChange={() => setMode("public")}
                  className={radioClasses}
                />
                {t("setup.staff.api.modePublic")}
              </label>
              <label className="flex items-center gap-2 text-[13px] text-fg">
                <input
                  type="radio"
                  name="token-mode"
                  checked={mode === "admin"}
                  onChange={() => setMode("admin")}
                  className={radioClasses}
                />
                {t("setup.staff.api.modeAdmin")}
              </label>
            </fieldset>
            {mode === "admin" && (
              <TableContainer>
                <Table>
                  <THead>
                    <TR>
                      <TH>{t("setup.staff.api.areaHeader")}</TH>
                      <TH>{t("setup.staff.api.accessHeader")}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {API_RESOURCES.map((resource) => (
                      <TR key={resource}>
                        <TD>
                          <span className="font-mono text-xs text-fg">{resource}</span>
                          <span className="block text-xs text-fg-muted">{t(RESOURCE_KEYS[resource])}</span>
                        </TD>
                        <TD className="w-44">
                          <Select
                            aria-label={t("setup.staff.api.resourceAccessLabel", { resource })}
                            value={access[resource]}
                            onChange={(event) => setAccess((current) => ({ ...current, [resource]: event.target.value as ResourceAccess }))}
                          >
                            <option value="none">{t("setup.staff.api.accessNone")}</option>
                            <option value="read">{t("setup.staff.api.accessRead")}</option>
                            {WRITABLE_API_RESOURCES.includes(resource) && (
                              <option value="write">{t("setup.staff.api.accessWrite")}</option>
                            )}
                          </Select>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
            <p className="text-xs text-fg-muted">
              {t("setup.staff.api.scopesLabel")}{" "}
              <span className="break-all font-mono text-fg">{scopes.join(" ") || t("setup.staff.api.noScopes")}</span>
            </p>
            <Button type="submit" variant="primary" disabled={busy || scopes.length === 0}>
              <Plus aria-hidden="true" />
              {t("setup.staff.api.createButton")}
            </Button>
          </form>
        </CardBody>
      </Card>

      {createdToken && (
        <Card className="border-success-border">
          <CardHeader
            icon={<ShieldAlert aria-hidden="true" />}
            title={t("setup.staff.api.copyTitle")}
            description={t("setup.staff.api.copyHelp")}
          />
          <CardBody className="space-y-3">
            <textarea
              readOnly
              aria-label={t("setup.staff.api.tokenLabel")}
              value={createdToken.secret}
              rows={3}
              onFocus={(event) => event.currentTarget.select()}
              className={cn(
                "w-full break-all rounded-md border border-border-strong bg-muted p-2 font-mono text-xs text-fg",
                focusRing
              )}
            />
            <Button variant="secondary" size="sm" onClick={() => void copyToken()}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? t("setup.common.copied") : t("setup.staff.api.copyButton")}
            </Button>          </CardBody>
        </Card>
      )}

      {error && <Alert role="alert" tone="danger">{renderNotice(error)}</Alert>}
      {message && <Alert role="status" tone="success">{renderNotice(message)}</Alert>}

      <Card>
        <CardHeader title={t("setup.staff.api.activeTitle")} />
        <CardBody>
          {tokens.length === 0 ? (
            <EmptyState icon={<KeyRound aria-hidden="true" />} title={t("setup.staff.api.empty")} />
          ) : (
            <ul className="divide-y divide-border">
              {tokens.map((token) => (
                <li key={token.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <h3 className="truncate text-[13px] font-medium text-fg">{token.name}</h3>
                    <p className="break-words text-xs text-fg-muted">
                      <span className="font-mono">{(token.scopes ?? []).join(" ")}</span>
                      {" · "}
                      {t("setup.staff.api.createdAt", { time: formatDateTime(token.createdAt, DATE_TIME) })}
                      {token.lastUsedAt && (
                        <>
                          {" · "}
                          {t("setup.staff.api.lastUsedAt", { time: formatDateTime(token.lastUsedAt, DATE_TIME) })}
                        </>
                      )}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => setPendingRevoke(token)}
                    aria-label={t("setup.staff.api.revokeLabel", { name: token.name })}
                  >
                    <Trash2 aria-hidden="true" />
                    {t("setup.staff.api.revokeButton")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("setup.staff.api.docsTitle")} />
        <CardBody className="space-y-3">
          <p className="text-[13px] text-fg-muted">
            <Link className={cn("rounded-sm text-accent-text underline", focusRing)} href="/tournaments/api">
              {t("setup.staff.api.docsReference")}
            </Link>
            {" · "}
            {t("setup.staff.api.docsOpenApi")}{" "}
            <a
              className={cn("rounded-sm text-accent-text underline", focusRing)}
              href="/api/openapi.json"
              target="_blank"
              rel="noreferrer"
            >
              /api/openapi.json
            </a>
          </p>
          <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs text-fg">{`curl -H "Authorization: Bearer $CRABBYTAB_API_TOKEN" \\
  "https://YOUR_CRABBYTAB_HOST/api/v1/tournaments/${tournament?.slug}/rounds/1/pairings"`}</pre>
        </CardBody>
      </Card>

      {pendingRevoke && (
        <ConfirmActionDialog
          variant="danger"
          title={t("setup.staff.api.revokeConfirmTitle")}
          description={t("setup.staff.api.revokeConfirmDescription", { name: pendingRevoke.name })}
          confirmLabel={t("setup.staff.api.revokeConfirmButton")}
          isBusy={busy}
          onCancel={() => setPendingRevoke(null)}
          onConfirm={() => void revokeToken(pendingRevoke)}
        />
      )}
    </div>
  );
}
