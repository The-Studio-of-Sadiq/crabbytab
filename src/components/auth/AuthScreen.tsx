"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { firebaseAuthMessage } from "@/lib/authErrors";
import { useI18n } from "@/components/i18n/I18nProvider";
import { EntryBrandLink, EntryPreferenceControls } from "@/components/setup/SetupShell";
import { Alert } from "@/components/ui/Feedback";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

type Mode = "login" | "reset";

const linkClass = cn("rounded-sm font-medium text-accent-text underline underline-offset-2", focusRing);

export function AuthScreen({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, rich } = useI18n();
  // Only allow same-site paths, so a crafted ?next=//evil.com can't redirect off-site.
  const rawNext = searchParams.get("next") || "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/tournaments";
  const { configured, signInWithEmail, resetPassword } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const titles = {
    login: { heading: t("setup.entry.auth.loginTitle"), sub: t("setup.entry.auth.loginIntro") },
    reset: { heading: t("setup.entry.auth.resetTitle"), sub: t("setup.entry.auth.resetIntro") },
  } satisfies Record<Mode, { heading: string; sub: string }>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (mode === "login") {
        await signInWithEmail(email.trim(), password);
        router.replace(next);
      } else {
        await resetPassword(email.trim());
        setInfo(t("setup.entry.auth.resetSent"));
      }
    } catch (err) {
      // Firebase error text comes from src/lib/authErrors (English only for now).
      setError(firebaseAuthMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const code = (text: string) => <code className="font-mono">{text}</code>;

  return (
    <div className="themed flex min-h-screen flex-col bg-background text-fg">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-6 py-2.5 max-sm:px-4">
        <EntryBrandLink href="/" />
        <EntryPreferenceControls />
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-16 max-sm:py-8">
        <Card className="w-full max-w-md">
          <CardBody className="space-y-5 p-6 max-sm:p-4">
            <PageHeader title={titles[mode].heading} description={titles[mode].sub} />

            {!configured && (
              <Alert tone="warning" title={t("setup.entry.firebaseNotConfiguredTitle")}>
                {rich("setup.entry.auth.notConfigured", { code })}
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                label={t("setup.common.email")}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {mode !== "reset" && (
                <Input
                  label={t("setup.entry.auth.password")}
                  type="password"
                  required
                  minLength={6}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}

              {error && <Alert tone="danger" role="alert">{error}</Alert>}
              {info && <Alert tone="success" role="status">{info}</Alert>}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                loading={busy}
                loadingText={t("setup.entry.auth.pleaseWait")}
                disabled={!configured}
              >
                {mode === "login" ? t("setup.entry.auth.submitLogin") : t("setup.entry.auth.submitReset")}
              </Button>
            </form>

            <div className="space-y-1 text-xs text-fg-muted">
              {mode === "reset" && (
                <p>
                  {rich("setup.entry.auth.haveAccount", {
                    link: (text) => (
                      <Link href={`/login?next=${encodeURIComponent(next)}`} className={linkClass}>
                        {text}
                      </Link>
                    ),
                  })}
                </p>
              )}
              {mode !== "reset" && (
                <p>
                  {rich("setup.entry.auth.forgotPassword", {
                    link: (text) => (
                      <Link href={`/forgot-password?next=${encodeURIComponent(next)}`} className={linkClass}>
                        {text}
                      </Link>
                    ),
                  })}
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
