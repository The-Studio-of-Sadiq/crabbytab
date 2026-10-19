"use client";

import React, { useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
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
      title="This action breaks a tournament rule"
      description="Proceed only if the tab room has agreed to. Your reason is recorded in the audit log."
      icon={<ShieldAlert className="text-warning" aria-hidden="true" />}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={() => finish(null)}>
            No, cancel
          </Button>
          <Button variant="danger" onClick={confirm}>
            Override and continue
          </Button>
        </>
      }
    >
      <ul className="mb-3 list-disc space-y-1 pl-5" aria-label="Rules that would be overridden">
        {pending.error.violations.map((violation, index) => (
          <li key={`${violation.rule}-${index}`}>{violation.message}</li>
        ))}
      </ul>
      <Textarea
        label="Reason for overriding"
        required
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        error={showError ? "Enter a reason to continue." : undefined}
        maxLength={500}
      />
    </Dialog>
  );
}
