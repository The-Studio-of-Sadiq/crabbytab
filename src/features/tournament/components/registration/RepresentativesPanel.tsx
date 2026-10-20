"use client";

import React, { useState } from "react";
import { Copy, RotateCw, XCircle } from "lucide-react";
import type { RegistrationCounters, RepresentativeSummary } from "@/lib/registration/types";
import { StatusPill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not update representatives.");
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
        title="Institution representatives"
        description="Each representative gets a personal link to register their institution's teams and adjudicators. Adding the same person and institution again issues a new link."
      />
      <CardBody className="space-y-4">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-3">
          <Input label="Institution" required maxLength={120} value={institutionName} onChange={(event) => setInstitutionName(event.target.value)} />
          <Input label="Representative email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <Input label="Representative name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          <Input
            label="Team places"
            help="Empty: the default per-institution limit."
            type="number"
            min={0}
            value={teamQuota}
            onChange={(event) => setTeamQuota(event.target.value)}
          />
          <Input
            label="Adjudicator places"
            help="Empty: the default per-institution limit."
            type="number"
            min={0}
            value={adjudicatorQuota}
            onChange={(event) => setAdjudicatorQuota(event.target.value)}
          />
          <div className="flex items-end">
            <Button type="submit" variant="primary" loading={busy === "add"} disabled={busy !== null}>
              Add and send link
            </Button>
          </div>
        </form>

        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        {issued && (
          <Alert tone={issued.delivered ? "success" : "warning"} role="status" title={issued.delivered ? `Link emailed to ${issued.email}` : `Link not emailed to ${issued.email}`}>
            {issued.error && <p>{issued.error}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                readOnly
                aria-label={`Registration link for ${issued.email}`}
                value={issued.link}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 font-mono text-[11px]"
              />
              <Button size="sm" onClick={() => void navigator.clipboard?.writeText(issued.link)}>
                <Copy aria-hidden="true" />
                Copy
              </Button>
            </div>
            <p className="mt-1 text-xs">Shown once: only a hash of the link is stored.</p>
          </Alert>
        )}

        {representatives.length === 0 ? (
          <p className="text-xs text-fg-muted">No representatives yet.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {representatives.map((representative) => {
              const used = counters.institutions[representative.institution.key] ?? { teams: 0, adjudicators: 0 };
              return (
                <li key={representative.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-fg">
                      {representative.institution.name}
                      <StatusPill tone={representative.status === "active" ? "success" : "neutral"}>
                        {representative.status === "active" ? "Active" : "Revoked"}
                      </StatusPill>
                    </p>
                    <p className="text-xs text-fg-muted">
                      {representative.name ? `${representative.name} · ` : ""}
                      {representative.email} · teams {used.teams}
                      {representative.teamQuota !== undefined ? ` / ${representative.teamQuota}` : ""} · adjudicators {used.adjudicators}
                      {representative.adjudicatorQuota !== undefined ? ` / ${representative.adjudicatorQuota}` : ""}
                    </p>
                    {representative.deliveryError && <p className="text-xs text-warning">{representative.deliveryError}</p>}
                  </div>
                  {representative.status === "active" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        loading={busy === `resend-${representative.id}`}
                        disabled={busy !== null}
                        aria-label={`Send a new link to ${representative.email}`}
                        onClick={() =>
                          void run(`resend-${representative.id}`, async () => {
                            const result = await client.resendRepresentative(representative.id);
                            onChange(result.representatives);
                            setIssued(result.link);
                          })
                        }
                      >
                        <RotateCw aria-hidden="true" />
                        New link
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={busy === `revoke-${representative.id}`}
                        disabled={busy !== null}
                        aria-label={`Revoke the link for ${representative.institution.name}`}
                        onClick={() => {
                          if (!window.confirm(`Revoke ${representative.email}'s link for ${representative.institution.name}? Submissions already made stay in the queue.`)) return;
                          void run(`revoke-${representative.id}`, async () => {
                            onChange((await client.revokeRepresentative(representative.id)).representatives);
                          });
                        }}
                      >
                        <XCircle aria-hidden="true" />
                        Revoke
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
