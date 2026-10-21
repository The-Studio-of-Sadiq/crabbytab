"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, Layers } from "lucide-react";
import type { Round } from "@/types";
import { useTournament } from "@/contexts/TournamentContext";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { Table, TableContainer, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/Table";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import {
  checkScheduleGroupChange,
  currentRounds,
  groupPreliminaryRounds,
  preliminaryPanelsOf,
  scheduleGroupOf,
} from "@/features/tournament/application/schedule";
import { motionsStatusOf, preparationMinutes } from "@/features/tournament/application/motionRelease";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@/lib/schedule/time";
import { useI18n } from "@/components/i18n/I18nProvider";

interface Draft {
  scheduleGroup: string;
  startsAt: string;
}

const MOTION_STATUS_LABEL = {
  not_released: "tabroom.schedule.rounds.motionsHidden",
  info_slides_released: "tabroom.schedule.rounds.infoSlidesOut",
  motions_released: "tabroom.schedule.rounds.motionsOut",
} as const;

/**
 * Schedule slots and start times for every round (Tabbycat's schedule_group and starts_at), the
 * parallel-panels grouping of preliminary rounds (prelim_panels) and preparation time.
 */
export function RoundScheduleCard() {
  const { t, plural, formatList } = useI18n();
  const { tournament, rounds, debates, breakCategories, isOwnerOrAdmin, updateRounds, saveTournament } = useTournament();
  const live = useMemo(() => [...rounds].filter((round) => !round.cancelled).sort((left, right) => left.seq - right.seq), [rounds]);
  const current = useMemo(() => new Set(currentRounds(rounds, debates, breakCategories).map((round) => round.id)), [rounds, debates, breakCategories]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const panelsSetting = preliminaryPanelsOf(tournament?.preferences);
  const [panels, setPanels] = useState(String(panelsSetting));
  const [confirmGrouping, setConfirmGrouping] = useState(false);
  const preparation = preparationMinutes(tournament?.preferences);
  const [preparationDraft, setPreparationDraft] = useState(preparation === undefined ? "" : String(preparation));

  useEffect(() => setPanels(String(panelsSetting)), [panelsSetting]);
  useEffect(() => setPreparationDraft(preparation === undefined ? "" : String(preparation)), [preparation]);

  const draftFor = (round: Round): Draft => drafts[round.id] ?? {
    scheduleGroup: String(scheduleGroupOf(round)),
    startsAt: toDateTimeLocalValue(round.startsAt),
  };

  const changedRounds = live.flatMap((round) => {
    const draft = drafts[round.id];
    if (!draft) return [];
    const group = Number(draft.scheduleGroup);
    const startsAt = fromDateTimeLocalValue(draft.startsAt);
    const next: Round = { ...round };
    if (Number.isInteger(group) && group >= 1 && group !== scheduleGroupOf(round)) next.scheduleGroup = group;
    if (draft.startsAt === "") delete next.startsAt;
    else if (startsAt && startsAt !== round.startsAt) next.startsAt = startsAt;
    return JSON.stringify(next) === JSON.stringify(round) ? [] : [next];
  });
  const invalid = live.filter((round) => {
    const draft = drafts[round.id];
    if (!draft) return false;
    const group = Number(draft.scheduleGroup);
    return !Number.isInteger(group) || group < 1 || (draft.startsAt !== "" && !fromDateTimeLocalValue(draft.startsAt));
  });
  const problems = changedRounds.flatMap((round) =>
    round.scheduleGroup !== undefined && round.scheduleGroup !== scheduleGroupOf(rounds.find((item) => item.id === round.id)!)
      ? checkScheduleGroupChange(round, round.scheduleGroup, rounds.map((item) => changedRounds.find((changed) => changed.id === item.id) ?? item), debates)
      : []
  );

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await action();
      setSaved(done);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("tabroom.schedule.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const grouping = useMemo(() => groupPreliminaryRounds(rounds, Number(panels) || 1), [rounds, panels]);

  return (
    <Card>
      <CardHeader
        icon={<CalendarClock aria-hidden="true" />}
        title={t("tabroom.schedule.rounds.title")}
        description={t("tabroom.schedule.rounds.description")}
      />
      <CardBody className="space-y-4">
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        {saved && <Alert tone="success" role="status">{saved}</Alert>}
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>{t("tabroom.schedule.rounds.colRound")}</TH>
                <TH>{t("tabroom.schedule.rounds.colSlot")}</TH>
                <TH>{t("tabroom.schedule.rounds.colStartsAt")}</TH>
                <TH>{t("tabroom.schedule.rounds.colStatus")}</TH>
              </TR>
            </THead>
            <TBody>
              {live.length === 0 && <TableEmpty colSpan={4}>{t("tabroom.schedule.rounds.empty")}</TableEmpty>}
              {live.map((round) => {
                const draft = draftFor(round);
                const update = (patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [round.id]: { ...draft, ...patch } }));
                return (
                  <TR key={round.id}>
                    <TD>
                      <span className="font-medium text-fg">{round.name}</span>
                      <span className="ml-1.5 text-xs text-fg-muted">{round.stage === "elimination" ? t("tabroom.schedule.rounds.elimination") : t("tabroom.schedule.rounds.preliminary")}</span>
                    </TD>
                    <TD>
                      <Input
                        aria-label={t("tabroom.schedule.rounds.slotLabel", { round: round.name })}
                        type="number"
                        min={1}
                        step={1}
                        value={draft.scheduleGroup}
                        disabled={!isOwnerOrAdmin || busy}
                        onChange={(event) => update({ scheduleGroup: event.target.value })}
                        className="h-8 w-20"
                      />
                    </TD>
                    <TD>
                      <Input
                        aria-label={t("tabroom.schedule.rounds.startLabel", { round: round.name })}
                        type="datetime-local"
                        value={draft.startsAt}
                        disabled={!isOwnerOrAdmin || busy}
                        onChange={(event) => update({ startsAt: event.target.value })}
                        className="h-8 w-52"
                      />
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {current.has(round.id) && <StatusPill tone="accent">{t("tabroom.schedule.rounds.current")}</StatusPill>}
                        {round.completed && <StatusPill tone="success">{t("tabroom.schedule.rounds.complete")}</StatusPill>}
                        <Badge>{t(MOTION_STATUS_LABEL[motionsStatusOf(round)])}</Badge>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
        {invalid.length > 0 && (
          <Alert tone="warning">{t("tabroom.schedule.rounds.invalid", { rounds: formatList(invalid.map((round) => round.name)) })}</Alert>
        )}
        {problems.length > 0 && <Alert tone="warning" title={t("tabroom.schedule.rounds.problemsTitle")}>{problems.join(" ")}</Alert>}
        {isOwnerOrAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              loading={busy}
              disabled={changedRounds.length === 0 || invalid.length > 0 || problems.length > 0}
              onClick={() => run(async () => {
                await updateRounds(changedRounds, `Round schedule updated (${changedRounds.map((round) => round.name).join(", ")})`);
                setDrafts({});
              }, t("tabroom.schedule.rounds.saved"))}
            >
              {t("tabroom.schedule.rounds.save")}
            </Button>
            <Button variant="ghost" disabled={busy || Object.keys(drafts).length === 0} onClick={() => setDrafts({})}>
              {t("tabroom.schedule.rounds.discard")}
            </Button>
          </div>
        )}

        {isOwnerOrAdmin && tournament && (
          <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
            <div className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                <Layers className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
                {t("tabroom.schedule.rounds.panelsTitle")}
              </h3>
              <p className="text-xs text-fg-muted">
                {t("tabroom.schedule.rounds.panelsHelp")}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  label={t("tabroom.schedule.rounds.panelsLabel")}
                  type="number"
                  min={1}
                  max={26}
                  value={panels}
                  onChange={(event) => setPanels(event.target.value)}
                  className="h-8 w-24"
                />
                <Button
                  disabled={busy || !(Number(panels) >= 1) || (grouping.length === 0 && Number(panels) === panelsSetting)}
                  onClick={() => setConfirmGrouping(true)}
                >
                  {t("tabroom.schedule.rounds.groupButton")}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-[13px] font-semibold text-fg">{t("tabroom.schedule.rounds.preparationTitle")}</h3>
              <p className="text-xs text-fg-muted">
                {t("tabroom.schedule.rounds.preparationHelp")}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  label={t("tabroom.schedule.rounds.minutes")}
                  type="number"
                  min={0}
                  max={600}
                  value={preparationDraft}
                  onChange={(event) => setPreparationDraft(event.target.value)}
                  className="h-8 w-24"
                />
                <Button
                  disabled={busy || (preparationDraft !== "" && !(Number(preparationDraft) >= 0)) || preparationDraft === (preparation === undefined ? "" : String(preparation))}
                  onClick={() => run(() => saveTournament({
                    ...tournament,
                    preferences: { ...tournament.preferences, preparationTime: preparationDraft === "" ? -1 : Math.floor(Number(preparationDraft)) },
                  }), t("tabroom.schedule.rounds.preparationSaved"))}
                >
                  {t("tabroom.schedule.rounds.savePreparation")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardBody>
      {confirmGrouping && tournament && (
        <ConfirmActionDialog
          title={t("tabroom.schedule.rounds.groupConfirmTitle")}
          description={grouping.length === 0
            ? t("tabroom.schedule.rounds.groupUnchanged", { size: Number(panels) })
            : plural("tabroom.schedule.rounds.groupChanges", grouping.length, {
              changes: formatList(grouping.map((round) => t("tabroom.schedule.rounds.groupChangeItem", { round: round.name, slot: round.scheduleGroup ?? "" }))),
            })}
          confirmLabel={t("tabroom.schedule.rounds.groupConfirm")}
          isBusy={busy}
          error={error}
          onCancel={() => setConfirmGrouping(false)}
          onConfirm={() => void run(async () => {
            const groupProblems = grouping.flatMap((round) =>
              checkScheduleGroupChange(round, round.scheduleGroup ?? round.seq, rounds.map((item) => grouping.find((changed) => changed.id === item.id) ?? item), debates)
            );
            if (groupProblems.length > 0) throw new Error(groupProblems.join(" "));
            await updateRounds(grouping, `Preliminary rounds grouped into slots of ${Number(panels)}`);
            await saveTournament({ ...tournament, preferences: { ...tournament.preferences, preliminaryPanels: Math.floor(Number(panels)) } });
            setConfirmGrouping(false);
          }, t("tabroom.schedule.rounds.grouped"))}
        />
      )}
    </Card>
  );
}
