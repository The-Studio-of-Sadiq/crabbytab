"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Trash2, Upload, XCircle } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Card";
import { Button, buttonClasses, IconButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/Badge";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  applyVenueConstraintsPlan,
  listVenueConstraints,
  planVenueConstraintsImport,
  withoutVenueConstraint,
  withVenueConstraint,
  type ConstraintRow,
  type ConstraintsPlan,
  type ConstraintSubjectKind,
} from "@/lib/venues/constraintEdits";
import { normaliseCategory } from "@/lib/venues/venues";

const KIND_KEYS: Record<ConstraintSubjectKind, MessageKey> = {
  team: "setup.importsExtra.venueConstraints.kindTeam",
  adjudicator: "setup.importsExtra.venueConstraints.kindAdjudicator",
  institution: "setup.importsExtra.venueConstraints.kindInstitution",
};

/** CSV example shown as the placeholder; column names are parsed back, so they stay in English. */
const EXAMPLE = [
  "team,adjudicator,institution,category,priority",
  "Oxford A,,,Step-free,10",
  ",Eleanor Vance,,Ground floor,5",
  ",,Cambridge Union,Purple,1",
].join("\n");

/** A label that opens a visually hidden file input; it shows a focus ring while the input has focus. */
const fileLabelClasses = cn(
  buttonClasses({ variant: "secondary" }),
  "cursor-pointer focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-background"
);

/**
 * Soft, ranked room preferences (Tabbycat venue constraints): a team, adjudicator or institution
 * prefers rooms of a category. Room allocation meets them where it can, higher priority first.
 */
