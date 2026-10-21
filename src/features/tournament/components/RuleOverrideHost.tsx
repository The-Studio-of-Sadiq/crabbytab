"use client";

import React, { useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { useI18n } from "@/components/i18n/I18nProvider";
import { registerRuleOverrideRequester } from "@/features/tournament/application/ruleOverridePrompt";
import type { RuleOverride, TournamentRuleError } from "@/features/tournament/application/stateGuards";

interface PendingRequest {
  error: TournamentRuleError;
  resolve(override: RuleOverride | null): void;
}

/**
 * Asks a tournament administrator for a reason when an action is refused only by rules that may be
 * overridden. The reason is stored in the audit log with the action. Cancelling keeps the refusal,
 * so the page shows the original error. Mount once, for administrators only.
 */
export function RuleOverrideHost() {
  const { t } = useI18n();
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [reason, setReason] = useState("");
  const [showError, setShowError] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => registerRuleOverrideRequester((error) =>
    new Promise<RuleOverride | null>((resolve) => {
      setReason("");
      setShowError(false);
      setPending({ error, resolve });
    })
  ), []);

  if (!pending) return null;

  const finish = (override: RuleOverride | null) => {
    pending.resolve(override);
    setPending(null);
  };
  const confirm = () => {
    if (!reason.trim()) {
      setShowError(true);
      return;
    }
    finish({ reason: reason.trim() });
  };

  return (
    <Dialog
      open
      role="alertdialog"
      onClose={() => finish(null)}
      initialFocusRef={cancelRef}
      title={t("tabroom.common.override.title")}
      description={t("tabroom.common.override.description")}
      icon={<ShieldAlert className="text-warning" aria-hidden="true" />}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={() => finish(null)}>
            {t("common.noCancel")}
          </Button>
          <Button variant="danger" onClick={confirm}>
            {t("tabroom.common.override.confirm")}
          </Button>
        </>
      }
    >
      <ul className="mb-3 list-disc space-y-1 pl-5" aria-label={t("tabroom.common.override.rulesLabel")}>
        {pending.error.violations.map((violation, index) => (
          <li key={`${violation.rule}-${index}`}>{violation.message}</li>
        ))}
      </ul>
      <Textarea
        label={t("tabroom.common.override.reasonLabel")}
        required
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        error={showError ? t("tabroom.common.override.reasonRequired") : undefined}
        maxLength={500}
      />
    </Dialog>
  );
}
