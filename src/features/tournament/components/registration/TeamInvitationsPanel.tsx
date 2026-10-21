"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { UserPlus } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Field";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { TeamInvitationSummary } from "@/lib/registration/teamInvitations";
import type { Team } from "@/types";

/**
 * Team invitation links (docs/registration.md, "Team invitations"): speakers add themselves to
 * an existing team. A new link is shown once, to copy and send.
 */
export function TeamInvitationsPanel({ user, tournamentId, teams }: { user: User; tournamentId: string; teams: Team[] }) {
  const { t } = useI18n();
  const [invitations, setInvitations] = useState<TeamInvitationSummary[]>([]);
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<{ teamName: string; link: string } | null>(null);

  const call = useCallback(
    async (method: string, body?: unknown) => {
      const token = await user.getIdToken();
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournamentId)}/registration/team-invitations`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string; invitations?: TeamInvitationSummary[]; link?: string };
      if (!response.ok) throw new Error(result.error || t("setup.registration.teamInvites.failed"));
      setInvitations(result.invitations ?? []);
      return result;
    },
    [user, tournamentId, t]
  );

  useEffect(() => {
    call("GET").catch((failure: unknown) => setError(failure instanceof Error ? failure.message : t("setup.registration.teamInvites.failed")));
  }, [call, t]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("setup.registration.teamInvites.failed"));
    } finally {
      setBusy(false);
    }
  };

  const issue = (id: string) =>
    run(async () => {
      const result = await call("POST", { teamId: id });
      if (result.link) setIssued({ teamName: teams.find((team) => team.id === id)?.name ?? "", link: result.link });
    });

  return (
    <Card className="mt-4">
      <CardHeader
        icon={<UserPlus aria-hidden="true" />}
        title={t("setup.registration.teamInvites.title")}
        description={t("setup.registration.teamInvites.description")}
      />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label={t("setup.registration.teamInvites.team")}
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
            wrapperClassName="min-w-[16rem]"
          >
            <option value="">{t("setup.registration.teamInvites.chooseTeam")}</option>
            {teams.filter((team) => !team.isSwing).map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </Select>
          <Button variant="secondary" disabled={!teamId || busy} onClick={() => void issue(teamId)}>
            {t("setup.registration.teamInvites.create")}
          </Button>
        </div>
        {issued && (
          <Alert tone="success" role="status">
            <p>{t("setup.registration.teamInvites.issued", { team: issued.teamName })}</p>
            <code className="break-all text-xs">{issued.link}</code>
            <div className="mt-2">
              <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(issued.link)}>
                {t("setup.registration.teamInvites.copy")}
              </Button>
            </div>
          </Alert>
        )}
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        {invitations.length > 0 && (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>{t("setup.registration.teamInvites.team")}</TH>
                  <TH>{t("setup.registration.teamInvites.status")}</TH>
                  <TH>{t("setup.registration.teamInvites.joined")}</TH>
                  <TH align="right">{t("setup.common.actions")}</TH>
                </TR>
              </THead>
              <TBody>
                {invitations.map((invitation) => (
                  <TR key={invitation.id}>
                    <TD>{teams.find((team) => team.id === invitation.teamId)?.name ?? invitation.teamName}</TD>
                    <TD>
                      <Badge tone={invitation.status === "active" ? "success" : "neutral"}>
                        {invitation.status === "active" ? t("setup.registration.teamInvites.active") : t("setup.registration.teamInvites.revoked")}
                      </Badge>
                    </TD>
                    <TD>{invitation.joined}</TD>
                    <TD align="right">
                      <span className="inline-flex gap-2">
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void issue(invitation.teamId)}>
                          {t("setup.registration.teamInvites.newLink")}
                        </Button>
                        {invitation.status === "active" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void run(async () => {
                              await call("DELETE", { teamId: invitation.teamId });
                            })}
                          >
                            {t("setup.registration.teamInvites.revoke")}
                          </Button>
                        )}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </CardBody>
    </Card>
  );
}
