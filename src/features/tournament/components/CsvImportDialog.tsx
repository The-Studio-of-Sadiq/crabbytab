"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Upload, XCircle } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Alert } from "@/components/ui/Feedback";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/Badge";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { createEntityId } from "@/features/tournament/application/entities";
import {
  buildImportCommit,
  chosenAction,
  countRowsWithErrors,
  validateNewInstitutions,
  planImport,
  type ImportChoices,
  type ImportKind,
  type ImportPlan,
  type RowAction,
} from "@/lib/csv/importPlan";
import { effectiveSpeakerCategories } from "@/lib/speakerCategories";

const NOUNS: Record<ImportKind, { plural: string; title: string }> = {
  institutions: { plural: "institutions", title: "Institutions" },
  teams: { plural: "teams", title: "Teams" },
  adjudicators: { plural: "adjudicators", title: "Adjudicators" },
};

const COLUMN_HELP: Record<ImportKind, string> = {
  institutions: "Columns: name (required), code, region. Quote names that contain commas.",
  teams:
    "Columns: name (required), institution, code, speaker1 … speaker5, speakerN_email, speakerN_categories, break_categories, division.",
  adjudicators: "Columns: name (required), email, institution, score, trainee, independent, gender, region.",
};

const PLACEHOLDERS: Record<ImportKind, string> = {
  institutions: "name,code,region\nOxford Union Society,OXF,UK\n\"University of Dhaka, Bangladesh\",DU,Dhaka",
  teams: "name,institution,speaker1,speaker2,speaker1_categories\nOxford A,Oxford Union Society,Jane Doe,John Smith,ESL",
  adjudicators: "name,email,institution,score,trainee\nEleanor Vance,eleanor@example.org,Oxford Union Society,8.5,no",
};

const ACTION_LABELS: Record<RowAction, string> = { create: "Create", update: "Update existing", skip: "Skip" };

/**
 * CSV import with a preview: paste or upload, review what each row would do, then confirm.
 * Nothing is saved until the confirm button; the save is one write per collection.
 */
