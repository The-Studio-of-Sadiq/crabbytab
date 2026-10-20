"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { Copy, Mail, RotateCw, XCircle } from "lucide-react";
import { StatusPill, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { Input, Select, Textarea } from "@/components/ui/Field";

type InvitationState = "pending" | "accepted" | "revoked" | "expired";

interface InvitationSummary {
  id: string;
  email: string;
  role: "admin" | "dataEntry";
  state: InvitationState;
  createdAt: string;
  expiresAt: string;
  sendCount: number;
  lastSentAt?: string;
  deliveryError?: string;
  acceptedAt?: string;
}

interface IssuedLink {
  id: string;
  email: string;
  link: string;
  delivered: boolean;
  error?: string;
}

const STATE_LABEL: Record<InvitationState, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  revoked: { label: "Revoked", tone: "neutral" },
  expired: { label: "Expired", tone: "warning" },
};

function formatTime(value: string | undefined): string {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
}

/** Invite-by-email for the staff page: create, list, resend and revoke invitations. */
export function StaffInvitationsPanel({ tournamentId, user }: { tournamentId: string; user: User }) {
  const [invitations, setInvitations] = useState<InvitationSummary[]>([]);
  const [links, setLinks] = useState<IssuedLink[]>([]);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<"admin" | "dataEntry">("dataEntry");
  const [expiryDays, setExpiryDays] = useState("7");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const request = useCallback(
    async (method: "GET" | "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) => {
      const token = await user.getIdToken();
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournamentId)}/staff/invitations`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        invitations?: InvitationSummary[];
        links?: IssuedLink[];
      };
      if (!response.ok) throw new Error(result.error || "Could not update staff invitations.");
      if (result.invitations) setInvitations(result.invitations);
      return result;
    },
    [tournamentId, user]
  );

  useEffect(() => {
    let active = true;
    request("GET")
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load staff invitations.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request]);

  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      setMessage(await action());
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not update staff invitations.");
    } finally {
      setBusy(null);
    }
  };

  const describeLinks = (issued: IssuedLink[]) => {
    setLinks(issued);
    const failed = issued.filter((link) => !link.delivered).length;
    return failed === 0
      ? `Invitation email sent to ${issued.length} address(es).`
      : `${issued.length - failed} sent, ${failed} not emailed. Copy their links below and share them another way.`;
  };

  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    const list = [...new Set(emails.split(/[\s,;]+/).map((email) => email.trim()).filter(Boolean))];
    if (list.length === 0) return;
    void run("create", async () => {
      const result = await request("POST", { emails: list, role, expiryDays: Number(expiryDays) });
      setEmails("");
      return describeLinks(result.links ?? []);
    });
  };

  const resend = (invitation: InvitationSummary) =>
    run(`resend-${invitation.id}`, async () => {
      const result = await request("PATCH", { action: "resend", invitationId: invitation.id, expiryDays: Number(expiryDays) });
      return describeLinks(result.links ?? []);
    });

  const revoke = (invitation: InvitationSummary) => {
    if (!window.confirm(`Revoke the invitation for ${invitation.email}? Its link will stop working.`)) return;
    void run(`revoke-${invitation.id}`, async () => {
      await request("DELETE", { invitationId: invitation.id });
      setLinks((current) => current.filter((link) => link.id !== invitation.id));
      return `Invitation for ${invitation.email} revoked.`;
    });
  };

  const copy = async (link: IssuedLink) => {
    try {
      await navigator.clipboard.writeText(link.link);
      setMessage(`Link for ${link.email} copied.`);
    } catch {
      setError("Could not copy automatically; select the link and copy it.");
    }
  };

  const open = invitations.filter((invitation) => invitation.state === "pending" || invitation.state === "expired");
  const closed = invitations.filter((invitation) => invitation.state === "accepted" || invitation.state === "revoked");

  return (
    <Card className="max-w-3xl">
      <CardHeader
        icon={<Mail aria-hidden="true" />}
        title="Invite by email"
        description="People without a CrabbyTab account create one from the invitation link; existing accounts sign in. Each link works once."
      />
      <CardBody className="space-y-4">
        <form onSubmit={invite} className="space-y-3">
          <Textarea
            label="Email addresses"
            help="Separate addresses with spaces, commas, semicolons or new lines (up to 50)."
            value={emails}
            onChange={(event) => setEmails(event.target.value)}
            rows={2}
            autoComplete="off"
            placeholder="person@example.com"
          />
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Role"
              wrapperClassName="w-56"
              value={role}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "admin" || next === "dataEntry") setRole(next);
              }}
            >
              <option value="dataEntry">Data-entry staff</option>
              <option value="admin">Tournament administrator</option>
            </Select>
            <Input
              label="Link valid for (days)"
              wrapperClassName="w-40"
              type="number"
              min={1}
              max={30}
              step={1}
              required
              value={expiryDays}
              onChange={(event) => setExpiryDays(event.target.value)}
            />
            <Button type="submit" variant="primary" loading={busy === "create"} disabled={!emails.trim() || busy !== null}>
              Send invitations
            </Button>
          </div>
        </form>

        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        {message && <Alert tone="success" role="status">{message}</Alert>}

        {links.length > 0 && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-xs font-medium text-fg">New links (shown once; only a hash is stored)</p>
            <ul className="space-y-2">
              {links.map((link) => (
                <li key={link.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-fg">{link.email}</span>
                  <StatusPill tone={link.delivered ? "success" : "warning"}>
                    {link.delivered ? "Emailed" : "Not emailed"}
                  </StatusPill>
                  <input
                    readOnly
                    aria-label={`Invitation link for ${link.email}`}
                    value={link.link}
                    onFocus={(event) => event.currentTarget.select()}
                    className="min-w-0 flex-1 rounded border border-border bg-muted px-2 py-1 font-mono text-[11px] text-fg-muted"
                  />
                  <Button size="sm" onClick={() => void copy(link)}>
                    <Copy aria-hidden="true" />
                    Copy
                  </Button>
                  {link.error && <p className="w-full text-fg-muted">{link.error}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <section aria-labelledby="pending-invitations-heading" className="space-y-2">
          <h3 id="pending-invitations-heading" className="text-xs font-semibold text-fg">
            Open invitations ({open.length})
          </h3>
          {loading ? (
            <p className="text-xs text-fg-muted" role="status">Loading invitations…</p>
          ) : open.length === 0 ? (
            <p className="text-xs text-fg-muted">No open invitations.</p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {open.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-fg">
                      <span className="truncate">{invitation.email}</span>
                      <StatusPill tone={STATE_LABEL[invitation.state].tone}>{STATE_LABEL[invitation.state].label}</StatusPill>
                    </p>
                    <p className="text-xs text-fg-muted">
                      {invitation.role === "admin" ? "Tournament administrator" : "Data-entry staff"} ·{" "}
                      {invitation.state === "expired" ? "expired" : "expires"} {formatTime(invitation.expiresAt)}
                      {invitation.lastSentAt ? ` · last emailed ${formatTime(invitation.lastSentAt)}` : ""}
                    </p>
                    {invitation.deliveryError && <p className="text-xs text-warning">{invitation.deliveryError}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => void resend(invitation)}
                      loading={busy === `resend-${invitation.id}`}
                      disabled={busy !== null}
                      aria-label={`Resend invitation to ${invitation.email}`}
                    >
                      <RotateCw aria-hidden="true" />
                      Resend
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => revoke(invitation)}
                      loading={busy === `revoke-${invitation.id}`}
                      disabled={busy !== null}
                      aria-label={`Revoke invitation for ${invitation.email}`}
                    >
                      <XCircle aria-hidden="true" />
                      Revoke
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {closed.length > 0 && (
            <details className="text-xs text-fg-muted">
              <summary className="cursor-pointer">Accepted and revoked ({closed.length})</summary>
              <ul className="mt-2 space-y-1">
                {closed.map((invitation) => (
                  <li key={invitation.id}>
                    {invitation.email} — {STATE_LABEL[invitation.state].label.toLowerCase()}
                    {invitation.acceptedAt ? ` ${formatTime(invitation.acceptedAt)}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </CardBody>
    </Card>
  );
}
