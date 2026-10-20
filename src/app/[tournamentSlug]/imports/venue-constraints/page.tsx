"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Trash2, Upload, XCircle } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, IconButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/Badge";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
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

const KIND_LABELS: Record<ConstraintSubjectKind, string> = {
  team: "Team",
  adjudicator: "Adjudicator",
  institution: "Institution",
};

const EXAMPLE = [
  "team,adjudicator,institution,category,priority",
  "Oxford A,,,Step-free,10",
  ",Eleanor Vance,,Ground floor,5",
  ",,Cambridge Union,Purple,1",
].join("\n");

/**
 * Soft, ranked room preferences (Tabbycat venue constraints): a team, adjudicator or institution
 * prefers rooms of a category. Room allocation meets them where it can, higher priority first.
 */
export default function VenueConstraintsPage() {
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
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Could not save the room preference." });
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
      setMessage({ tone: "danger", text: "Choose who it is for, a category and a whole-number priority." });
      return;
    }
    try {
      const batch = batchFor(kind, subjectId, (item) => withVenueConstraint(item, { category, priority: value }));
      if (await save(batch, "Room preference saved.")) setCategory("");
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Could not save the room preference." });
    }
  };

  const remove = (row: ConstraintRow) =>
    save(
      batchFor(row.kind, row.subjectId, (item) => withoutVenueConstraint(item, row.category)),
      `Removed ${row.subjectName}'s ${row.category} preference.`
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
      `${applied.applied} room preference${applied.applied === 1 ? "" : "s"} imported.`
    );
    if (ok) {
      setPlan(null);
      setText("");
      setValidOnly(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Room preferences"
        description={
          <>
            Soft, ranked room constraints: a team, adjudicator or institution prefers rooms of a category (set on the{" "}
            <Link href={`/${tournament?.slug}/imports/venues`} className="underline">Venues</Link> page). Room allocation
            meets them where it can, a higher priority beating any number of lower ones, and never at the cost of a hard
            room requirement. Unmet preferences show in the draw check.
          </>
        }
      />

      {!isOwnerOrAdmin && <Alert tone="info">Only tournament administrators can change room preferences.</Alert>}
      {message && <Alert tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>{message.text}</Alert>}

      {isOwnerOrAdmin && (
        <form onSubmit={add} className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-5" aria-label="Add a room preference">
          <Select label="For" value={kind} onChange={(event) => { setKind(event.target.value as ConstraintSubjectKind); setSubjectId(""); }}>
            {(Object.keys(KIND_LABELS) as ConstraintSubjectKind[]).map((item) => <option key={item} value={item}>{KIND_LABELS[item]}</option>)}
          </Select>
          <Select label={KIND_LABELS[kind]} value={subjectId} onChange={(event) => setSubjectId(event.target.value)} wrapperClassName="sm:col-span-2">
            <option value="">Choose…</option>
            {sortedOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
          <Input
            label="Room category"
            value={category}
            list="room-categories"
            onChange={(event) => setCategory(event.target.value)}
          />
          <Input label="Priority" type="number" step={1} value={priority} onChange={(event) => setPriority(event.target.value)} />
          <datalist id="room-categories">
            {categories.map((name) => <option key={name} value={name} />)}
          </datalist>
          <div className="sm:col-span-5">
            <Button type="submit" variant="primary" loading={busy} loadingText="Saving…">Add preference</Button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-fg-muted">No room preferences yet.</p>
      ) : (
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>Who</TH>
                <TH>Type</TH>
                <TH>Room category</TH>
                <TH align="right">Priority</TH>
                <TH align="right"><span className="sr-only">Actions</span></TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={`${row.kind}-${row.subjectId}-${row.category}`}>
                  <TD>{row.subjectName}</TD>
                  <TD className="text-xs">{KIND_LABELS[row.kind]}</TD>
                  <TD>
                    {row.category}
                    {!categories.some((name) => normaliseCategory(name) === normaliseCategory(row.category)) && (
                      <span className="ml-2 text-xs text-warning">no room has this category</span>
                    )}
                  </TD>
                  <TD numeric>{row.priority}</TD>
                  <TD align="right">
                    {isOwnerOrAdmin && (
                      <IconButton
                        label={`Remove ${row.subjectName}'s ${row.category} preference`}
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
      )}

      {isOwnerOrAdmin && (
        <section className="space-y-3" aria-labelledby="room-preferences-csv">
          <h2 id="room-preferences-csv" className="text-sm font-semibold text-fg">Import from CSV</h2>
          <p className="text-xs text-fg-muted">
            One preference per row: fill exactly one of team, adjudicator (name or email) or institution (name or code), plus
            category and a whole-number priority. A row for a category the subject already has updates its priority.
          </p>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-border bg-surface px-3 py-1.5 text-xs font-semibold shadow-2xs hover:bg-muted">
            <Upload className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            <span>Choose CSV file</span>
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
                  setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Could not read the file." });
                }
              }}
            />
          </label>
          <Textarea
            label="Or paste CSV text"
            rows={5}
            value={text}
            placeholder={EXAMPLE}
            onChange={(event) => { setText(event.target.value); setPlan(null); }}
            className="font-mono text-xs"
          />
          <Button onClick={() => setPlan(planVenueConstraintsImport(text, subjects))} disabled={!text.trim()}>
            Preview preferences
          </Button>
          {plan && (
            <div className="space-y-3">
              {plan.fileErrors.length > 0 && (
                <Alert tone="danger" role="alert" title="This file cannot be imported">
                  <ul className="list-disc pl-4">{plan.fileErrors.map((error) => <li key={error}>{error}</li>)}</ul>
                </Alert>
              )}
              {plan.ignoredColumns.length > 0 && (
                <Alert tone="warning" title="Columns that will be ignored">{plan.ignoredColumns.join(", ")}</Alert>
              )}
              {plan.rows.length > 0 && (
                <div className="flex flex-wrap gap-2" role="status">
                  <StatusPill tone="success">{counts.add} to add</StatusPill>
                  <StatusPill tone="success">{counts.update} to update</StatusPill>
                  <StatusPill tone="neutral">{counts.exists} unchanged</StatusPill>
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
                <TableContainer className="max-h-[50vh]">
                  <Table>
                    <THead>
                      <TR>
                        <TH align="right">Row</TH>
                        <TH>Preference</TH>
                        <TH>Result</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {plan.rows.map((row) => (
                        <TR key={row.rowNumber}>
                          <TD numeric>{row.rowNumber}</TD>
                          <TD>{row.subjectName ? `${row.subjectName}: ${row.category} (priority ${row.priority})` : "—"}</TD>
                          <TD className="text-xs">
                            {row.status === "error" ? (
                              row.issues.map((issue) => (
                                <span key={issue} className="flex gap-1 text-danger">
                                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span><span className="sr-only">Error: </span>{issue}</span>
                                </span>
                              ))
                            ) : (
                              <span className="inline-flex items-center gap-1 text-success">
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                {row.status === "add" ? "Will be added" : row.status === "update" ? "Priority will change" : "Already recorded"}
                              </span>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableContainer>
              )}
              <Button variant="primary" onClick={confirmImport} disabled={importBlocked} loading={busy} loadingText="Importing…">
                Import {counts.add + counts.update} preference{counts.add + counts.update === 1 ? "" : "s"}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
