"use client";

import React, { useMemo, useState } from "react";
import { Download, Trash2 } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { Button, IconButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Field";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import {
  addTeamInstitutionConflict,
  conflictsCsv,
  describeConflict,
  listDeclaredConflicts,
  removeDeclaredConflict,
  type DeclaredConflict,
} from "@/lib/csv/conflictsExport";
import type { ConflictKind } from "@/lib/csv/conflictsImport";
import { csvFileStem } from "@/lib/csv/exporters";
import { downloadCsv } from "@/lib/csv/download";

const KIND_LABELS: Record<ConflictKind, string> = {
  "adjudicator-team": "Adjudicator – team",
  "adjudicator-adjudicator": "Adjudicator – adjudicator",
  "adjudicator-institution": "Adjudicator – institution",
  "team-institution": "Team – institution",
};

/**
 * Every recorded conflict with removal, a form for team-declared institution conflicts
 * (adjudicators from that institution should not judge the team, beyond its own institution) and
 * a CSV export in the import format.
 */
export function RecordedConflicts() {
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
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Could not save the conflict." });
    } finally {
      setBusy(false);
    }
  };

  const addTeamConflict = (event: React.FormEvent) => {
    event.preventDefault();
    const team = teams.find((item) => item.id === teamId);
    if (!team || !institutionId) {
      setMessage({ tone: "danger", text: "Choose a team and an institution." });
      return;
    }
    void run(
      () => saveEntityBatch({ teamsUpdated: [addTeamInstitutionConflict(team, institutionId)] }, "Team institution conflict"),
      "Conflict saved."
    );
  };

  const remove = (conflict: DeclaredConflict) => {
    const changed = removeDeclaredConflict(conflict, data);
    void run(
      () => saveEntityBatch({ adjudicatorsUpdated: changed.adjudicators, teamsUpdated: changed.teams }, "Conflict removed"),
      `Removed ${describeConflict(conflict, data)}.`
    );
  };

  return (
    <section className="space-y-3" aria-labelledby="recorded-conflicts-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="recorded-conflicts-heading" className="text-sm font-semibold text-fg">
          Recorded conflicts ({conflicts.length})
        </h2>
        <Button
          onClick={() => downloadCsv(csvFileStem(tournament?.slug ?? "tournament", "conflicts"), conflictsCsv(data))}
          disabled={conflicts.length === 0}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export conflicts CSV
        </Button>
      </div>
      {message && <Alert tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>{message.text}</Alert>}

      {isOwnerOrAdmin && (
        <form onSubmit={addTeamConflict} className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-3" aria-label="Add a team–institution conflict">
          <Select label="Team" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            <option value="">Choose…</option>
            {sortedTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </Select>
          <Select
            label="Conflicts with institution"
            help="Adjudicators from this institution should not judge the team."
            value={institutionId}
            onChange={(event) => setInstitutionId(event.target.value)}
          >
            <option value="">Choose…</option>
            {sortedInstitutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
          </Select>
          <div className="flex items-end">
            <Button type="submit" variant="primary" loading={busy} loadingText="Saving…">Add team conflict</Button>
          </div>
        </form>
      )}

      {conflicts.length > 0 && (
        <TableContainer className="max-h-[60vh]">
          <Table>
            <THead>
              <TR>
                <TH>Conflict</TH>
                <TH>Type</TH>
                <TH align="right"><span className="sr-only">Actions</span></TH>
              </TR>
            </THead>
            <TBody>
              {conflicts.map((conflict) => (
                <TR key={conflict.key}>
                  <TD>{describeConflict(conflict, data)}</TD>
                  <TD className="text-xs">{KIND_LABELS[conflict.kind]}</TD>
                  <TD align="right">
                    {isOwnerOrAdmin && (
                      <IconButton
                        label={`Remove conflict ${describeConflict(conflict, data)}`}
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
      )}
    </section>
  );
}
