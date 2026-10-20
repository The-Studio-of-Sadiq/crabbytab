"use client";

import React, { useMemo, useState } from "react";
import { Tag } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { Select } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { convertTeamNames, teamsNeedingNames, type TeamNameDisplay } from "@/lib/teamNames";
import type { Institution, Team, Tournament } from "@/types";

/**
 * Tabbycat team names on the Format & teams settings page: which name teams show (long or short)
 * and Tabbycat's `convertteamnames` (institution names moved to the prefix), with a preview.
 */
export function TeamNamingCard({
  tournament,
  teams,
  institutions,
  onSaveTournament,
  onSaveTeams,
}: {
  tournament: Tournament;
  teams: Team[];
  institutions: Institution[];
  onSaveTournament: (tournament: Tournament) => Promise<void>;
  onSaveTeams: (teamsUpdated: Team[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const display: TeamNameDisplay = tournament.preferences?.teamNameDisplay ?? "long";
  const [nextDisplay, setNextDisplay] = useState<TeamNameDisplay>(display);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const conversions = useMemo(() => convertTeamNames(teams, institutions, display), [teams, institutions, display]);
  const stale = useMemo(() => teamsNeedingNames(teams, institutions, display), [teams, institutions, display]);

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
      setStatus(done);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("setup.config.teamNames.saveError"));
    } finally {
      setBusy(false);
      setPreview(false);
      setConfirming(false);
    }
  };

  const saveDisplay = () =>
    run(async () => {
      await onSaveTournament({
        ...tournament,
        preferences: { ...tournament.preferences, teamNameDisplay: nextDisplay },
        updatedAt: new Date().toISOString(),
      });
      const renamed = teamsNeedingNames(teams, institutions, nextDisplay);
      if (renamed.length > 0) await onSaveTeams(renamed);
    }, t("setup.config.teamNames.displaySaved"));

  return (
    <Card>
      <CardHeader
        icon={<Tag aria-hidden="true" />}
        title={t("setup.config.teamNames.title")}
        description={t("setup.config.teamNames.description")}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={t("setup.config.teamNames.displayLabel")}
            value={nextDisplay}
            onChange={(event) => setNextDisplay(event.target.value === "short" ? "short" : "long")}
            wrapperClassName="min-w-[16rem]"
          >
            <option value="long">{t("setup.config.teamNames.displayLong")}</option>
            <option value="short">{t("setup.config.teamNames.displayShort")}</option>
          </Select>
          <Button variant="secondary" disabled={busy || nextDisplay === display} onClick={() => void saveDisplay()}>
            {t("setup.config.teamNames.displaySave")}
          </Button>
        </div>
        {stale.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[13px] text-fg-muted">{t("setup.config.teamNames.stale", { count: stale.length })}</p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void run(() => onSaveTeams(stale), t("setup.config.teamNames.updated"))}
            >
              {t("setup.config.teamNames.update")}
            </Button>
          </div>
        )}
        <div className="space-y-2">
          <p className="text-[13px] text-fg-muted">{t("setup.config.teamNames.convertIntro")}</p>
          <Button variant="secondary" disabled={busy || conversions.length === 0} onClick={() => setPreview(true)}>
            {t("setup.config.teamNames.convert", { count: conversions.length })}
          </Button>
        </div>
        {preview && conversions.length > 0 && (
          <section aria-label={t("setup.config.teamNames.convertTitle")} className="space-y-2">
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>{t("setup.config.teamNames.colNow")}</TH>
                    <TH>{t("setup.config.teamNames.colReference")}</TH>
                    <TH>{t("setup.config.teamNames.colPrefix")}</TH>
                    <TH>{t("setup.config.teamNames.colShown")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {conversions.map(({ team, converted, prefixed }) => (
                    <TR key={team.id}>
                      <TD>{team.name}</TD>
                      <TD>{converted.reference || "—"}</TD>
                      <TD>{prefixed ? t("setup.config.teamNames.yes") : t("setup.config.teamNames.no")}</TD>
                      <TD>{converted.name}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
            <div className="flex gap-2">
              <Button variant="primary" disabled={busy} onClick={() => setConfirming(true)}>
                {t("setup.config.teamNames.convertConfirm")}
              </Button>
              <Button variant="secondary" onClick={() => setPreview(false)}>{t("setup.config.transfer.discard")}</Button>
            </div>
          </section>
        )}
        {error && <Alert role="alert" tone="danger">{error}</Alert>}
        <p role="status" className="text-xs text-fg-muted">{status}</p>
      </CardBody>
      {confirming && (
        <ConfirmActionDialog
          title={t("setup.config.teamNames.convertTitle")}
          description={t("setup.config.teamNames.convertDescription")}
          confirmLabel={t("setup.config.teamNames.convertConfirm")}
          isBusy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void run(
            () => onSaveTeams(conversions.map((conversion) => conversion.converted)),
            t("setup.config.teamNames.converted", { count: conversions.length })
          )}
        />
      )}
    </Card>
  );
}
