"use client";

import React, { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import type { SlotTransfer } from "@/lib/registration/types";
import { StatusPill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import type { RegistrationClient } from "./registrationClient";

const STATUS_TONE = { pending: "info", approved: "success", rejected: "neutral" } as const;

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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const review = async (transfer: SlotTransfer, decision: "approve" | "reject") => {
    setBusy(`${transfer.id}-${decision}`);
    setError("");
    try {
      await client.reviewTransfer(transfer.id, decision);
      await onReviewed();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Could not review the transfer.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <CardHeader
        icon={<ArrowRightLeft aria-hidden="true" />}
        title="Place transfers"
        description="Representatives can ask to give team or adjudicator places to another institution. Approving moves the places between the two representatives' limits."
      />
      <CardBody className="space-y-3">
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        {transfers.length === 0 ? (
          <EmptyState title="No transfer requests" />
        ) : (
          <ul className="divide-y divide-border">
            {transfers.map((transfer) => (
              <li key={transfer.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-[13px]">
                <div>
                  <p className="text-fg">
                    {transfer.fromInstitution.name} → {transfer.toInstitution.name}: {transfer.teams} team and {transfer.adjudicators} adjudicator place(s)
                  </p>
                  <p className="text-xs text-fg-muted">{new Date(transfer.requestedAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={STATUS_TONE[transfer.status]}>{transfer.status}</StatusPill>
                  {transfer.status === "pending" && (
                    <>
                      <Button size="sm" variant="primary" loading={busy === `${transfer.id}-approve`} disabled={busy !== null} onClick={() => void review(transfer, "approve")}>
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" loading={busy === `${transfer.id}-reject`} disabled={busy !== null} onClick={() => void review(transfer, "reject")}>
                        Reject
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
