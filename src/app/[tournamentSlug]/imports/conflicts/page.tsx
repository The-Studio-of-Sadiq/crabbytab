"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Upload, XCircle } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Checkbox, Textarea } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/Badge";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { applyConflictsPlan, planConflictsImport, type ConflictKind, type ConflictsPlan } from "@/lib/csv/conflictsImport";

const KIND_LABELS: Record<ConflictKind, string> = {
  "adjudicator-team": "Adjudicator – team",
  "adjudicator-adjudicator": "Adjudicator – adjudicator",
  "adjudicator-institution": "Adjudicator – institution",
  "team-institution": "Team – institution",
};

const EXAMPLE = [
  "adjudicator,team,institution,other_adjudicator",
  "Eleanor Vance,Oxford A,,",
  "Eleanor Vance,,,David Kim",
  "david@example.org,,Cambridge Union,",
  ",Oxford A,Cambridge Union,",
].join("\n");

/** Imports conflicts from CSV with a preview; nothing is saved until the organiser confirms. */
export default function ConflictsImportPage() {
  const { teams, adjudicators, institutions, isOwnerOrAdmin, saveEntityBatch } = useTournament();
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<ConflictsPlan | null>(null);
  const [validOnly, setValidOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const counts = useMemo(() => {
    const result = { add: 0, exists: 0, error: 0 };
    for (const row of plan?.rows ?? []) result[row.status] += 1;
    return result;
  }, [plan]);
  const blocked = !plan || plan.fileErrors.length > 0 || counts.add === 0 || (counts.error > 0 && !validOnly);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setText(await file.text());
      setPlan(null);
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Could not read the file." });
    }
  };

  const confirm = async () => {
    if (blocked || saving) return;
    // Plan again against the latest records so nothing is added twice.
    const fresh = planConflictsImport(text, { teams, adjudicators, institutions });
    const applied = applyConflictsPlan(fresh, { teams, adjudicators });
    setSaving(true);
    setMessage(null);
    try {
      await saveEntityBatch({ adjudicatorsUpdated: applied.adjudicators, teamsUpdated: applied.teams }, "Conflicts CSV import");
      setMessage({ tone: "success", text: `${applied.added} conflict${applied.added === 1 ? "" : "s"} imported.` });
      setPlan(null);
      setText("");
      setValidOnly(false);
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Could not save the conflicts." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import conflicts"
        description="Fill exactly two columns per row: adjudicator with team, other_adjudicator or institution; or team with institution. Adjudicators are matched by name or email, teams by name or code, institutions by name or code."
      />

      {!isOwnerOrAdmin && <Alert tone="info">Only tournament administrators can import conflicts.</Alert>}

      <div className="space-y-3">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-border bg-surface px-3 py-1.5 text-xs font-semibold shadow-2xs hover:bg-muted">
          <Upload className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          <span>Choose CSV file</span>
          <input type="file" accept=".csv,text/csv" onChange={handleFile} className="sr-only" />
        </label>
        <Textarea
          label="Or paste CSV text"
          rows={7}
          value={text}
          placeholder={EXAMPLE}
          onChange={(event) => {
            setText(event.target.value);
            setPlan(null);
          }}
          className="font-mono text-xs"
        />
        <Button
          onClick={() => {
            setPlan(planConflictsImport(text, { teams, adjudicators, institutions }));
            setMessage(null);
          }}
          disabled={!text.trim()}
        >
          Preview conflicts
        </Button>
      </div>

      {message && <Alert tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>{message.text}</Alert>}

      {plan && (
        <section className="space-y-3" aria-label="Conflicts preview">
          {plan.fileErrors.length > 0 && (
            <Alert tone="danger" role="alert" title="This file cannot be imported">
              <ul className="list-disc pl-4">{plan.fileErrors.map((error) => <li key={error}>{error}</li>)}</ul>
            </Alert>
          )}
          {plan.ignoredColumns.length > 0 && (
            <Alert tone="warning" title="Columns that will be ignored">{plan.ignoredColumns.join(", ")}</Alert>
          )}
          {plan.rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" role="status">
              <StatusPill tone="success">{counts.add} to add</StatusPill>
              <StatusPill tone="neutral">{counts.exists} already recorded</StatusPill>
              {counts.error > 0 && <StatusPill tone="danger">{counts.error} with errors</StatusPill>}
            </div>
          )}
          {counts.error > 0 && (
            <Checkbox
              label="Import the valid rows only"
              description="Rows with errors are skipped."
              checked={validOnly}
              onChange={(event) => setValidOnly(event.target.checked)}
            />
          )}
          {plan.rows.length > 0 && (
            <TableContainer className="max-h-[60vh]">
              <Table>
                <THead>
                  <TR>
                    <TH align="right">Row</TH>
                    <TH>Conflict</TH>
                    <TH>Type</TH>
                    <TH>Result</TH>
                  </TR>
                </THead>
                <TBody>
                  {plan.rows.map((row) => (
                    <TR key={row.rowNumber}>
                      <TD numeric>{row.rowNumber}</TD>
                      <TD>{row.description}</TD>
                      <TD className="text-xs">{row.kind ? KIND_LABELS[row.kind] : "—"}</TD>
                      <TD className="text-xs">
                        {row.status === "add" && (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Will be added
                          </span>
                        )}
                        {row.issues.map((issue) => (
                          <span
                            key={issue.message}
                            className={`flex gap-1 ${issue.severity === "error" ? "text-danger" : "text-warning"}`}
                          >
                            {issue.severity === "error" ? (
                              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            ) : (
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span>
                              <span className="sr-only">{issue.severity === "error" ? "Error: " : "Note: "}</span>
                              {issue.message}
                            </span>
                          </span>
                        ))}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
          {isOwnerOrAdmin && (
            <Button variant="primary" onClick={confirm} disabled={blocked} loading={saving} loadingText="Importing…">
              Import {counts.add} conflict{counts.add === 1 ? "" : "s"}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
