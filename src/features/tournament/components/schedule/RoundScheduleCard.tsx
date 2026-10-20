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

interface Draft {
  scheduleGroup: string;
  startsAt: string;
}

const MOTION_STATUS_LABEL = {
  not_released: "Motions hidden",
  info_slides_released: "Info slides out",
  motions_released: "Motions out",
} as const;

/**
 * Schedule slots and start times for every round (Tabbycat's schedule_group and starts_at), the
 * parallel-panels grouping of preliminary rounds (prelim_panels) and preparation time.
 */
export function RoundScheduleCard() {
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
      setError(caught instanceof Error ? caught.message : "Could not save the schedule.");
    } finally {
      setBusy(false);
    }
  };

  const grouping = useMemo(() => groupPreliminaryRounds(rounds, Number(panels) || 1), [rounds, panels]);

  return (
    <Card>
      <CardHeader
        icon={<CalendarClock aria-hidden="true" />}
        title="Rounds and start times"
        description="Rounds in the same schedule slot run at the same time (parallel panels): they are current together, and no team, adjudicator or venue may be in two of them."
      />
      <CardBody className="space-y-4">
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        {saved && <Alert tone="success" role="status">{saved}</Alert>}
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>Round</TH>
                <TH>Slot</TH>
                <TH>Starts at</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {live.length === 0 && <TableEmpty colSpan={4}>No rounds yet.</TableEmpty>}
              {live.map((round) => {
                const draft = draftFor(round);
                const update = (patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [round.id]: { ...draft, ...patch } }));
                return (
                  <TR key={round.id}>
                    <TD>
                      <span className="font-medium text-fg">{round.name}</span>
                      <span className="ml-1.5 text-xs text-fg-muted">{round.stage === "elimination" ? "Elimination" : "Preliminary"}</span>
                    </TD>
                    <TD>
                      <Input
                        aria-label={`${round.name} schedule slot`}
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
                        aria-label={`${round.name} start time`}
                        type="datetime-local"
                        value={draft.startsAt}
                        disabled={!isOwnerOrAdmin || busy}
                        onChange={(event) => update({ startsAt: event.target.value })}
                        className="h-8 w-52"
                      />
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {current.has(round.id) && <StatusPill tone="accent">Current</StatusPill>}
                        {round.completed && <StatusPill tone="success">Complete</StatusPill>}
                        <Badge>{MOTION_STATUS_LABEL[motionsStatusOf(round)]}</Badge>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
        {invalid.length > 0 && (
          <Alert tone="warning">Check {invalid.map((round) => round.name).join(", ")}: slots are whole numbers from 1 and times must be complete.</Alert>
        )}
        {problems.length > 0 && <Alert tone="warning" title="These changes need a look">{problems.join(" ")}</Alert>}
        {isOwnerOrAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              loading={busy}
              disabled={changedRounds.length === 0 || invalid.length > 0 || problems.length > 0}
              onClick={() => run(async () => {
                await updateRounds(changedRounds, `Round schedule updated (${changedRounds.map((round) => round.name).join(", ")})`);
                setDrafts({});
              }, "Round schedule saved.")}
            >
              Save round schedule
            </Button>
            <Button variant="ghost" disabled={busy || Object.keys(drafts).length === 0} onClick={() => setDrafts({})}>
              Discard changes
            </Button>
          </div>
        )}

        {isOwnerOrAdmin && tournament && (
          <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
            <div className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                <Layers className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
                Parallel preliminary panels
              </h3>
              <p className="text-xs text-fg-muted">
                Groups the preliminary rounds into slots of this many rounds (e.g. 2 makes &ldquo;Round 1 (A)&rdquo; and &ldquo;Round 1 (B)&rdquo;). Custom round names are kept.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  label="Rounds per slot"
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
                  Group preliminary rounds
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-[13px] font-semibold text-fg">Preparation time</h3>
              <p className="text-xs text-fg-muted">
                Minutes from motion release to the round&apos;s start. Releasing a round&apos;s motions sets its start time. Leave empty to turn this off.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  label="Minutes"
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
                  }), "Preparation time saved.")}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardBody>
      {confirmGrouping && tournament && (
        <ConfirmActionDialog
          title="Group the preliminary rounds?"
          description={grouping.length === 0
            ? `The rounds already form slots of ${Number(panels)}; only the setting is saved.`
            : `${grouping.length} round${grouping.length === 1 ? "" : "s"} change slot or name: ${grouping.map((round) => `${round.name} (slot ${round.scheduleGroup})`).join(", ")}.`}
          confirmLabel="Group rounds"
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
          }, "Preliminary rounds grouped.")}
        />
      )}
    </Card>
  );
}
