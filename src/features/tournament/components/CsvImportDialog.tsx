"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Upload, XCircle } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Alert } from "@/components/ui/Feedback";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Field";
import { focusRing } from "@/components/ui/focus";
import { cn } from "@/components/ui/cn";
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
import type { MessageKey } from "@/lib/i18n";
import { normalizeTeamSeedMode } from "@/lib/teamSeeds";
import type { TeamSeedMode } from "@/types";

/** English collection names for the audit summary, which is saved and so stays untranslated. */
const AUDIT_NOUNS: Record<ImportKind, string> = {
  institutions: "Institutions",
  teams: "Teams",
  adjudicators: "Adjudicators",
};

const TEXT: Record<
  ImportKind,
  { title: MessageKey; columns: MessageKey; heading: MessageKey; newInstitutionsHelp: MessageKey }
> = {
  institutions: {
    title: "setup.imports.csvTitleInstitutions",
    columns: "setup.imports.csvColumnsInstitutions",
    heading: "setup.imports.institutionsTitle",
    newInstitutionsHelp: "setup.imports.csvNewInstitutionsHelpInstitutions",
  },
  teams: {
    title: "setup.imports.csvTitleTeams",
    columns: "setup.imports.csvColumnsTeams",
    heading: "setup.imports.teamsTitle",
    newInstitutionsHelp: "setup.imports.csvNewInstitutionsHelpTeams",
  },
  adjudicators: {
    title: "setup.imports.csvTitleAdjudicators",
    columns: "setup.imports.csvColumnsAdjudicators",
    heading: "setup.imports.adjudicatorsTitle",
    newInstitutionsHelp: "setup.imports.csvNewInstitutionsHelpAdjudicators",
  },
};

/** Example CSV text: column headers are parsed back, so these stay in English. */
const PLACEHOLDERS: Record<ImportKind, string> = {
  institutions: "name,code,region\nOxford Union Society,OXF,UK\n\"University of Dhaka, Bangladesh\",DU,Dhaka",
  teams: "name,institution,speaker1,speaker2,speaker1_categories\nOxford A,Oxford Union Society,Jane Doe,John Smith,ESL",
  adjudicators: "name,email,institution,score,trainee\nEleanor Vance,eleanor@example.org,Oxford Union Society,8.5,no",
};