export default function VenueConstraintsPage() {
  const { t, plural, rich } = useI18n();
  const { tournament, teams, adjudicators, institutions, venues, isOwnerOrAdmin, saveEntityBatch } = useTournament();
  const subjects = useMemo(() => ({ teams, adjudicators, institutions }), [teams, adjudicators, institutions]);
  const rows = useMemo(() => listVenueConstraints(subjects), [subjects]);
  const categories = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const venue of venues) if (venue.category?.trim()) byKey.set(normaliseCategory(venue.category), venue.category.trim());
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  }, [venues]);

  const [kind, setKind] = useState<ConstraintSubjectKind>("team");
  const [subjectId, setSubjectId] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<ConstraintsPlan | null>(null);
  const [validOnly, setValidOnly] = useState(false);

  const options = kind === "team" ? teams : kind === "adjudicator" ? adjudicators : institutions;
  const sortedOptions = useMemo(() => [...options].sort((a, b) => a.name.localeCompare(b.name)), [options]);

  const save = async (batch: Parameters<typeof saveEntityBatch>[0], summary: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await saveEntityBatch(batch, "Room preferences");
      setMessage({ tone: "success", text: summary });
      return true;
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : t("setup.importsExtra.venueConstraints.saveError") });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const batchFor = (target: ConstraintSubjectKind, id: string, update: <T extends { venueConstraints?: { category: string; priority: number }[] }>(item: T) => T) => {
    if (target === "team") return { teamsUpdated: teams.filter((item) => item.id === id).map(update) };
    if (target === "adjudicator") return { adjudicatorsUpdated: adjudicators.filter((item) => item.id === id).map(update) };
    return { institutionsUpdated: institutions.filter((item) => item.id === id).map(update) };
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(priority);
    if (!subjectId || !category.trim() || !Number.isInteger(value)) {
      setMessage({ tone: "danger", text: t("setup.importsExtra.venueConstraints.invalidForm") });
      return;
    }
    try {
      const batch = batchFor(kind, subjectId, (item) => withVenueConstraint(item, { category, priority: value }));
      if (await save(batch, t("setup.importsExtra.venueConstraints.saved"))) setCategory("");
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : t("setup.importsExtra.venueConstraints.saveError") });
    }
  };

  const remove = (row: ConstraintRow) =>
    save(
      batchFor(row.kind, row.subjectId, (item) => withoutVenueConstraint(item, row.category)),
      t("setup.importsExtra.venueConstraints.removed", { name: row.subjectName, category: row.category })
    );

  const counts = useMemo(() => {
    const result = { add: 0, update: 0, exists: 0, error: 0 };
    for (const row of plan?.rows ?? []) result[row.status] += 1;
    return result;
  }, [plan]);
  const importBlocked =
    !plan || plan.fileErrors.length > 0 || counts.add + counts.update === 0 || (counts.error > 0 && !validOnly);

  const confirmImport = async () => {
    if (importBlocked) return;
    // Plan again against the latest records so nothing is applied twice.
    const applied = applyVenueConstraintsPlan(planVenueConstraintsImport(text, subjects), subjects);
    const ok = await save(
      { teamsUpdated: applied.teams, adjudicatorsUpdated: applied.adjudicators, institutionsUpdated: applied.institutions },
      plural("setup.importsExtra.venueConstraints.imported", applied.applied)
    );
    if (ok) {
      setPlan(null);
      setText("");
      setValidOnly(false);
    }
  };

  const resultLabel = (status: "add" | "update" | "exists") =>
    status === "add"
      ? t("setup.importsExtra.csv.willBeAdded")
      : status === "update"
        ? t("setup.importsExtra.csv.priorityWillChange")
        : t("setup.importsExtra.csv.alreadyRecordedRow");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("setup.importsExtra.venueConstraints.title")}
        description={rich("setup.importsExtra.venueConstraints.description", {
          link: (label) => (
            <Link href={`/${tournament?.slug}/imports/venues`} className="text-accent-text underline">
              {label}
            </Link>
          ),
        })}
      />

      {!isOwnerOrAdmin && <Alert tone="info">{t("setup.importsExtra.venueConstraints.adminOnly")}</Alert>}
      {message && <Alert tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>{message.text}</Alert>}

      {isOwnerOrAdmin && (
        <form
          onSubmit={add}
          className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-5"
          aria-label={t("setup.importsExtra.venueConstraints.formLabel")}
        >
          <Select
            label={t("setup.importsExtra.venueConstraints.for")}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as ConstraintSubjectKind);
              setSubjectId("");
            }}
          >
            {(Object.keys(KIND_KEYS) as ConstraintSubjectKind[]).map((item) => (
              <option key={item} value={item}>{t(KIND_KEYS[item])}</option>
            ))}
          </Select>
          <Select
            label={t(KIND_KEYS[kind])}
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
            wrapperClassName="sm:col-span-2"
          >
            <option value="">{t("setup.importsExtra.csv.choose")}</option>
            {sortedOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
          <Input
            label={t("setup.importsExtra.venueConstraints.roomCategory")}
            value={category}
            list="room-categories"
            onChange={(event) => setCategory(event.target.value)}
          />
          <Input
            label={t("setup.importsExtra.venueConstraints.priority")}
            type="number"
            step={1}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          />
          <datalist id="room-categories">
            {categories.map((name) => <option key={name} value={name} />)}
          </datalist>
          <div className="sm:col-span-5">
            <Button type="submit" variant="primary" loading={busy} loadingText={t("setup.common.saving")}>
              {t("setup.importsExtra.venueConstraints.addPreference")}
            </Button>
          </div>
        </form>
      )}

      <TableContainer>
        <Table>
          <THead>
            <TR>
              <TH>{t("setup.importsExtra.venueConstraints.who")}</TH>
              <TH>{t("setup.importsExtra.csv.type")}</TH>
              <TH>{t("setup.importsExtra.venueConstraints.roomCategory")}</TH>
              <TH align="right">{t("setup.importsExtra.venueConstraints.priority")}</TH>
              <TH align="right"><span className="sr-only">{t("setup.common.actions")}</span></TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 && <TableEmpty colSpan={5}>{t("setup.importsExtra.venueConstraints.empty")}</TableEmpty>}
            {rows.map((row) => (
              <TR key={`${row.kind}-${row.subjectId}-${row.category}`}>
                <TD>{row.subjectName}</TD>
                <TD className="text-xs">{t(KIND_KEYS[row.kind])}</TD>
                <TD>
                  {row.category}
                  {!categories.some((name) => normaliseCategory(name) === normaliseCategory(row.category)) && (
                    <span className="ms-2 text-xs text-warning">{t("setup.importsExtra.venueConstraints.noRoomHasCategory")}</span>
                  )}
                </TD>
                <TD numeric>{row.priority}</TD>
                <TD align="right">
                  {isOwnerOrAdmin && (
                    <IconButton
                      label={t("setup.importsExtra.venueConstraints.removeLabel", { name: row.subjectName, category: row.category })}
                      icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => void remove(row)}
                      disabled={busy}
                    />
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableContainer>

      {isOwnerOrAdmin && (
        <Section title={t("setup.importsExtra.venueConstraints.csvTitle")} description={t("setup.importsExtra.venueConstraints.csvHelp")}>
          <label className={fileLabelClasses}>
            <Upload aria-hidden="true" />
            <span>{t("setup.importsExtra.csv.chooseFile")}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                try {
                  setText(await file.text());
                  setPlan(null);
                } catch (error) {
                  setMessage({ tone: "danger", text: error instanceof Error ? error.message : t("setup.importsExtra.csv.readError") });
                }
              }}
            />
          </label>
          <Textarea
            label={t("setup.importsExtra.csv.pasteLabel")}
            rows={5}
            value={text}
            placeholder={EXAMPLE}
            onChange={(event) => {
              setText(event.target.value);
              setPlan(null);
            }}
            className="font-mono text-xs"
          />
          <Button onClick={() => setPlan(planVenueConstraintsImport(text, subjects))} disabled={!text.trim()}>
            {t("setup.importsExtra.venueConstraints.preview")}
          </Button>
          {plan && (
            <div className="space-y-3">
              {plan.fileErrors.length > 0 && (
                <Alert tone="danger" role="alert" title={t("setup.importsExtra.csv.fileErrorsTitle")}>
                  <ul className="list-disc ps-4">{plan.fileErrors.map((error) => <li key={error}>{error}</li>)}</ul>
                </Alert>
              )}
              {plan.ignoredColumns.length > 0 && (
                <Alert tone="warning" title={t("setup.importsExtra.csv.ignoredColumnsTitle")}>{plan.ignoredColumns.join(", ")}</Alert>
              )}
              {plan.rows.length > 0 && (
                <div className="flex flex-wrap gap-2" role="status">
                  <StatusPill tone="success">{t("setup.importsExtra.csv.toAdd", { count: counts.add })}</StatusPill>
                  <StatusPill tone="success">{t("setup.importsExtra.csv.toUpdate", { count: counts.update })}</StatusPill>
                  <StatusPill tone="neutral">{t("setup.importsExtra.csv.unchanged", { count: counts.exists })}</StatusPill>
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
                <TableContainer className="max-h-[50vh]">
                  <Table>
                    <THead>
                      <TR>
                        <TH align="right">{t("setup.importsExtra.csv.row")}</TH>
                        <TH>{t("setup.importsExtra.venueConstraints.preferenceColumn")}</TH>
                        <TH>{t("setup.importsExtra.csv.result")}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {plan.rows.map((row) => (
                        <TR key={row.rowNumber}>
                          <TD numeric>{row.rowNumber}</TD>
                          <TD>
                            {row.subjectName
                              ? t("setup.importsExtra.venueConstraints.previewRow", {
                                  name: row.subjectName,
                                  category: row.category ?? "—",
                                  priority: row.priority ?? "—",
                                })
                              : "—"}
                          </TD>
                          <TD className="text-xs">
                            {row.status === "error" ? (
                              // Issue messages come from the CSV planner and are shown as they are (English).
                              row.issues.map((issue) => (
                                <span key={issue} className="flex gap-1 text-danger">
                                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>
                                    <span className="sr-only">{t("setup.importsExtra.csv.errorPrefix")} </span>
                                    {issue}
                                  </span>
                                </span>
                              ))
                            ) : (
                              <span className="inline-flex items-center gap-1 text-success">
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                {resultLabel(row.status)}
                              </span>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableContainer>
              )}
              <Button
                variant="primary"
                onClick={confirmImport}
                disabled={importBlocked}
                loading={busy}
                loadingText={t("setup.importsExtra.csv.importing")}
              >
                {plural("setup.importsExtra.venueConstraints.importButton", counts.add + counts.update)}
              </Button>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
