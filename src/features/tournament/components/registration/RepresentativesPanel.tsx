"use client";

import React, { useState } from "react";
import { CheckCircle2, Copy, RotateCw, XCircle } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { RegistrationCounters, RepresentativeSummary } from "@/lib/registration/types";
import { StatusPill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Field";
import type { IssuedRepresentativeLink, RegistrationClient } from "./registrationClient";

/**
 * Institution representatives: each gets a personal link that fixes their institution on the
 * registration form and may raise or lower its quota.
 */
export function RepresentativesPanel({
  client,
  representatives,
  counters,
  onChange,
}: {
  client: RegistrationClient;
  representatives: RepresentativeSummary[];
  counters: RegistrationCounters;
  onChange: (representatives: RepresentativeSummary[]) => void;
}) {
  const [institutionName, setInstitutionName] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [teamQuota, setTeamQuota] = useState("");
  const [adjudicatorQuota, setAdjudicatorQuota] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<IssuedRepresentativeLink | null>(null);
  const [revoking, setRevoking] = useState<RepresentativeSummary | null>(null);
  const { t } = useI18n();

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t("setup.registration.representativesFailed"));
    } finally {
      setBusy(null);
    }
  };

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    void run("add", async () => {
      const result = await client.addRepresentative({ institutionName, email, name, teamQuota, adjudicatorQuota });
      onChange(result.representatives);
      setIssued(result.link);
      setInstitutionName("");
      setEmail("");
      setName("");
      setTeamQuota("");
      setAdjudicatorQuota("");
    });
  };

  return (
    <Card>
      <CardHeader
        title={t("setup.registration.representativesTitle")}
        description={t("setup.registration.representativesDescription")}
      />
      <CardBody className="space-y-4">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-3">
          <Input label={t("setup.registration.institution")} required maxLength={120} value={institutionName} onChange={(event) => setInstitutionName(event.target.value)} />
          <Input label={t("setup.registration.representativeEmail")} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <Input label={t("setup.registration.representativeName")} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          <Input
            label={t("setup.registration.teamPlaces")}
            help={t("setup.registration.placesHelp")}
            type="number"
            min={0}
            value={teamQuota}
            onChange={(event) => setTeamQuota(event.target.value)}
          />
          <Input
            label={t("setup.registration.adjudicatorPlaces")}
            help={t("setup.registration.placesHelp")}
            type="number"
            min={0}
            value={adjudicatorQuota}
            onChange={(event) => setAdjudicatorQuota(event.target.value)}
          />
          <div className="flex items-end">
            <Button type="submit" variant="primary" loading={busy === "add"} disabled={busy !== null}>
              {t("setup.registration.addAndSend")}
            </Button>
          </div>
        </form>

        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        {issued && (
          <Alert tone={issued.delivered ? "success" : "warning"} role="status" title={t(issued.delivered ? "setup.registration.linkEmailed" : "setup.registration.linkNotEmailed", { email: issued.email })}>
            {issued.error && <p>{issued.error}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                readOnly
                aria-label={t("setup.registration.linkFor", { email: issued.email })}
                value={issued.link}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 font-mono text-[11px]"
              />
              <Button size="sm" onClick={() => void navigator.clipboard?.writeText(issued.link)}>
                <Copy aria-hidden="true" />
                {t("setup.common.copy")}
              </Button>
            </div>
            <p className="mt-1 text-xs">{t("setup.registration.linkShownOnce")}</p>
          </Alert>
        )}

        {representatives.length === 0 ? (
          <p className="text-xs text-fg-muted">{t("setup.registration.noRepresentatives")}</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {representatives.map((representative) => {
              const used = counters.institutions[representative.institution.key] ?? { teams: 0, adjudicators: 0 };
              return (
                <li key={representative.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-fg">
                      {representative.institution.name}
                      <StatusPill
                        tone={representative.status === "active" ? "success" : "neutral"}
                        icon={representative.status === "active" ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
                      >
                        {t(representative.status === "active" ? "setup.registration.representativeActive" : "setup.registration.representativeRevoked")}
                      </StatusPill>
                    </p>
                    <p className="text-xs text-fg-muted">
                      {[
                        representative.name,
                        representative.email,
                        representative.teamQuota !== undefined
                          ? t("setup.registration.usageTeamsQuota", { used: used.teams, quota: representative.teamQuota })
                          : t("setup.registration.usageTeams", { used: used.teams }),
                        representative.adjudicatorQuota !== undefined
                          ? t("setup.registration.usageAdjudicatorsQuota", { used: used.adjudicators, quota: representative.adjudicatorQuota })
                          : t("setup.registration.usageAdjudicators", { used: used.adjudicators }),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {representative.deliveryError && <p className="text-xs text-warning">{representative.deliveryError}</p>}
                  </div>
                  {representative.status === "active" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        loading={busy === `resend-${representative.id}`}
                        disabled={busy !== null}
                        aria-label={t("setup.registration.newLinkFor", { email: representative.email })}
                        onClick={() =>
                          void run(`resend-${representative.id}`, async () => {
                            const result = await client.resendRepresentative(representative.id);
                            onChange(result.representatives);
                            setIssued(result.link);
                          })
                        }
                      >
                        <RotateCw aria-hidden="true" />
                        {t("setup.registration.newLink")}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={busy === `revoke-${representative.id}`}
                        disabled={busy !== null}
                        aria-label={t("setup.registration.revokeFor", { institution: representative.institution.name })}
                        onClick={() => setRevoking(representative)}
                      >
                        <XCircle aria-hidden="true" />
                        {t("setup.registration.revoke")}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      {revoking && (
        <ConfirmActionDialog
          variant="danger"
          title={t("setup.registration.revokeTitle")}
          description={t("setup.registration.revokeDescription", {
            email: revoking.email,
            institution: revoking.institution.name,
          })}
          confirmLabel={t("setup.registration.revokeConfirm")}
          onCancel={() => setRevoking(null)}
          onConfirm={() => {
            const representative = revoking;
            setRevoking(null);
            void run(`revoke-${representative.id}`, async () => {
              onChange((await client.revokeRepresentative(representative.id)).representatives);
            });
          }}
        />
      )}
    </Card>
  );
}