const ACTION_LABELS: Record<RowAction, MessageKey> = {
  create: "setup.imports.csvActionCreate",
  update: "setup.imports.csvActionUpdate",
  skip: "setup.imports.csvActionSkip",
};

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
  const { t, plural, formatList } = useI18n();
  const kindText = TEXT[kind];

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
    teamSeedMode: tournament?.preferences.teamSeedMode,
  };
  const [seedModeSaving, setSeedModeSaving] = useState(false);
  const [seedModeError, setSeedModeError] = useState("");

  // Tabbycat's "Enable team seed in importer" (show_seed_in_importer), a tournament setting.
  const changeSeedMode = async (mode: TeamSeedMode) => {
    if (!tournament || seedModeSaving) return;
    setSeedModeSaving(true);
    setSeedModeError("");
    try {
      await saveTournament({ ...tournament, preferences: { ...tournament.preferences, teamSeedMode: mode } });
    } catch (error) {
      setSeedModeError(error instanceof Error ? error.message : t("setup.imports.csvSaveError"));
    } finally {
      setSeedModeSaving(false);
    }
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
      setReadError(error instanceof Error ? error.message : t("setup.imports.csvReadError"));
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
      await saveEntityBatch(commit, `${AUDIT_NOUNS[kind]} CSV import`);
      setSaving(false);
      reset();
      onClose();
    } catch (error) {
      setSaving(false);
      setSaveError(error instanceof Error ? error.message : t("setup.imports.csvSaveError"));
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
      icon={<Upload className="text-accent" aria-hidden="true" />}
      title={t(kindText.title)}
      description={plan ? t("setup.imports.csvPreviewDescription") : t(kindText.columns)}
      className="sm:max-w-5xl"
      footer={
        plan ? (
          <>
            <Button variant="ghost" onClick={() => setPlan(null)} disabled={saving}>
              {t("setup.imports.csvBack")}
            </Button>
            <Button
              variant="primary"
              onClick={confirm}
              disabled={blocked}
              loading={saving}
              loadingText={t("setup.imports.csvImporting")}
            >
              {counts.update > 0
                ? t("setup.imports.csvConfirmCreateUpdate", { created: counts.create, updated: counts.update })
                : t("setup.imports.csvConfirmCreate", { created: counts.create })}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              {t("setup.common.cancel")}
            </Button>
            <Button variant="primary" onClick={preview} disabled={!text.trim()}>
              {t("setup.imports.csvPreview")}
            </Button>
          </>
        )
      }
    >
      {!plan ? (
        <div className="space-y-3">
          {kind === "teams" && (
            <Select
              label={t("setup.imports.seedModeLabel")}
              help={t("setup.imports.seedModeHelp")}
              value={normalizeTeamSeedMode(tournament?.preferences.teamSeedMode)}
              disabled={seedModeSaving || !tournament}
              onChange={(event) => void changeSeedMode(event.target.value as TeamSeedMode)}
              wrapperClassName="max-w-md"
            >
              <option value="off">{t("setup.imports.seedModeOff")}</option>
              <option value="numeric">{t("setup.imports.seedModeNumeric")}</option>
              <option value="title">{t("setup.imports.seedModeTitle")}</option>
            </Select>
          )}
          {seedModeError && <Alert tone="danger" role="alert">{seedModeError}</Alert>}
          <div className="flex flex-wrap items-center gap-2">
            {/* The file input is visually hidden; the label shows the focus ring while it has focus. */}
            <label className={cn(buttonClasses({ variant: "secondary" }), "cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent")}>
              <Upload className="text-fg-muted" aria-hidden="true" />
              <span>{t("setup.imports.csvChooseFile")}</span>
              <input type="file" accept=".csv,text/csv" onChange={handleFile} className="sr-only" />
            </label>
            {text && (
              <span role="status" className="text-xs text-fg-muted">
                {plural("setup.imports.csvLoaded", text.split(/\r?\n/).length)}
              </span>
            )}
          </div>
          <Textarea
            label={t("setup.imports.csvPasteLabel")}
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
            <Alert tone="danger" role="alert" title={t("setup.imports.csvFileErrorsTitle")}>
              <ul className="list-disc ps-4">
                {plan.fileErrors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            </Alert>
          )}
          {plan.ignoredColumns.length > 0 && (
            <Alert tone="warning" title={t("setup.imports.csvIgnoredColumnsTitle")}>
              {formatList(plan.ignoredColumns)}
            </Alert>
          )}

          {plan.rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs" role="status">
              <StatusPill tone="success">{t("setup.imports.csvToCreate", { count: counts.create })}</StatusPill>
              <StatusPill tone="info">{t("setup.imports.csvToUpdate", { count: counts.update })}</StatusPill>
              <StatusPill tone="neutral">{t("setup.imports.csvSkipped", { count: counts.skip })}</StatusPill>
              {errorRows > 0 && (
                <StatusPill tone="danger">{t("setup.imports.csvWithErrors", { count: errorRows })}</StatusPill>
              )}
              <Checkbox
                className="ms-auto"
                label={t("setup.imports.csvOnlyProblems")}
                checked={onlyProblems}
                onChange={(event) => setOnlyProblems(event.target.checked)}
              />
            </div>
          )}

          {errorRows > 0 && (
            <Alert tone="danger" title={plural("setup.imports.csvErrorRows", errorRows)}>
              <p>{t("setup.imports.csvErrorRowsHelp")}</p>
              <Checkbox
                className="mt-2"
                label={t("setup.imports.csvValidRowsOnly")}
                checked={choices.validRowsOnly === true}
                onChange={(event) => setChoices((current) => ({ ...current, validRowsOnly: event.target.checked }))}
              />
            </Alert>
          )}

          {plan.newInstitutions.length > 0 && (
            <section aria-labelledby="new-institutions-heading" className="space-y-2">
              <h3 id="new-institutions-heading" className="text-[13px] font-semibold">
                {t("setup.imports.csvNewInstitutionsTitle", { count: plan.newInstitutions.length })}
              </h3>
              <p className="text-xs text-fg-muted">{t(kindText.newInstitutionsHelp)}</p>
              <TableContainer>
                <Table>
                  <THead>
                    <TR>
                      <TH>{t("setup.imports.csvColCreate")}</TH>
                      <TH>{t("setup.common.name")}</TH>
                      <TH>{t("setup.imports.code")}</TH>
                      <TH>{t("setup.imports.csvColUsedOnRows")}</TH>
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
                              aria-label={t("setup.imports.csvCreateInstitution", { name: item.name })}
                              className={cn("h-4 w-4 cursor-pointer rounded-sm accent-[rgb(var(--color-accent))]", focusRing)}
                              checked={create}
                              onChange={(event) => editInstitution(item.key, { create: event.target.checked })}
                            />
                          </TD>
                          <TD>
                            <Input
                              aria-label={t("setup.imports.csvInstitutionNameFor", { name: item.name })}
                              value={edit?.name ?? item.name}
                              disabled={!create}
                              onChange={(event) => editInstitution(item.key, { name: event.target.value })}
                            />
                          </TD>
                          <TD className="w-32">
                            <Input
                              aria-label={t("setup.imports.csvInstitutionCodeFor", { name: item.name })}
                              value={edit?.code ?? item.code}
                              disabled={!create}
                              onChange={(event) => editInstitution(item.key, { code: event.target.value })}
                            />
                          </TD>
                          <TD className="text-xs text-fg-muted">{formatList(item.rowNumbers.map(String))}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableContainer>
              {institutionErrors.length > 0 && (
                <Alert tone="danger" role="alert">
                  <ul className="list-disc ps-4">
                    {institutionErrors.map((error) => <li key={error}>{error}</li>)}
                  </ul>
                </Alert>
              )}
            </section>
          )}

          {plan.newSpeakerCategories.length > 0 && (
            <Alert tone="info" title={t("setup.imports.csvNewSpeakerCategoriesTitle")}>
              {t("setup.imports.csvNewSpeakerCategoriesBody", { names: formatList(plan.newSpeakerCategories) })}
            </Alert>
          )}

          {plan.rows.length > 0 && (
            <TableContainer className="max-h-[50vh]">
              <Table>
                <caption className="sr-only">{t("setup.imports.csvRowsCaption")}</caption>
                <THead>
                  <TR>
                    <TH align="right">{t("setup.imports.csvColRow")}</TH>
                    <TH>{t(kindText.heading)}</TH>
                    <TH>{t("setup.imports.csvColMatches")}</TH>
                    <TH>{t("setup.imports.csvColAction")}</TH>
                    <TH>{t("setup.imports.csvColNotes")}</TH>
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
                        {/* The match reason comes from src/lib/csv/importPlan and is shown as it is (English). */}
                        {row.match
                          ? `${row.match.name} (${row.match.reason})`
                          : row.duplicateOfRow
                            ? t("setup.imports.csvDuplicateOfRow", { row: row.duplicateOfRow })
                            : "—"}
                      </TD>
                      <TD>
                        {row.actions.length > 1 ? (
                          <Select
                            aria-label={t("setup.imports.csvActionFor", { row: row.rowNumber })}
                            value={chosenAction(row, choices)}
                            onChange={(event) => setAction(row.rowNumber, event.target.value as RowAction)}
                            className="w-40"
                          >
                            {row.actions.map((action) => (
                              <option key={action} value={action}>{t(ACTION_LABELS[action])}</option>
                            ))}
                          </Select>
                        ) : (
                          <span className="text-xs text-fg-muted">{t(ACTION_LABELS[row.defaultAction])}</span>
                        )}
                      </TD>
                      <TD className="text-xs">
                        {/* Issue messages come from src/lib/csv and are shown as they are (English). */}
                        {row.issues.length === 0 ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("setup.imports.csvRowOk")}
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
                                  <span className="sr-only">
                                    {issue.severity === "error"
                                      ? t("setup.imports.csvIssueError")
                                      : t("setup.imports.csvIssueWarning")}{" "}
                                  </span>
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
