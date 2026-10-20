"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";
import {
  API_RESOURCE_LABELS,
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

export default function ApiTokensPage() {
  const { tournament, isOwnerOrAdmin } = useTournament();
  const { user, loading: authLoading } = useAuth();
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"public" | "admin">("public");
  const [access, setAccess] = useState<Record<ApiResource, ResourceAccess>>(NO_ACCESS);
  const scopes = scopesFor(mode, access);
  const [createdToken, setCreatedToken] = useState<CreatedApiToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadTokens = useCallback(async () => {
    if (!user || !tournament || !isOwnerOrAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/api-tokens`, {
        headers: { Authorization: `Bearer ${idToken}` },
        cache: "no-store",
      });
      const result = await response.json() as { error?: string; tokens?: ApiTokenSummary[] };
      if (!response.ok) throw new Error(result.error || "Could not load API tokens.");
      setTokens(result.tokens || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load API tokens.");
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
    setError("");
    setMessage("");
    setCreatedToken(null);
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
      if (!response.ok || !result.token) throw new Error(result.error || "Could not create API token.");
      setCreatedToken(result.token);
      setTokens((current) => [result.token!, ...current]);
      setName("");
      setMessage("Token created. Copy it now; it will not be shown again.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create API token.");
    } finally {
      setBusy(false);
    }
  };

  const revokeToken = async (token: ApiTokenSummary) => {
    if (!user || !tournament || !window.confirm(`Revoke API token “${token.name}”? Any client using it will lose access immediately.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
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
      if (!response.ok) throw new Error(result.error || "Could not revoke API token.");
      setTokens((current) => current.filter((item) => item.id !== token.id));
      if (createdToken?.id === token.id) setCreatedToken(null);
      setMessage("API token revoked.");
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Could not revoke API token.");
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken.secret);
      setMessage("Token copied to the clipboard.");
    } catch {
      setError("Clipboard access failed. Select and copy the token manually.");
    }
  };

  if (authLoading || loading) return <p className="p-6 text-sm text-gray-600">Loading API access…</p>;
  if (!user || !isOwnerOrAdmin) {
    return <p role="alert" className="p-6 text-sm text-red-700">Sign in as a tournament administrator to manage API access.</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="border-b border-gray-200 pb-4">
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
          <KeyRound className="h-5 w-5 text-blue-700" />
          API access
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Create scoped bearer credentials for integrations. Tokens are stored as hashes and shown only once.
        </p>
      </header>

      <aside className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        Treat tokens like passwords. Do not put them in browser code, source control, or public URLs.
        A <strong>public</strong> token sees only what the public site shows. Administrator scopes expose
        unreleased data (<strong>read</strong>) or change the tournament (<strong>write</strong>) through the
        same rules as the tab room; every write is recorded in the audit log. Tokens never expose participant
        email addresses or private portal credentials.
      </aside>

      <form onSubmit={createToken} className="space-y-3 rounded border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-900">Create token</h2>
        <label className="block text-sm font-medium text-gray-700">
          Token name
          <input
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            placeholder="Projector display"
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-700">Access</legend>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="radio" name="token-mode" checked={mode === "public"} onChange={() => setMode("public")} />
            Public — what the public site shows (read:public)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="radio" name="token-mode" checked={mode === "admin"} onChange={() => setMode("admin")} />
            Administrator — choose access per area
          </label>
        </fieldset>
        {mode === "admin" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase text-gray-500">
                  <th scope="col" className="py-1 pr-2 font-semibold">Area</th>
                  <th scope="col" className="py-1 font-semibold">Access</th>
                </tr>
              </thead>
              <tbody>
                {API_RESOURCES.map((resource) => (
                  <tr key={resource} className="border-t border-gray-100">
                    <td className="py-1.5 pr-2">
                      <span className="font-mono text-xs text-gray-900">{resource}</span>
                      <span className="block text-xs text-gray-500">{API_RESOURCE_LABELS[resource]}</span>
                    </td>
                    <td className="py-1.5">
                      <select
                        aria-label={`Access to ${resource}`}
                        value={access[resource]}
                        onChange={(event) => setAccess((current) => ({ ...current, [resource]: event.target.value as ResourceAccess }))}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                      >
                        <option value="none">None</option>
                        <option value="read">Read</option>
                        {WRITABLE_API_RESOURCES.includes(resource) && <option value="write">Read and write</option>}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-600">Scopes: <span className="font-mono">{scopes.join(" ") || "none selected"}</span></p>
        <button disabled={busy || scopes.length === 0} className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          <Plus className="h-4 w-4" />
          Create API token
        </button>
      </form>

      {createdToken && (
        <section className="space-y-2 rounded border border-emerald-300 bg-emerald-50 p-4">
          <h2 className="font-semibold text-emerald-950">Copy this token now</h2>
          <p className="text-xs text-emerald-900">It cannot be retrieved after leaving this page.</p>
          <textarea readOnly value={createdToken.secret} rows={3} className="w-full break-all rounded border border-emerald-300 bg-white p-2 font-mono text-xs" />
          <button type="button" onClick={() => void copyToken()} className="rounded bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-white">Copy token</button>
        </section>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}

      <section className="space-y-3">
        <h2 className="font-semibold text-gray-900">Active tokens</h2>
        {tokens.length === 0
          ? <p className="text-sm text-gray-500">No API tokens have been created.</p>
          : tokens.map((token) => (
            <article key={token.id} className="flex items-center justify-between gap-4 rounded border border-gray-200 bg-white p-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-gray-900">{token.name}</h3>
                <p className="break-words text-xs text-gray-600">
                  <span className="font-mono">{(token.scopes ?? []).join(" ")}</span> · created {new Date(token.createdAt).toLocaleString()}
                  {token.lastUsedAt ? ` · last used ${new Date(token.lastUsedAt).toLocaleString()}` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void revokeToken(token)}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-red-300 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Revoke
              </button>
            </article>
          ))}
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-900">API documentation</h2>
        <p className="mt-1 text-sm text-gray-600">
          <Link className="text-blue-700 underline" href="/tournaments/api">API reference</Link> · OpenAPI document:{" "}
          <a className="text-blue-700 underline" href="/api/openapi.json" target="_blank" rel="noreferrer">/api/openapi.json</a>
        </p>
        <pre className="mt-3 overflow-x-auto rounded bg-gray-950 p-3 text-xs text-gray-100">{`curl -H "Authorization: Bearer $CRABBYTAB_API_TOKEN" \\
  "https://YOUR_CRABBYTAB_HOST/api/v1/tournaments/${tournament?.slug}/rounds/1/pairings"`}</pre>
      </section>
    </div>
  );
}
