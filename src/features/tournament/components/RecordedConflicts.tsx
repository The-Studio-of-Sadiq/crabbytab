"use client";

import React, { useMemo, useState } from "react";
import { Download, Trash2 } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Field";
import { Section } from "@/components/ui/Card";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  addTeamInstitutionConflict,
  describeConflict,
  listDeclaredConflicts,
  removeDeclaredConflict,
  type DeclaredConflict,
} from "@/lib/csv/conflictsExport";
import type { ConflictKind } from "@/lib/csv/conflictsImport";
import { conflictsCsv } from "@/lib/csv/participantExports";
import { csvFileStem } from "@/lib/csv/exporters";
import { downloadCsv } from "@/lib/csv/download";

/** Message keys for each conflict kind; shared with the conflicts import page. */
export const CONFLICT_KIND_KEYS: Record<ConflictKind, MessageKey> = {
  "adjudicator-team": "setup.importsExtra.conflicts.kindAdjudicatorTeam",
  "adjudicator-adjudicator": "setup.importsExtra.conflicts.kindAdjudicatorAdjudicator",
  "adjudicator-institution": "setup.importsExtra.conflicts.kindAdjudicatorInstitution",
  "team-institution": "setup.importsExtra.conflicts.kindTeamInstitution",
};

/**
 * Every recorded conflict with removal, a form for team-declared institution conflicts
 * (adjudicators from that institution should not judge the team, beyond its own institution) and
 * a CSV export in the import format.
 */
export function RecordedConflicts() {
  const { t } = useI18n();
  const { tournament, teams, adjudicators, institutions, isOwnerOrAdmin, saveEntityBatch } = useTournament();
  const data = useMemo(() => ({ teams, adjudicators, institutions }), [teams, adjudicators, institutions]);
  const conflicts = useMemo(() => listDeclaredConflicts(data), [data]);
  const [teamId, setTeamId] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);
  const sortedInstitutions = useMemo(() => [...institutions].sort((a, b) => a.name.localeCompare(b.name)), [institutions]);

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: "success", text: success });
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : t("setup.importsExtra.conflicts.saveOneError") });
    } finally {
      setBusy(false);
    }
  };

  const addTeamConflict = (event: React.FormEvent) => {
    event.preventDefault();
    const team = teams.find((item) => item.id === teamId);
    if (!team || !institutionId) {
      setMessage({ tone: "danger", text: t("setup.importsExtra.conflicts.chooseBoth") });
      return;
    }
    void run(
      () => saveEntityBatch({ teamsUpdated: [addTeamInstitutionConflict(team, institutionId)] }, "Team institution conflict"),
      t("setup.importsExtra.conflicts.saved")
    );
  };

  const remove = (conflict: DeclaredConflict) => {
    const changed = removeDeclaredConflict(conflict, data);
    void run(
      () => saveEntityBatch({ adjudicatorsUpdated: changed.adjudicators, teamsUpdated: changed.teams }, "Conflict removed"),
      t("setup.importsExtra.conflicts.removed", { conflict: describeConflict(conflict, data) })
    );
  };

  return (
    <Section
      title={t("setup.importsExtra.conflicts.recordedTitle", { count: conflicts.length })}
      actions={
        <Button
          onClick={() => downloadCsv(csvFileStem(tournament?.slug ?? "tournament", "conflicts"), conflictsCsv(data))}
          disabled={conflicts.length === 0}
        >
          <Download aria-hidden="true" /> {t("setup.importsExtra.conflicts.exportCsv")}
        </Button>
      }
    >
      {message && <Alert tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>{message.text}</Alert>}

      {isOwnerOrAdmin && (
        <form
          onSubmit={addTeamConflict}
          className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-3"
          aria-label={t("setup.importsExtra.conflicts.addFormLabel")}
        >
          <Select label={t("setup.importsExtra.conflicts.team")} value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            <option value="">{t("setup.importsExtra.csv.choose")}</option>
            {sortedTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </Select>
          <Select
            label={t("setup.importsExtra.conflicts.institution")}
            help={t("setup.importsExtra.conflicts.institutionHelp")}
            value={institutionId}
            onChange={(event) => setInstitutionId(event.target.value)}
          >
            <option value="">{t("setup.importsExtra.csv.choose")}</option>
            {sortedInstitutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
          </Select>
          <div className="flex items-end">
            <Button type="submit" variant="primary" loading={busy} loadingText={t("setup.common.saving")}>
              {t("setup.importsExtra.conflicts.addTeamConflict")}
            </Button>
          </div>
        </form>
      )}

      <TableContainer className="max-h-[60vh]">
        <Table>
          <THead>
            <TR>
              <TH>{t("setup.importsExtra.conflicts.conflictColumn")}</TH>
              <TH>{t("setup.importsExtra.csv.type")}</TH>
              <TH align="right"><span className="sr-only">{t("setup.common.actions")}</span></TH>
            </TR>
          </THead>
          <TBody>
            {conflicts.length === 0 && <TableEmpty colSpan={3}>{t("setup.importsExtra.conflicts.empty")}</TableEmpty>}
            {conflicts.map((conflict) => (
              <TR key={conflict.key}>
                <TD>{describeConflict(conflict, data)}</TD>
                <TD className="text-xs">{t(CONFLICT_KIND_KEYS[conflict.kind])}</TD>
                <TD align="right">
                  {isOwnerOrAdmin && (
                    <IconButton
                      label={t("setup.importsExtra.conflicts.removeLabel", { conflict: describeConflict(conflict, data) })}
                      icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => remove(conflict)}
                      disabled={busy}
                    />
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableContainer>
    </Section>
  );
}
