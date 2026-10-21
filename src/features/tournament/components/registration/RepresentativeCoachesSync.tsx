"use client";

import React, { useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { createEntityId } from "@/features/tournament/application/entities";
import { representativesAsCoaches } from "@/lib/registration/coaches";
import type { RepresentativeSummary } from "@/lib/registration/types";
import type { Institution } from "@/types";

/** Saves the active representatives as coaches of their institutions (lib/registration/coaches.ts). */
export function RepresentativeCoachesSync({
  representatives,
  institutions,
  onSave,
}: {
  representatives: RepresentativeSummary[];
  institutions: Institution[];
  onSave: (institutionsUpdated: Institution[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const plan = representativesAsCoaches(institutions, representatives, createEntityId);
  if (representatives.length === 0) return null;
  return (
    <div className="mt-4 space-y-2">
      <p className="text-[13px] text-fg-muted">{t("setup.registration.coaches.intro")}</p>
      <Button
        variant="secondary"
        disabled={busy || plan.updated.length === 0}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          try {
            await onSave(plan.updated);
            setMessage({
              tone: plan.unmatched.length > 0 ? "info" : "success",
              text: plan.unmatched.length > 0
                ? t("setup.registration.coaches.savedUnmatched", { institutions: plan.unmatched.join(", ") })
                : t("setup.registration.coaches.saved"),
            });
          } catch (failure) {
            setMessage({ tone: "danger", text: failure instanceof Error ? failure.message : t("setup.registration.coaches.failed") });
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("setup.registration.coaches.save", { count: plan.updated.length })}
      </Button>
      {message && <Alert tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>{message.text}</Alert>}
    </div>
  );
}
