"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2, Upload, X, Wand2, ArrowDownWideNarrow, Crown, Layers } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";
import type { Adjudicator, PreformedPanel } from "@/types";
import {
  anticipateRound,
  assignToPanel,
  panelsFromAnticipatedDraw,
  prioritisePanels,
  emptyPreformedPanel,
  panelMemberIds,
  panelsFromPreformedIds,
  removeFromPanels,
  savePreformedPanelsCommand,
  validatePreformedPanels,
  type PanelRole,
} from "@/features/tournament/application/preformedPanels";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Badge } from "@/components/ui/Badge";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { focusRing } from "@/components/ui/focus";
import { cn } from "@/components/ui/cn";

function newPanelId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `panel-${crypto.randomUUID()}`
    : `panel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const ROLE_LABEL_KEYS: Record<PanelRole, MessageKey> = {
  chair: "role.chair",
  panellist: "tabroom.allocation.panellistsLabel",
  trainee: "tabroom.allocation.traineesLabel",
};

const ADD_ARIA_KEYS: Record<PanelRole, MessageKey> = {
  chair: "tabroom.allocation.panelsAddChairAria",
  panellist: "tabroom.allocation.panelsAddPanellistAria",
  trainee: "tabroom.allocation.panelsAddTraineeAria",
};

export default function PreformedPanelsPage() {
  const {
    tournament,
    rounds,
    activeRound,
    setActiveRound,
    adjudicators,
    teams,
    debates,
    ballots,
    breakCategories,
    updateRound,
    recordAuditEvent,
  } = useTournament();
  const { t, plural, formatDecimal, formatNumber } = useI18n();
  const [draftByRound, setDraftByRound] = useState<Record<string, PreformedPanel[]>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pendingImport, setPendingImport] = useState<PreformedPanel[] | null>(null);

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
      setMessage({ kind: "success", text: plural("tabroom.allocation.panelsSaved", panels.length, { round: round.name }) });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t("tabroom.allocation.panelsSaveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const handleImport = () => {
    const imported = panelsFromPreformedIds(adjudicators);
    if (imported.length === 0) {
      setMessage({ kind: "error", text: t("tabroom.allocation.panelsNoCsvIds") });
      return;
    }
    if (panels.length > 0) {
      setPendingImport(imported);
      return;
    }
    setPanels(imported);
  };

  const anticipate = () => (round && tournament
    ? anticipateRound(round, { tournament, rounds, teams, debates, ballots, breakCategories })
    : undefined);

  const handleAnticipate = () => {
    const anticipation = anticipate();
    if (!anticipation) return;
    if (anticipation.rooms.length === 0) {
      setMessage({ kind: "error", text: t("tabroom.allocation.panelsNotEnoughTeams") });
      return;
    }
    setPanels(panelsFromAnticipatedDraw(panels, anticipation.rooms, newPanelId));
    setMessage({
      kind: anticipation.notice ? "error" : "success",
      text: anticipation.notice ?? plural("tabroom.allocation.panelsAnticipated", anticipation.rooms.length),
    });
  };

  const handlePrioritise = (method: "bracket" | "liveness") => {
    try {
      setPanels(prioritisePanels(panels, method, method === "liveness" ? anticipate()?.thresholds : undefined));
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t("tabroom.allocation.panelsPrioritiseFailed") });
    }
  };

  const label = (adjudicator: Adjudicator) =>
    adjudicator.institutionName
      ? t("tabroom.allocation.panelsOption", {
          name: adjudicator.name,
          institution: adjudicator.institutionName,
          score: formatDecimal(adjudicator.baseScore, 1),
        })
      : t("tabroom.allocation.panelsOptionNoInstitution", {
          name: adjudicator.name,
          score: formatDecimal(adjudicator.baseScore, 1),
        });

  const memberChip = (id: string, role: PanelRole) => {
    const adjudicator = adjudicatorsById.get(id);
    const name = adjudicator?.name ?? t("tabroom.allocation.panelsUnknownAdjudicator");
    return (
      <span
        key={`${role}-${id}`}
        className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-background pl-2 pr-0.5 text-[11px] text-fg"
      >
        {name}
        <IconButton
          size="sm"
          className="h-5 w-5 hover:text-danger"
          onClick={() => setPanels(removeFromPanels(panels, id))}
          label={t("tabroom.allocation.panelsRemoveMember", { name })}
          icon={<X aria-hidden="true" />}
        />
      </span>
    );
  };

  const addSelect = (panel: PreformedPanel, role: PanelRole, panelNumber: number) => {
    const options = sortedAdjudicators.filter(
      (item) => (role === "trainee" ? item.trainee : !item.trainee) && !placedIds.has(item.id)
    );
    const placeholder =
      role === "chair"
        ? panel.chairId
          ? t("tabroom.allocation.panelsReplaceChair")
          : t("tabroom.allocation.panelsChooseChair")
        : role === "panellist"
          ? t("tabroom.allocation.panelsAddPanellist")
          : t("tabroom.allocation.panelsAddTrainee");
    return (
      <Select
        value=""
        onChange={(event) => {
          if (event.target.value) setPanels(assignToPanel(panels, panel.id, event.target.value, role));
        }}
        aria-label={t(ADD_ARIA_KEYS[role], { number: panelNumber })}
        className="h-6 w-auto max-w-full py-0 text-[11px]"
      >
        <option value="">{placeholder}</option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>{label(item)}</option>
        ))}
      </Select>
    );
  };

  const discardDraft = () => {
    if (!round) return;
    setDraftByRound((current) => {
      const next = { ...current };
      delete next[round.id];
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <Link
        href={`/${tournament?.slug}/allocation`}
        className={cn("inline-flex items-center gap-1 rounded-sm text-xs font-medium text-accent-text hover:underline", focusRing)}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {t("tabroom.allocation.panelsBack")}
      </Link>
      <PageHeader title={t("tabroom.allocation.panelsTitle")} description={t("tabroom.allocation.panelsDescription")} />

      {!preferenceOn && (
        <Alert tone="warning" role="status">
          {t("tabroom.allocation.panelsPreferenceOff")}{" "}
          <Link
            href={`/${tournament?.slug}/config`}
            className={cn("rounded-sm font-medium text-accent-text underline", focusRing)}
          >
            {t("tabroom.allocation.panelsConfigLink")}
          </Link>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="panels-round-label">
        <span id="panels-round-label" className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          {t("tabroom.allocation.panelsRound")}
        </span>
        {rounds.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={round?.id === item.id ? "primary" : "secondary"}
            onClick={() => setActiveRound(item)}
            aria-pressed={round?.id === item.id}
          >
            {item.name}
            {item.preformedPanels?.length ? ` (${formatNumber(item.preformedPanels.length)})` : ""}
          </Button>
        ))}
      </div>

      {!round ? (
        <EmptyState icon={<Layers />} title={t("tabroom.allocation.panelsNoRound")} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setPanels([...panels, emptyPreformedPanel(newPanelId())])}>
              <Plus aria-hidden="true" /> {t("tabroom.allocation.panelsAdd")}
            </Button>
            <Button size="sm" onClick={handleImport}>
              <Upload aria-hidden="true" /> {t("tabroom.allocation.panelsFromCsv")}
            </Button>
            <Button size="sm" onClick={handleAnticipate} title={t("tabroom.allocation.panelsFromAnticipatedTitle")}>
              <Wand2 aria-hidden="true" /> {t("tabroom.allocation.panelsFromAnticipated")}
            </Button>
            <Button size="sm" onClick={() => handlePrioritise("bracket")} disabled={panels.length === 0}>
              <ArrowDownWideNarrow aria-hidden="true" /> {t("tabroom.allocation.panelsPrioritiseBracket")}
            </Button>
            <Button size="sm" onClick={() => handlePrioritise("liveness")} disabled={panels.length === 0}>
              <ArrowDownWideNarrow aria-hidden="true" /> {t("tabroom.allocation.panelsPrioritiseLiveness")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={handleSave}
              disabled={!dirty || errors.length > 0}
              loading={saving}
              loadingText={t("tabroom.common.saving")}
            >
              <Save aria-hidden="true" /> {t("tabroom.allocation.panelsSave")}
            </Button>
            {dirty && (
              <Button size="sm" variant="ghost" onClick={discardDraft}>
                {t("tabroom.allocation.panelsDiscard")}
              </Button>
            )}
            <span className="text-xs text-fg-muted">
              {plural("tabroom.allocation.panelsPlacedCount", adjudicators.length, { placed: placedIds.size })}
              {dirty && (
                <>
                  {" · "}
                  <Badge tone="warning">{t("tabroom.allocation.panelsUnsaved")}</Badge>
                </>
              )}
            </span>
          </div>

          {message && (
            <Alert tone={message.kind === "error" ? "danger" : "success"} role={message.kind === "error" ? "alert" : "status"}>
              {message.text}
            </Alert>
          )}
          {errors.length > 0 && (
            <Alert tone="danger" role="alert">
              <ul className="list-disc space-y-0.5 pl-4">
                {errors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            </Alert>
          )}

          {panels.length === 0 ? (
            <EmptyState icon={<Layers />} title={t("tabroom.allocation.panelsEmpty", { round: round.name })} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {panels.map((panel, index) => {
                const panelNumber = index + 1;
                const voters = [panel.chairId, ...panel.panellistIds]
                  .map((id) => (id ? adjudicatorsById.get(id) : undefined))
                  .filter((item): item is Adjudicator => item !== undefined);
                const average = voters.length
                  ? voters.reduce((sum, item) => sum + item.baseScore, 0) / voters.length
                  : undefined;
                const meta = [
                  plural("tabroom.allocation.panelsVoting", voters.length),
                  average !== undefined ? t("tabroom.allocation.panelsAverage", { score: formatDecimal(average, 1) }) : null,
                  panel.roomRank !== undefined ? t("tabroom.allocation.panelsRoom", { rank: panel.roomRank }) : null,
                  panel.bracketMin !== undefined && panel.bracketMax !== undefined
                    ? t("tabroom.allocation.panelsBracket", {
                        range: panel.bracketMin === panel.bracketMax ? panel.bracketMin : `${panel.bracketMin}–${panel.bracketMax}`,
                      })
                    : null,
                  panel.liveness !== undefined ? t("tabroom.allocation.panelsLive", { count: panel.liveness }) : null,
                ].filter((part): part is string => part !== null);
                return (
                  <Card key={panel.id} className="space-y-2 p-3">
                    <section aria-labelledby={`panel-heading-${panel.id}`} className="space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h2 id={`panel-heading-${panel.id}`} className="text-[13px] font-semibold text-fg">
                            {t("tabroom.allocation.panelsPanelNumber", { number: panelNumber })}
                          </h2>
                          <p className="text-[11px] text-fg-muted">{meta.join(" · ")}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Input
                            label={t("tabroom.allocation.panelsImportance")}
                            wrapperClassName="flex items-center gap-1.5 space-y-0"
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
                            className="h-6 w-14 px-1 text-center font-mono text-[11px]"
                          />
                          <IconButton
                            size="sm"
                            className="hover:text-danger"
                            onClick={() => setPanels(panels.filter((item) => item.id !== panel.id))}
                            label={t("tabroom.allocation.panelsDelete", { number: panelNumber })}
                            icon={<Trash2 aria-hidden="true" />}
                          />
                        </div>
                      </div>
                      {(["chair", "panellist", "trainee"] as const).map((role) => (
                        <div key={role} className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex w-20 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                            {role === "chair" && <Crown className="h-3 w-3" aria-hidden="true" />}
                            {t(ROLE_LABEL_KEYS[role])}
                          </span>
                          {role === "chair"
                            ? panel.chairId && memberChip(panel.chairId, "chair")
                            : (role === "panellist" ? panel.panellistIds : panel.traineeIds).map((id) => memberChip(id, role))}
                          {addSelect(panel, role, panelNumber)}
                        </div>
                      ))}
                    </section>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {pendingImport && (
        <ConfirmActionDialog
          title={t("tabroom.allocation.panelsReplaceTitle")}
          description={plural("tabroom.allocation.panelsReplaceDescription", panels.length, {
            groups: plural("tabroom.allocation.panelsCsvGroups", pendingImport.length),
          })}
          confirmLabel={t("tabroom.allocation.panelsReplaceConfirm")}
          onConfirm={() => {
            setPanels(pendingImport);
            setPendingImport(null);
          }}
          onCancel={() => setPendingImport(null)}
          cancelLabel={t("tabroom.common.noCancel")}
          busyLabel={t("tabroom.common.saving")}
          closeLabel={t("tabroom.common.closeDialog")}
        />
      )}
    </div>
  );
}
