"use client";

import React, { useState } from "react";
import { ArrowRightLeft, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";
import type { SlotTransfer } from "@/lib/registration/types";
import { StatusPill, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import type { RegistrationClient } from "./registrationClient";

const STATUS: Record<SlotTransfer["status"], { tone: Tone; label: MessageKey; icon: React.ReactNode }> = {
  pending: { tone: "info", label: "setup.registration.statusPending", icon: <Clock aria-hidden="true" /> },
  approved: { tone: "success", label: "setup.registration.statusApproved", icon: <CheckCircle2 aria-hidden="true" /> },
  rejected: { tone: "neutral", label: "setup.registration.statusRejected", icon: <XCircle aria-hidden="true" /> },
};

/** Place transfers representatives asked for (docs/registration.md, "Slot transfers"). */
export function SlotTransfersPanel({
  client,
  transfers,
  onReviewed,
}: {
  client: RegistrationClient;
  transfers: SlotTransfer[];
  onReviewed: () => Promise<void>;
}) {
  const { t, formatDateTime } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const review = async (transfer: SlotTransfer, decision: "approve" | "reject") => {
    setBusy(`${transfer.id}-${decision}`);
    setError("");
    try {
      await client.reviewTransfer(transfer.id, decision);
      await onReviewed();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : t("setup.registration.transferFailed"));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <CardHeader
        icon={<ArrowRightLeft aria-hidden="true" />}
        title={t("setup.registration.transfersTitle")}
        description={t("setup.registration.transfersDescription")}
      />
      <CardBody className="space-y-3">
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        {transfers.length === 0 ? (
          <EmptyState title={t("setup.registration.noTransfers")} />
        ) : (
          <ul className="divide-y divide-border">
            {transfers.map((transfer) => (
              <li key={transfer.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-[13px]">
                <div>
                  <p className="text-fg">
                    {t("setup.registration.transferSummary", {
                      from: transfer.fromInstitution.name,
                      to: transfer.toInstitution.name,
                      teams: transfer.teams,
                      adjudicators: transfer.adjudicators,
                    })}
                  </p>
                  <p className="text-xs text-fg-muted">{formatDateTime(transfer.requestedAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={STATUS[transfer.status].tone} icon={STATUS[transfer.status].icon}>
                    {t(STATUS[transfer.status].label)}
                  </StatusPill>
                  {transfer.status === "pending" && (
                    <>
                      <Button size="sm" variant="primary" loading={busy === `${transfer.id}-approve`} disabled={busy !== null} onClick={() => void review(transfer, "approve")}>
                        {t("setup.registration.approve")}
                      </Button>
                      <Button size="sm" variant="danger" loading={busy === `${transfer.id}-reject`} disabled={busy !== null} onClick={() => void review(transfer, "reject")}>
                        {t("setup.registration.reject")}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
