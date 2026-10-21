"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { firebaseAuthMessage } from "@/lib/authErrors";
import { MIN_PASSWORD_LENGTH, passwordChangeProblem, type PasswordChangeProblem } from "@/lib/passwordChange";
import { useI18n } from "@/components/i18n/I18nProvider";
import { SetupShell } from "@/components/setup/SetupShell";
import { Alert } from "@/components/ui/Feedback";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import type { MessageKey } from "@/lib/i18n/messages";

const PROBLEM_KEYS: Record<PasswordChangeProblem, MessageKey> = {
  currentRequired: "setup.entry.account.password.currentRequired",
  tooShort: "setup.entry.account.password.tooShort",
  mismatch: "setup.entry.account.password.mismatch",
  unchanged: "setup.entry.account.password.unchanged",
};

/** Change password for the signed-in account (Tabbycat's password change; reset by email stays on /forgot-password). */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { user, loading, configured, changePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent("/account/password")}`);
  }, [loading, user, router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    setSaved(false);
    const problem = passwordChangeProblem({ current, next, confirm });
    if (problem) {
      setError(t(PROBLEM_KEYS[problem], { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setSaved(true);
    } catch (caught) {
      // Firebase error text comes from src/lib/authErrors (English only for now).
      setError(firebaseAuthMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SetupShell maxWidth="max-w-md">
      <Card>
        <CardBody className="space-y-5 p-6 max-sm:p-4">
          <PageHeader
            title={t("setup.entry.account.password.title")}
            description={user?.email ? t("setup.entry.account.password.description", { email: user.email }) : undefined}
          />
          {!user ? (
            <p role="status" className="text-[13px] text-fg-muted">{t("setup.shell.redirectingToSignIn")}</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3" noValidate>
              <Input
                label={t("setup.entry.account.password.current")}
                type="password"
                required
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
              <Input
                label={t("setup.entry.account.password.new")}
                help={t("setup.entry.account.password.newHelp", { min: MIN_PASSWORD_LENGTH })}
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
              <Input
                label={t("setup.entry.account.password.confirm")}
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
              {error && <Alert tone="danger" role="alert">{error}</Alert>}
              {saved && <Alert tone="success" role="status">{t("setup.entry.account.password.saved")}</Alert>}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                loading={busy}
                loadingText={t("setup.entry.auth.pleaseWait")}
                disabled={!configured}
              >
                {t("setup.entry.account.password.submit")}
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
    </SetupShell>
  );
}
