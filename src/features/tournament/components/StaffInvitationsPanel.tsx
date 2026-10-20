"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { Copy, Mail, RotateCw, XCircle } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { StatusPill, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { Alert } from "@/components/ui/Feedback";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { Input, Select, Textarea } from "@/components/ui/Field";
import type { MessageKey } from "@/lib/i18n/messages";

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

const STATE_LABEL: Record<InvitationState, { label: MessageKey; tone: Tone }> = {
  pending: { label: "setup.staff.inviteStatePending", tone: "info" },
  accepted: { label: "setup.staff.inviteStateAccepted", tone: "success" },
  revoked: { label: "setup.staff.inviteStateRevoked", tone: "neutral" },
  expired: { label: "setup.staff.inviteStateExpired", tone: "warning" },
};

/** A server-supplied message (shown verbatim) or one of this panel's translated messages. */
type Notice = { text: string } | { key: MessageKey };

/** Uses the server's error message when there is one, otherwise the translated fallback. */
function errorNotice(caught: unknown, fallback: MessageKey): Notice {
  return caught instanceof Error && caught.message ? { text: caught.message } : { key: fallback };
}

const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

/** Invite-by-email for the staff page: create, list, resend and revoke invitations. */
export function StaffInvitationsPanel({ tournamentId, user }: { tournamentId: string; user: User }) {
  const { t, plural, formatDateTime } = useI18n();
  const [invitations, setInvitations] = useState<InvitationSummary[]>([]);
  const [links, setLinks] = useState<IssuedLink[]>([]);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<"admin" | "dataEntry">("dataEntry");
  const [expiryDays, setExpiryDays] = useState("7");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Notice | null>(null);
  const [message, setMessage] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<InvitationSummary | null>(null);

  const formatTime = (value: string | undefined) => (value ? formatDateTime(value, DATE_TIME) : "");

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
      if (!response.ok) throw new Error(result.error || "");
      if (result.invitations) setInvitations(result.invitations);
      return result;
    },
    [tournamentId, user]
  );

  useEffect(() => {
    let active = true;
    request("GET")
      .catch((caught: unknown) => {
        if (active) setError(errorNotice(caught, "setup.staff.inviteLoadError"));
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
    setError(null);
    setMessage("");
    try {
      setMessage(await action());
    } catch (actionError) {
      setError(errorNotice(actionError, "setup.staff.inviteUpdateError"));
    } finally {
      setBusy(null);
    }
  };

  const describeLinks = (issued: IssuedLink[]) => {
    setLinks(issued);
    const failed = issued.filter((link) => !link.delivered).length;
    return failed === 0
      ? plural("setup.staff.inviteSent", issued.length)
      : t("setup.staff.invitePartial", { sent: issued.length - failed, failed });
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

  const revoke = async (invitation: InvitationSummary) => {
    await run(`revoke-${invitation.id}`, async () => {
      await request("DELETE", { invitationId: invitation.id });
      setLinks((current) => current.filter((link) => link.id !== invitation.id));
      return t("setup.staff.inviteRevoked", { email: invitation.email });
    });
    setPendingRevoke(null);
  };

  const copy = async (link: IssuedLink) => {
    try {
      await navigator.clipboard.writeText(link.link);
      setMessage(t("setup.staff.inviteLinkCopied", { email: link.email }));
    } catch {
      setError({ key: "setup.staff.inviteCopyFailed" });
    }
  };

  const open = invitations.filter((invitation) => invitation.state === "pending" || invitation.state === "expired");
  const closed = invitations.filter((invitation) => invitation.state === "accepted" || invitation.state === "revoked");

  const closedText = (invitation: InvitationSummary) => {
    if (invitation.acceptedAt) {
      return t("setup.staff.inviteClosedAcceptedAt", { email: invitation.email, time: formatTime(invitation.acceptedAt) });
    }
    return invitation.state === "accepted"
      ? t("setup.staff.inviteClosedAccepted", { email: invitation.email })
      : t("setup.staff.inviteClosedRevoked", { email: invitation.email });
  };

  return (
    <Card className="max-w-3xl">
      <CardHeader
        icon={<Mail aria-hidden="true" />}
        title={t("setup.staff.inviteTitle")}
        description={t("setup.staff.inviteDescription")}
      />
      <CardBody className="space-y-4">
        <form onSubmit={invite} className="space-y-3">
          <Textarea
            label={t("setup.staff.inviteEmailsLabel")}
            help={t("setup.staff.inviteEmailsHelp")}
            value={emails}
            onChange={(event) => setEmails(event.target.value)}
            rows={2}
            autoComplete="off"
            placeholder={t("setup.staff.emailPlaceholder")}
          />
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label={t("setup.staff.inviteRoleLabel")}
              wrapperClassName="w-56 max-w-full"
              value={role}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "admin" || next === "dataEntry") setRole(next);
              }}
            >
              <option value="dataEntry">{t("setup.staff.roleDataEntry")}</option>
              <option value="admin">{t("setup.staff.roleAdmin")}</option>
            </Select>
            <Input
              label={t("setup.staff.inviteExpiryLabel")}
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
              {t("setup.staff.inviteSend")}
            </Button>
          </div>
        </form>

        {error && <Alert tone="danger" role="alert">{"text" in error ? error.text : t(error.key)}</Alert>}
        {message && <Alert tone="success" role="status">{message}</Alert>}

        {links.length > 0 && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-xs font-medium text-fg">{t("setup.staff.inviteNewLinks")}</p>
            <ul className="space-y-2">
              {links.map((link) => (
                <li key={link.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-fg">{link.email}</span>
                  <StatusPill tone={link.delivered ? "success" : "warning"}>
                    {link.delivered ? t("setup.staff.inviteEmailed") : t("setup.staff.inviteNotEmailed")}
                  </StatusPill>
                  <input
                    readOnly
                    aria-label={t("setup.staff.inviteLinkLabel", { email: link.email })}
                    value={link.link}
                    onFocus={(event) => event.currentTarget.select()}
                    className="min-w-0 flex-1 rounded border border-border bg-muted px-2 py-1 font-mono text-[11px] text-fg-muted"
                  />
                  <Button
                    size="sm"
                    onClick={() => void copy(link)}
                    aria-label={t("setup.staff.inviteCopyLabel", { email: link.email })}
                  >
                    <Copy aria-hidden="true" />
                    {t("setup.common.copy")}
                  </Button>
                  {link.error && <p className="w-full text-fg-muted">{link.error}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <section aria-labelledby="pending-invitations-heading" className="space-y-2">
          <h3 id="pending-invitations-heading" className="text-xs font-semibold text-fg">
            {t("setup.staff.inviteOpenTitle", { count: open.length })}
          </h3>
          {loading ? (
            <p className="text-xs text-fg-muted" role="status">{t("setup.staff.inviteLoading")}</p>
          ) : open.length === 0 ? (
            <p className="text-xs text-fg-muted">{t("setup.staff.inviteNoneOpen")}</p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {open.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-fg">
                      <span className="truncate">{invitation.email}</span>
                      <StatusPill tone={STATE_LABEL[invitation.state].tone}>{t(STATE_LABEL[invitation.state].label)}</StatusPill>
                    </p>
                    <p className="text-xs text-fg-muted">
                      {invitation.role === "admin" ? t("setup.staff.roleAdmin") : t("setup.staff.roleDataEntry")}
                      {" · "}
                      {t(invitation.state === "expired" ? "setup.staff.inviteExpired" : "setup.staff.inviteExpires", {
                        time: formatTime(invitation.expiresAt),
                      })}
                      {invitation.lastSentAt && (
                        <>
                          {" · "}
                          {t("setup.staff.inviteLastEmailed", { time: formatTime(invitation.lastSentAt) })}
                        </>
                      )}
                    </p>
                    {invitation.deliveryError && <p className="text-xs text-warning">{invitation.deliveryError}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => void resend(invitation)}
                      loading={busy === `resend-${invitation.id}`}
                      disabled={busy !== null}
                      aria-label={t("setup.staff.inviteResendLabel", { email: invitation.email })}
                    >
                      <RotateCw aria-hidden="true" />
                      {t("setup.staff.inviteResend")}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setPendingRevoke(invitation)}
                      loading={busy === `revoke-${invitation.id}`}
                      disabled={busy !== null}
                      aria-label={t("setup.staff.inviteRevokeLabel", { email: invitation.email })}
                    >
                      <XCircle aria-hidden="true" />
                      {t("setup.staff.inviteRevoke")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {closed.length > 0 && (
            <details className="text-xs text-fg-muted">
              <summary className={cn("cursor-pointer rounded-sm", focusRing)}>
                {t("setup.staff.inviteClosedSummary", { count: closed.length })}
              </summary>
              <ul className="mt-2 space-y-1">
                {closed.map((invitation) => (
                  <li key={invitation.id}>{closedText(invitation)}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </CardBody>

      {pendingRevoke && (
        <ConfirmActionDialog
          variant="danger"
          title={t("setup.staff.inviteRevokeConfirmTitle")}
          description={t("setup.staff.inviteRevokeConfirmDescription", { email: pendingRevoke.email })}
          confirmLabel={t("setup.staff.inviteRevokeConfirmButton")}
          isBusy={busy === `revoke-${pendingRevoke.id}`}
          onCancel={() => setPendingRevoke(null)}
          onConfirm={() => void revoke(pendingRevoke)}
        />
      )}
    </Card>
  );
}
