"use client";

import React from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { MessageKey } from "@/lib/i18n";
import type { InstitutionResponseItem } from "@/lib/registration/institutionResponse";

const STATUS_KEYS: Record<InstitutionResponseItem["status"], MessageKey> = {
  pending: "register.response.statusPending",
  approving: "register.response.statusPending",
  approved: "register.response.statusApproved",
  rejected: "register.response.statusRejected",
};

const KIND_KEYS: Record<InstitutionResponseItem["kind"], MessageKey> = {
  team: "register.response.kindTeam",
  adjudicator: "register.response.kindAdjudicator",
  institution: "register.response.kindInstitution",
};

/** A coach's view of what their institution registered (Tabbycat reg-inst-view-response). */
export function InstitutionResponseCard({ items }: { items: InstitutionResponseItem[] }) {
  const { t, formatDateTime } = useI18n();
  return (
    <Card>
      <CardHeader title={t("register.response.title")} description={t("register.response.description")} />
      <CardBody>
        {items.length === 0 ? (
          <p className="text-[13px] text-fg-muted">{t("register.response.empty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-fg">
                    {t(KIND_KEYS[item.kind])}: {item.name}
                  </p>
                  {item.speakers && item.speakers.length > 0 && (
                    <p className="text-xs text-fg-muted">{item.speakers.join(", ")}</p>
                  )}
                  {item.kind === "institution" && (
                    <p className="text-xs text-fg-muted">
                      {t("register.response.places", {
                        teams: String(item.teamsAllocated ?? item.teamsRequested ?? 0),
                        adjudicators: String(item.adjudicatorsAllocated ?? item.adjudicatorsRequested ?? 0),
                      })}
                    </p>
                  )}
                  <p className="text-xs text-fg-subtle">{formatDateTime(item.submittedAt)}</p>
                </div>
                <Badge tone={item.status === "approved" ? "success" : item.status === "rejected" ? "danger" : "neutral"}>
                  {t(STATUS_KEYS[item.status])}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
