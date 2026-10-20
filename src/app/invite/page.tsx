"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MailCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PublicFormShell } from "@/components/public/PublicFormShell";
import { Alert } from "@/components/ui/Feedback";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { auth } from "@/lib/firebase";
import { firebaseAuthMessage } from "@/lib/authErrors";
import type { MessageKey } from "@/lib/i18n";

interface InvitationPreview {
  tournamentName: string;
  tournamentSlug: string;
  email: string;
  role: "admin" | "dataEntry";
  expiresAt: string;
  state: "pending" | "accepted" | "revoked" | "expired";
}

const STATE_TITLES = {
  accepted: "invite.state.accepted",
  revoked: "invite.state.revoked",
  expired: "invite.state.expired",
} as const satisfies Record<Exclude<InvitationPreview["state"], "pending">, MessageKey>;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; invitation: InvitationPreview; accountExists: boolean };

async function postInvitation<T>(body: Record<string, unknown>, idToken?: string): Promise<T> {
  const response = await fetch("/api/invitations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}

export default function InvitePage() {
  const router = useRouter();
  const { t, formatDateTime } = useI18n();
  const { user, loading: authLoading, signInWithEmail, logout } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState<{ slug: string } | null>(null);

  useEffect(() => {
    const value = window.location.hash.replace(/^#/, "").trim();
    setToken(value);
    if (!value) {
      setState({ kind: "error", message: t("invite.missingLink") });
      return;
    }
    let active = true;
    postInvitation<{ invitation: InvitationPreview; accountExists?: boolean }>({ action: "preview", token: value })
      .then((result) => {
        if (active) setState({ kind: "ready", invitation: result.invitation, accountExists: result.accountExists === true });
      })
      .catch((loadError: unknown) => {
        if (active) setState({ kind: "error", message: loadError instanceof Error ? loadError.message : t("invite.loadFailed") });
      });
    return () => {
      active = false;
    };
  }, [t]);

  const finish = useCallback(
    (slug: string) => {
      setAccepted({ slug });
      // Drop the token from the address bar and history now that it is used.
      window.history.replaceState(null, "", "/invite");
      if (slug) router.prefetch(`/${slug}`);
    },
    [router]
  );

  const accept = async () => {
    if (!token || !auth?.currentUser) return;
    const idToken = await auth.currentUser.getIdToken();
    const result = await postInvitation<{ tournamentSlug: string }>({ action: "accept", token }, idToken);
    finish(result.tournamentSlug);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (actionError) {
      const code = (actionError as { code?: unknown } | null)?.code;
      setError(typeof code === "string" && code.startsWith("auth/")
        ? firebaseAuthMessage(actionError)
        : actionError instanceof Error ? actionError.message : t("invite.failed"));
    } finally {
      setBusy(false);
    }
  };

  const signInAndAccept = (event: React.FormEvent, email: string) => {
    event.preventDefault();
    void run(async () => {
      await signInWithEmail(email, password);
      await accept();
    });
  };

  const createAccount = (event: React.FormEvent, email: string) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError(t("invite.passwordMismatch"));
      return;
    }
    void run(async () => {
      const result = await postInvitation<{ tournamentSlug: string }>({ action: "register", token, password, displayName });
      await signInWithEmail(email, password);
      finish(result.tournamentSlug);
    });
  };

  let content: React.ReactNode;
  if (accepted) {
    content = (
      <Alert tone="success" role="status" title={t("invite.acceptedTitle")}>
        <p>{t("invite.acceptedBody")}</p>
        {accepted.slug && (
          <Link href={`/${accepted.slug}`} className="mt-2 inline-block font-medium text-accent-text underline">
            {t("invite.openTournament")}
          </Link>
        )}
      </Alert>
    );
  } else if (state.kind === "loading" || authLoading) {
    content = <p className="text-[13px] text-fg-muted" role="status">{t("invite.loading")}</p>;
  } else if (state.kind === "error") {
    content = <Alert tone="danger" role="alert" title={t("invite.invalidTitle")}>{state.message}</Alert>;
  } else {
    const { invitation, accountExists } = state;
    const roleName = invitation.role === "admin" ? t("invite.roleAdmin") : t("invite.roleDataEntry");
    const signedInEmail = user?.email?.toLowerCase() ?? null;
    content = (
      <Card>
        <CardHeader
          headingLevel="h2"
          icon={<MailCheck aria-hidden="true" />}
          title={invitation.tournamentName}
          description={t("invite.summary", { role: roleName, email: invitation.email })}
        />
        <CardBody className="space-y-4">
          {invitation.state !== "pending" ? (
            <Alert tone="warning" role="alert" title={t(STATE_TITLES[invitation.state])}>
              {t("invite.askForNew")}
            </Alert>
          ) : (
            <>
              <p className="text-xs text-fg-muted">
                {t("invite.expires", { time: formatDateTime(invitation.expiresAt, { dateStyle: "medium", timeStyle: "short" }) })}
              </p>
              {error && <Alert tone="danger" role="alert">{error}</Alert>}
              {user ? (
                signedInEmail === invitation.email ? (
                  <Button variant="primary" loading={busy} onClick={() => void run(accept)}>
                    {t("invite.accept")}
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <Alert tone="warning" role="alert">
                      {t("invite.wrongAccount", { current: user.email || "", expected: invitation.email })}
                    </Alert>
                    <Button onClick={() => void logout()}>{t("invite.signOut")}</Button>
                  </div>
                )
              ) : accountExists ? (
                <form className="space-y-3" onSubmit={(event) => signInAndAccept(event, invitation.email)}>
                  <p className="text-[13px] text-fg-muted">{t("invite.signInIntro")}</p>
                  <Input label={t("invite.email")} value={invitation.email} readOnly autoComplete="username" />
                  <Input
                    label={t("invite.password")}
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" variant="primary" loading={busy}>{t("invite.signInAccept")}</Button>
                    <Link href="/forgot-password" className="text-xs text-accent-text underline">{t("invite.forgotPassword")}</Link>
                  </div>
                </form>
              ) : (
                <form className="space-y-3" onSubmit={(event) => createAccount(event, invitation.email)}>
                  <p className="text-[13px] text-fg-muted">{t("invite.createIntro")}</p>
                  <Input label={t("invite.email")} value={invitation.email} readOnly autoComplete="username" />
                  <Input
                    label={t("invite.name")}
                    required
                    maxLength={100}
                    autoComplete="name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                  <Input
                    label={t("invite.newPassword")}
                    help={t("invite.passwordHelp")}
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <Input
                    label={t("invite.confirmPassword")}
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                  <Button type="submit" variant="primary" loading={busy}>{t("invite.createAccept")}</Button>
                </form>
              )}
            </>
          )}
        </CardBody>
      </Card>
    );
  }

  return (
    <PublicFormShell>
      <PageHeader className="mb-4" title={t("invite.title")} />
      {content}
    </PublicFormShell>
  );
}
