"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Upload, XCircle } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Checkbox, Textarea } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/Badge";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { CONFLICT_KIND_KEYS, RecordedConflicts } from "@/features/tournament/components/RecordedConflicts";
import { applyConflictsPlan, planConflictsImport, type ConflictsPlan } from "@/lib/csv/conflictsImport";

/** CSV example shown as the placeholder; column names are parsed back, so they stay in English. */
const EXAMPLE = [
  "adjudicator,team,institution,other_adjudicator",
  "Eleanor Vance,Oxford A,,",
  "Eleanor Vance,,,David Kim",
  "david@example.org,,Cambridge Union,",
  ",Oxford A,Cambridge Union,",
].join("\n");

/** A label that opens a visually hidden file input; it shows a focus ring while the input has focus. */
const fileLabelClasses = cn(
  buttonClasses({ variant: "secondary" }),
  "cursor-pointer focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-background"
);

/** Imports conflicts from CSV with a preview; nothing is saved until the organiser confirms. */
export default function ConflictsImportPage() {
  const { t, plural } = useI18n();
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
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : t("setup.importsExtra.csv.readError") });
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
      setMessage({ tone: "success", text: plural("setup.importsExtra.conflicts.imported", applied.added) });
      setPlan(null);
      setText("");
      setValidOnly(false);
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : t("setup.importsExtra.conflicts.saveError") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("setup.importsExtra.conflicts.title")} description={t("setup.importsExtra.conflicts.description")} />

      {!isOwnerOrAdmin && <Alert tone="info">{t("setup.importsExtra.conflicts.adminOnly")}</Alert>}

      <div className="space-y-3">
        <label className={fileLabelClasses}>
          <Upload aria-hidden="true" />
          <span>{t("setup.importsExtra.csv.chooseFile")}</span>
          <input type="file" accept=".csv,text/csv" onChange={handleFile} className="sr-only" />
        </label>
        <Textarea
          label={t("setup.importsExtra.csv.pasteLabel")}
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
          {t("setup.importsExtra.conflicts.preview")}
        </Button>
      </div>

      {message && <Alert tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>{message.text}</Alert>}

      {plan && (
        <section className="space-y-3" aria-label={t("setup.importsExtra.conflicts.previewLabel")}>
          {plan.fileErrors.length > 0 && (
            <Alert tone="danger" role="alert" title={t("setup.importsExtra.csv.fileErrorsTitle")}>
              <ul className="list-disc ps-4">{plan.fileErrors.map((error) => <li key={error}>{error}</li>)}</ul>
            </Alert>
          )}
          {plan.ignoredColumns.length > 0 && (
            <Alert tone="warning" title={t("setup.importsExtra.csv.ignoredColumnsTitle")}>{plan.ignoredColumns.join(", ")}</Alert>
          )}
          {plan.rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" role="status">
              <StatusPill tone="success">{t("setup.importsExtra.csv.toAdd", { count: counts.add })}</StatusPill>
              <StatusPill tone="neutral">{t("setup.importsExtra.csv.alreadyRecorded", { count: counts.exists })}</StatusPill>
              {counts.error > 0 && (
                <StatusPill tone="danger">{t("setup.importsExtra.csv.withErrors", { count: counts.error })}</StatusPill>
              )}
            </div>
          )}
          {counts.error > 0 && (
            <Checkbox
              label={t("setup.importsExtra.csv.validOnly")}
              description={t("setup.importsExtra.csv.validOnlyHelp")}
              checked={validOnly}
              onChange={(event) => setValidOnly(event.target.checked)}
            />
          )}
          {plan.rows.length > 0 && (
            <TableContainer className="max-h-[60vh]">
              <Table>
                <THead>
                  <TR>
                    <TH align="right">{t("setup.importsExtra.csv.row")}</TH>
                    <TH>{t("setup.importsExtra.conflicts.conflictColumn")}</TH>
                    <TH>{t("setup.importsExtra.csv.type")}</TH>
                    <TH>{t("setup.importsExtra.csv.result")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {plan.rows.map((row) => (
                    <TR key={row.rowNumber}>
                      <TD numeric>{row.rowNumber}</TD>
                      <TD>{row.description}</TD>
                      <TD className="text-xs">{row.kind ? t(CONFLICT_KIND_KEYS[row.kind]) : "—"}</TD>
                      <TD className="text-xs">
                        {row.status === "add" && (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("setup.importsExtra.csv.willBeAdded")}
                          </span>
                        )}
                        {/* Issue messages come from the CSV planner and are shown as they are (English). */}
                        {row.issues.map((issue) => (
                          <span
                            key={issue.message}
                            className={cn("flex gap-1", issue.severity === "error" ? "text-danger" : "text-warning")}
                          >
                            {issue.severity === "error" ? (
                              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            ) : (
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span>
                              <span className="sr-only">
                                {issue.severity === "error"
                                  ? t("setup.importsExtra.csv.errorPrefix")
                                  : t("setup.importsExtra.csv.notePrefix")}{" "}
                              </span>
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
            <Button
              variant="primary"
              onClick={confirm}
              disabled={blocked}
              loading={saving}
              loadingText={t("setup.importsExtra.csv.importing")}
            >
              {plural("setup.importsExtra.conflicts.importButton", counts.add)}
            </Button>
          )}
        </section>
      )}

      <RecordedConflicts />
    </div>
  );
}
