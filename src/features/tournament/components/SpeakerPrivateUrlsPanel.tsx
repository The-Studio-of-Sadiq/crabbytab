"use client";

import React, { useMemo, useState } from "react";
import { Copy, UserRound } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { Alert } from "@/components/ui/Feedback";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { generatePrivateKey } from "@/lib/privateUrls";
import { assignSpeakerPrivateUrls, getSpeakerPrivatePath, removeSpeakerPrivateUrls } from "@/lib/privateSpeakerUrls";
import type { Team } from "@/types";

/**
 * Optional per-speaker private URLs (Tabbycat gives each speaker their own URL). Team URLs and
 * passcodes are never changed here, so printed links and QR codes keep working.
 */
export function SpeakerPrivateUrlsPanel({
  tournamentSlug,
  teams,
  onSave,
}: {
  tournamentSlug: string;
  teams: Team[];
  onSave: (teamsUpdated: Team[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const rows = useMemo(
    () => teams.flatMap((team) =>
      (team.speakers ?? [])
        .filter((speaker) => speaker.privateUrlKey)
        .map((speaker) => ({ team, speaker }))),
    [teams]
  );
  const missing = teams.reduce(
    (count, team) => count + (team.speakers ?? []).filter((speaker) => !speaker.privateUrlKey || !speaker.privatePasscode).length,
    0
  );

  const run = async (changed: Team[], done: string) => {
    if (changed.length === 0) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await onSave(changed);
      setStatus(done);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("setup.email.privateUrls.speakerUrlsSaveError"));
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <Card>
      <CardHeader
        icon={<UserRound aria-hidden="true" />}
        title={t("setup.email.privateUrls.speakerUrlsTitle")}
        description={t("setup.email.privateUrls.speakerUrlsDescription")}
      />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy || missing === 0}
            loading={busy}
            onClick={() => void run(
              assignSpeakerPrivateUrls(teams, generatePrivateKey),
              t("setup.email.privateUrls.speakerUrlsCreated")
            )}
          >
            {t("setup.email.privateUrls.speakerUrlsCreate", { count: missing })}
          </Button>
          {rows.length > 0 && (
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmRemove(true)}>
              {t("setup.email.privateUrls.speakerUrlsRemove")}
            </Button>
          )}
        </div>
        {error && <Alert role="alert" tone="danger">{error}</Alert>}
        <p role="status" className="text-xs text-fg-muted">{status}</p>
        {rows.length > 0 && (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>{t("setup.email.privateUrls.speakerUrlsSpeaker")}</TH>
                  <TH>{t("setup.email.privateUrls.speakerUrlsTeam")}</TH>
                  <TH>{t("setup.email.privateUrls.speakerUrlsLink")}</TH>
                  <TH>{t("setup.email.privateUrls.colPasscode")}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map(({ team, speaker }) => {
                  const path = getSpeakerPrivatePath(tournamentSlug, speaker.privateUrlKey!);
                  return (
                    <TR key={`${team.id}-${speaker.id}`}>
                      <TD className="font-semibold">{speaker.name}</TD>
                      <TD className="text-fg-muted">{team.name}</TD>
                      <TD>
                        <span className="flex items-center gap-1">
                          <code className="truncate text-xs">{path}</code>
                          <IconButton
                            size="sm"
                            variant="ghost"
                            icon={<Copy aria-hidden="true" />}
                            label={t("setup.email.privateUrls.speakerUrlsCopy", { name: speaker.name })}
                            onClick={() => void navigator.clipboard?.writeText(`${origin}${path}`)}
                          />
                        </span>
                      </TD>
                      <TD><code className="text-xs">{speaker.privatePasscode}</code></TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </CardBody>
      {confirmRemove && (
        <ConfirmActionDialog
          variant="danger"
          title={t("setup.email.privateUrls.speakerUrlsRemoveTitle")}
          description={t("setup.email.privateUrls.speakerUrlsRemoveDescription")}
          confirmLabel={t("setup.email.privateUrls.speakerUrlsRemove")}
          isBusy={busy}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => void run(removeSpeakerPrivateUrls(teams), t("setup.email.privateUrls.speakerUrlsRemoved"))}
        />
      )}
    </Card>
  );
}