export function CsvImportDialog({ kind, open, onClose }: { kind: ImportKind; open: boolean; onClose: () => void }) {
  const {
    tournament,
    institutions,
    teams,
    adjudicators,
    breakCategories,
    saveEntityBatch,
    saveTournament,
  } = useTournament();
  const [text, setText] = useState("");
  const [readError, setReadError] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [choices, setChoices] = useState<ImportChoices>({});
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const noun = NOUNS[kind];

  const speakerCategories = useMemo(
    () => effectiveSpeakerCategories(tournament?.preferences.speakerCategories, teams),
    [tournament?.preferences.speakerCategories, teams]
  );
  const context = {
    institutions,
    teams,
    adjudicators,
    breakCategories,
    speakerCategories,
    substantiveSpeakers: tournament?.preferences.substantiveSpeakers,
  };

  const reset = () => {
    setText("");
    setPlan(null);
    setChoices({});
    setReadError("");
    setSaveError("");
    setOnlyProblems(false);
  };
  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setText(await file.text());
      setReadError("");
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "Could not read the selected file.");
    }
  };

  const preview = () => {
    setPlan(planImport(kind, text, context));
    setChoices({});
    setSaveError("");
  };

  const errorRows = plan ? countRowsWithErrors(plan) : 0;
  const counts = useMemo(() => {
    const result = { create: 0, update: 0, skip: 0 };
    for (const row of plan?.rows ?? []) result[chosenAction(row, choices)] += 1;
    return result;
  }, [plan, choices]);
  const institutionErrors = plan ? validateNewInstitutions(plan, choices, institutions) : [];
  const blocked =
    !plan ||
    plan.fileErrors.length > 0 ||
    (errorRows > 0 && !choices.validRowsOnly) ||
    institutionErrors.length > 0 ||
    counts.create + counts.update === 0;

  const setAction = (rowNumber: number, action: RowAction) =>
    setChoices((current) => ({ ...current, actions: { ...current.actions, [rowNumber]: action } }));
  const editInstitution = (key: string, edit: { name?: string; code?: string; create?: boolean }) =>
    setChoices((current) => ({
      ...current,
      newInstitutions: { ...current.newInstitutions, [key]: { ...current.newInstitutions?.[key], ...edit } },
    }));

  const confirm = async () => {
    if (!plan || !tournament || saving) return;
    // Re-plan against the latest data so a record added meanwhile (e.g. by a collaborator) is matched.
    const fresh = planImport(kind, text, context);
    const { commit, errors } = buildImportCommit(fresh, choices, {
      ...context,
      tournamentId: tournament.id,
      createId: createEntityId,
    });
    if (!commit) {
      setPlan(fresh);
      setSaveError(errors.join(" "));
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      if (commit.speakerCategories) {
        await saveTournament({
          ...tournament,
          preferences: { ...tournament.preferences, speakerCategories: commit.speakerCategories },
        });
      }
      await saveEntityBatch(commit, `${noun.title} CSV import`);
      setSaving(false);
      reset();
      onClose();
    } catch (error) {
      setSaving(false);
      setSaveError(error instanceof Error ? error.message : "Could not save the import.");
    }
  };

  const visibleRows = (plan?.rows ?? []).filter(
    (row) => !onlyProblems || row.issues.length > 0 || row.match || row.duplicateOfRow !== undefined
  );

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!saving}
      size="lg"
      icon={<Upload className="text-accent" />}
      title={`Import ${noun.plural} from CSV`}
      description={plan ? "Check what each row will do. Nothing is saved until you confirm." : COLUMN_HELP[kind]}
      className="sm:max-w-5xl"
      footer={
        plan ? (
          <>
            <Button variant="ghost" onClick={() => setPlan(null)} disabled={saving}>
              Back to the CSV
            </Button>
            <Button
              variant="primary"
              onClick={confirm}
              disabled={blocked}
              loading={saving}
              loadingText="Importing…"
            >
              Import {counts.create} new{counts.update > 0 ? `, update ${counts.update}` : ""}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" onClick={preview} disabled={!text.trim()}>
              Preview import
            </Button>
          </>
        )
      }
    >
      {!plan ? (
        <div className="space-y-3">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-border bg-surface px-3 py-1.5 text-xs font-semibold shadow-2xs hover:bg-muted">
            <Upload className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            <span>Choose CSV file</span>
            <input type="file" accept=".csv,text/csv" onChange={handleFile} className="sr-only" />
          </label>
          {text && <span className="ml-2 text-xs text-fg-muted">CSV loaded ({text.split(/\r?\n/).length} lines)</span>}
          <Textarea
            label="Or paste CSV text"
            rows={9}
            value={text}
            placeholder={PLACEHOLDERS[kind]}
            onChange={(event) => setText(event.target.value)}
            className="font-mono text-xs"
          />
          {readError && <Alert tone="danger" role="alert">{readError}</Alert>}
        </div>
      ) : (
        <div className="space-y-4">
          {plan.fileErrors.length > 0 && (
            <Alert tone="danger" role="alert" title="This file cannot be imported">
              <ul className="list-disc pl-4">
                {plan.fileErrors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            </Alert>
          )}
          {plan.ignoredColumns.length > 0 && (
            <Alert tone="warning" title="Columns that will be ignored">
              {plan.ignoredColumns.join(", ")}
            </Alert>
          )}

          {plan.rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs" role="status">
              <StatusPill tone="success">{counts.create} to create</StatusPill>
              <StatusPill tone="info">{counts.update} to update</StatusPill>
              <StatusPill tone="neutral">{counts.skip} skipped</StatusPill>
              {errorRows > 0 && <StatusPill tone="danger">{errorRows} with errors</StatusPill>}
              <Checkbox
                className="ml-auto"
                label="Only rows that need attention"
                checked={onlyProblems}
                onChange={(event) => setOnlyProblems(event.target.checked)}
              />
            </div>
          )}

          {errorRows > 0 && (
            <Alert tone="danger" title={`${errorRows} row${errorRows === 1 ? " has" : "s have"} errors`}>
              <p>Fix the file and preview again, or import the other rows and skip these.</p>
              <Checkbox
                className="mt-2"
                label="Import the valid rows only"
                checked={choices.validRowsOnly === true}
                onChange={(event) => setChoices((current) => ({ ...current, validRowsOnly: event.target.checked }))}
              />
            </Alert>
          )}

          {plan.newInstitutions.length > 0 && (
            <section aria-labelledby="new-institutions-heading" className="space-y-2">
              <h3 id="new-institutions-heading" className="text-[13px] font-semibold">
                New institutions ({plan.newInstitutions.length})
              </h3>
              <p className="text-xs text-fg-muted">
                These institutions are not registered yet. They are created with the import; untick one to keep its name
                on the {noun.plural} without linking it (no institution conflicts then).
              </p>
              <TableContainer>
                <Table>
                  <THead>
                    <TR>
                      <TH>Create</TH>
                      <TH>Name</TH>
                      <TH>Code</TH>
                      <TH>Used on rows</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {plan.newInstitutions.map((item) => {
                      const edit = choices.newInstitutions?.[item.key];
                      const create = edit?.create !== false;
                      return (
                        <TR key={item.key}>
                          <TD>
                            <input
                              type="checkbox"
                              aria-label={`Create ${item.name}`}
                              checked={create}
                              onChange={(event) => editInstitution(item.key, { create: event.target.checked })}
                            />
                          </TD>
                          <TD>
                            <Input
                              aria-label={`Name for ${item.name}`}
                              value={edit?.name ?? item.name}
                              disabled={!create}
                              onChange={(event) => editInstitution(item.key, { name: event.target.value })}
                            />
                          </TD>
                          <TD className="w-32">
                            <Input
                              aria-label={`Code for ${item.name}`}
                              value={edit?.code ?? item.code}
                              disabled={!create}
                              onChange={(event) => editInstitution(item.key, { code: event.target.value })}
                            />
                          </TD>
                          <TD className="text-xs text-fg-muted">{item.rowNumbers.join(", ")}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableContainer>
              {institutionErrors.length > 0 && (
                <Alert tone="danger" role="alert">
                  <ul className="list-disc pl-4">
                    {institutionErrors.map((error) => <li key={error}>{error}</li>)}
                  </ul>
                </Alert>
              )}
            </section>
          )}

          {plan.newSpeakerCategories.length > 0 && (
            <Alert tone="info" title="New speaker categories">
              {plan.newSpeakerCategories.join(", ")} will be added to the speaker categories (not public until you
              change that on the Speaker categories page).
            </Alert>
          )}

          {plan.rows.length > 0 && (
            <TableContainer className="max-h-[50vh]">
              <Table>
                <THead>
                  <TR>
                    <TH align="right">Row</TH>
                    <TH>{noun.title}</TH>
                    <TH>Matches</TH>
                    <TH>Action</TH>
                    <TH>Notes</TH>
                  </TR>
                </THead>
                <TBody>
                  {visibleRows.map((row) => (
                    <TR key={row.rowNumber}>
                      <TD numeric>{row.rowNumber}</TD>
                      <TD>
                        <div className="font-medium">{row.label}</div>
                        <div className="text-xs text-fg-muted">{row.details}</div>
                      </TD>
                      <TD className="text-xs">
                        {row.match ? `${row.match.name} (${row.match.reason})` : row.duplicateOfRow ? `Row ${row.duplicateOfRow}` : "—"}
                      </TD>
                      <TD>
                        {row.actions.length > 1 ? (
                          <Select
                            aria-label={`Action for row ${row.rowNumber}`}
                            value={chosenAction(row, choices)}
                            onChange={(event) => setAction(row.rowNumber, event.target.value as RowAction)}
                            className="w-40"
                          >
                            {row.actions.map((action) => (
                              <option key={action} value={action}>{ACTION_LABELS[action]}</option>
                            ))}
                          </Select>
                        ) : (
                          <span className="text-xs text-fg-muted">{ACTION_LABELS[row.defaultAction]}</span>
                        )}
                      </TD>
                      <TD className="text-xs">
                        {row.issues.length === 0 ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> OK
                          </span>
                        ) : (
                          <ul className="space-y-0.5">
                            {row.issues.map((issue) => (
                              <li
                                key={issue.message}
                                className={issue.severity === "error" ? "flex gap-1 text-danger" : "flex gap-1 text-warning"}
                              >
                                {issue.severity === "error" ? (
                                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                ) : (
                                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                )}
                                <span>
                                  <span className="sr-only">{issue.severity === "error" ? "Error: " : "Warning: "}</span>
                                  {issue.message}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}

          {saveError && <Alert tone="danger" role="alert">{saveError}</Alert>}
        </div>
      )}
    </Dialog>
  );
}
