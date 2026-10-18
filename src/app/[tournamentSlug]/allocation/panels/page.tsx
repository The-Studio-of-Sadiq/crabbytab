"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Layers, Plus, Save, Trash2, Upload, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import type { Adjudicator, PreformedPanel } from "@/types";
import {
  assignToPanel,
  emptyPreformedPanel,
  panelMemberIds,
  panelsFromPreformedIds,
  removeFromPanels,
  savePreformedPanelsCommand,
  validatePreformedPanels,
  type PanelRole,
} from "@/features/tournament/application/preformedPanels";

function newPanelId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `panel-${crypto.randomUUID()}`
    : `panel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function PreformedPanelsPage() {
  const { tournament, rounds, activeRound, setActiveRound, adjudicators, updateRound, recordAuditEvent } =
    useTournament();
  const [draftByRound, setDraftByRound] = useState<Record<string, PreformedPanel[]>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const round = activeRound;
  const panels = useMemo(
    () => (round ? draftByRound[round.id] ?? round.preformedPanels ?? [] : []),
    [round, draftByRound]
  );
  const dirty = Boolean(round && draftByRound[round.id]);
  const errors = useMemo(() => validatePreformedPanels(panels, adjudicators), [panels, adjudicators]);
  const adjudicatorsById = useMemo(() => new Map(adjudicators.map((item) => [item.id, item])), [adjudicators]);
  const placedIds = useMemo(() => new Set(panels.flatMap(panelMemberIds)), [panels]);
  const sortedAdjudicators = useMemo(
    () => [...adjudicators].sort((a, b) => b.baseScore - a.baseScore || a.name.localeCompare(b.name)),
    [adjudicators]
  );
  const preferenceOn = Boolean(tournament?.preferences?.usePreformedPanels);

  const setPanels = (next: PreformedPanel[]) => {
    if (!round) return;
    setMessage(null);
    setDraftByRound((current) => ({ ...current, [round.id]: next }));
  };

  const handleSave = async () => {
    if (!round) return;
    setSaving(true);
    setMessage(null);
    try {
      await savePreformedPanelsCommand(round.id, panels, {
        rounds,
        adjudicators,
        updateRound,
        recordAuditEvent,
      });
      setDraftByRound((current) => {
        const next = { ...current };
        delete next[round.id];
        return next;
      });
      setMessage({ kind: "success", text: `Saved ${panels.length} panel(s) for ${round.name}.` });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not save the panels." });
    } finally {
      setSaving(false);
    }
  };

  const handleImport = () => {
    const imported = panelsFromPreformedIds(adjudicators);
    if (imported.length === 0) {
      setMessage({ kind: "error", text: "No adjudicator has a preformed_panel_id from the CSV import." });
      return;
    }
    if (panels.length > 0 && !confirm(`Replace the ${panels.length} panel(s) in this draft with ${imported.length} CSV group(s)?`)) {
      return;
    }
    setPanels(imported);
  };

  const label = (adjudicator: Adjudicator) =>
    `${adjudicator.name}${adjudicator.institutionName ? ` (${adjudicator.institutionName})` : ""} · ${adjudicator.baseScore.toFixed(1)}`;

  const memberChip = (panel: PreformedPanel, id: string, role: PanelRole) => {
    const adjudicator = adjudicatorsById.get(id);
    return (
      <span
        key={`${role}-${id}`}
        className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-800"
      >
        {adjudicator?.name ?? "Unknown adjudicator"}
        <button
          type="button"
          onClick={() => setPanels(removeFromPanels(panels, id))}
          className="text-gray-400 hover:text-red-600"
          aria-label={`Remove ${adjudicator?.name ?? "adjudicator"} from this panel`}
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  };

  const addSelect = (panel: PreformedPanel, role: PanelRole) => {
    const options = sortedAdjudicators.filter(
      (item) => (role === "trainee" ? item.trainee : !item.trainee) && !placedIds.has(item.id)
    );
    const roleLabel = role === "chair" ? "chair" : role === "panellist" ? "panellist" : "trainee";
    return (
      <select
        value=""
        onChange={(event) => {
          if (event.target.value) setPanels(assignToPanel(panels, panel.id, event.target.value, role));
        }}
        aria-label={`Add ${roleLabel} to this panel`}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px]"
      >
        <option value="">{role === "chair" ? (panel.chairId ? "Replace chair…" : "Choose chair…") : `Add ${roleLabel}…`}</option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>{label(item)}</option>
        ))}
      </select>
    );
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-[#d0d7de] pb-4 space-y-2">
        <Link
          href={`/${tournament?.slug}/allocation`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Allocation
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-gray-900">
          <Layers className="h-6 w-6 text-indigo-600" /> Preformed Panels
        </h1>
        <p className="text-xs text-gray-500 max-w-3xl">
          Form panels for a round before its draw. Auto-allocation places them as whole units, higher importance
          into higher-priority debates, while avoiding team conflicts; debates without a panel are then filled from
          the remaining adjudicators. You can still edit any room afterwards on the allocation page.
        </p>
      </div>

      {!preferenceOn && (
        <p role="status" className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Auto-allocation ignores these panels until “Allocate preformed panels as a unit” is turned on in{" "}
            <Link href={`/${tournament?.slug}/config`} className="font-semibold underline">Configuration</Link>.
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Round:</span>
        {rounds.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveRound(item)}
            aria-pressed={round?.id === item.id}
            className={`rounded-md border px-3 py-1 text-xs font-semibold ${
              round?.id === item.id ? "border-indigo-700 bg-indigo-600 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {item.name}
            {item.preformedPanels?.length ? ` (${item.preformedPanels.length})` : ""}
          </button>
        ))}
      </div>

      {!round ? (
        <p className="text-xs text-gray-500">Create a round first.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPanels([...panels, emptyPreformedPanel(newPanelId())])}
              className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add panel
            </button>
            <button
              type="button"
              onClick={handleImport}
              className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              <Upload className="h-3.5 w-3.5" /> Create from CSV panel ids
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving || errors.length > 0}
              className="inline-flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save panels"}
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => setDraftByRound((current) => {
                  const next = { ...current };
                  delete next[round.id];
                  return next;
                })}
                className="text-xs font-semibold text-gray-600 underline"
              >
                Discard changes
              </button>
            )}
            <span className="text-xs text-gray-500">
              {placedIds.size} of {adjudicators.length} adjudicators in panels{dirty ? " · unsaved changes" : ""}
            </span>
          </div>

          {message && (
            <p
              role={message.kind === "error" ? "alert" : "status"}
              className={`flex items-center gap-1.5 text-xs ${message.kind === "error" ? "text-red-700" : "text-emerald-700"}`}
            >
              {message.kind === "error" ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {message.text}
            </p>
          )}
          {errors.length > 0 && (
            <ul role="alert" className="list-disc space-y-0.5 rounded border border-red-200 bg-red-50 p-3 pl-6 text-xs text-red-800">
              {errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          )}

          {panels.length === 0 ? (
            <div className="rounded-lg border border-[#d0d7de] bg-white p-10 text-center text-xs text-gray-500">
              No preformed panels for {round.name}.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {panels.map((panel, index) => {
                const voters = [panel.chairId, ...panel.panellistIds]
                  .map((id) => (id ? adjudicatorsById.get(id) : undefined))
                  .filter((item): item is Adjudicator => item !== undefined);
                const average = voters.length
                  ? voters.reduce((sum, item) => sum + item.baseScore, 0) / voters.length
                  : undefined;
                return (
                  <section key={panel.id} className="space-y-2 rounded-lg border border-[#d0d7de] bg-white p-3" aria-label={`Panel ${index + 1}`}>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-xs font-bold text-gray-900">
                        Panel {index + 1}
                        <span className="ml-2 font-normal text-gray-500">
                          {voters.length} voting{average !== undefined ? ` · avg ${average.toFixed(1)}` : ""}
                        </span>
                      </h2>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-[11px] text-gray-600">
                          Importance
                          <input
                            type="number"
                            min={0}
                            max={10}
                            step={0.5}
                            value={panel.importance}
                            onChange={(event) =>
                              setPanels(panels.map((item) =>
                                item.id === panel.id ? { ...item, importance: parseFloat(event.target.value) || 0 } : item
                              ))
                            }
                            className="w-14 rounded border border-gray-300 px-1 py-0.5 text-center font-mono text-[11px]"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setPanels(panels.filter((item) => item.id !== panel.id))}
                          className="rounded p-1 text-gray-400 hover:text-red-600"
                          aria-label={`Delete panel ${index + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="w-16 text-[10px] font-bold uppercase text-blue-900">Chair</span>
                      {panel.chairId && memberChip(panel, panel.chairId, "chair")}
                      {addSelect(panel, "chair")}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="w-16 text-[10px] font-bold uppercase text-gray-600">Panellists</span>
                      {panel.panellistIds.map((id) => memberChip(panel, id, "panellist"))}
                      {addSelect(panel, "panellist")}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="w-16 text-[10px] font-bold uppercase text-amber-800">Trainees</span>
                      {panel.traineeIds.map((id) => memberChip(panel, id, "trainee"))}
                      {addSelect(panel, "trainee")}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
