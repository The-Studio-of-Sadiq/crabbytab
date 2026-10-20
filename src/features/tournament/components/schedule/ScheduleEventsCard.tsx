"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CalendarDays, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import type { ScheduleEvent, ScheduleEventType } from "@/types";
import { useTournament } from "@/contexts/TournamentContext";
import { Button, IconButton, buttonClasses } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { Dialog } from "@/components/ui/Dialog";
import { Table, TableContainer, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/Table";
import { ReleaseActionDialog } from "@/features/tournament/components/ReleaseActionDialog";
import { createEntityId } from "@/features/tournament/application/entities";
import {
  MAX_SCHEDULE_TITLE_LENGTH,
  SCHEDULE_EVENT_TYPES,
  sortScheduleEvents,
  validateScheduleEvents,
} from "@/lib/schedule/events";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";
import { formatScheduleTime, fromDateTimeLocalValue, toDateTimeLocalValue } from "@/lib/schedule/time";

interface EventDraft {
  id: string;
  type: ScheduleEventType;
  title: string;
  roundId: string;
  start: string;
  end: string;
}

function toDraft(event?: ScheduleEvent): EventDraft {
  return {
    id: event?.id ?? createEntityId("event"),
    type: event?.type ?? "debate",
    title: event?.title ?? "",
    roundId: event?.roundId ?? "",
    start: toDateTimeLocalValue(event?.startTime),
    end: toDateTimeLocalValue(event?.endTime),
  };
}

function fromDraft(draft: EventDraft): ScheduleEvent | null {
  const startTime = fromDateTimeLocalValue(draft.start);
  if (!startTime) return null;
  const endTime = draft.end ? fromDateTimeLocalValue(draft.end) : undefined;
  return {
    id: draft.id,
    type: draft.type,
    startTime,
    ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
    ...(endTime ? { endTime } : {}),
    ...(draft.roundId ? { roundId: draft.roundId } : {}),
  };
}

/** Tabbycat's schedule events, shown on the public schedule page and iCalendar feed once released. */
export function ScheduleEventsCard() {
  const { t, locale } = useI18n();
  const { tournament, rounds, isOwnerOrAdmin, saveTournament } = useTournament();
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [draftError, setDraftError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingPublic, setPendingPublic] = useState<boolean | null>(null);
  if (!tournament) return null;
  const events = sortScheduleEvents(tournament.preferences.scheduleEvents || []);
  const isPublic = tournament.preferences.publicSchedule === true;
  const live = rounds.filter((round) => !round.cancelled).sort((left, right) => left.seq - right.seq);
  // The public schedule page's type names; the saved event keeps only its type code.
  const typeLabel = (type: ScheduleEventType) => t(`publicSchedule.type.${type}` as MessageKey);
  // Same rule as scheduleEventTitle (custom title, else "<round> — <type>"), with translated type names.
  const eventTitle = (event: ScheduleEvent) => {
    const custom = event.title?.trim();
    if (custom) return custom;
    const roundName = event.roundId ? rounds.find((item) => item.id === event.roundId)?.name : undefined;
    return roundName ? t("tabroom.schedule.events.eventTitle", { round: roundName, type: typeLabel(event.type) }) : typeLabel(event.type);
  };

  const saveEvents = async (next: ScheduleEvent[]) => {
    const problems = validateScheduleEvents(next, rounds);
    if (problems.length > 0) throw new Error(problems.map((problem) => problem.message).join(" "));
    await saveTournament({ ...tournament, preferences: { ...tournament.preferences, scheduleEvents: sortScheduleEvents(next) } });
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("tabroom.schedule.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const submitDraft = async () => {
    if (!draft) return;
    const event = fromDraft(draft);
    if (!event) {
      setDraftError(t("tabroom.schedule.events.needStart"));
      return;
    }
    const next = events.some((item) => item.id === event.id)
      ? events.map((item) => (item.id === event.id ? event : item))
      : [...events, event];
    const problems = validateScheduleEvents(next, rounds).filter((problem) => problem.eventId === event.id || problem.eventId === "");
    if (problems.length > 0) {
      setDraftError(problems.map((problem) => problem.message).join(" "));
      return;
    }
    setBusy(true);
    setDraftError("");
    try {
      await saveEvents(next);
      setDraft(null);
    } catch (caught) {
      setDraftError(caught instanceof Error ? caught.message : t("tabroom.schedule.events.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<CalendarDays aria-hidden="true" />}
        title={t("tabroom.schedule.events.title")}
        description={isPublic
          ? t("tabroom.schedule.events.publicHelp")
          : t("tabroom.schedule.events.hiddenHelp")}
        actions={
          <>
            <StatusPill tone={isPublic ? "success" : "neutral"}>{isPublic ? t("tabroom.schedule.events.public") : t("tabroom.schedule.events.hidden")}</StatusPill>
            {isOwnerOrAdmin && (
              <Button size="sm" onClick={() => setPendingPublic(!isPublic)}>
                {isPublic ? t("tabroom.schedule.events.hide") : t("tabroom.schedule.events.publish")}
              </Button>
            )}
            {isPublic && (
              <Link href={`/${tournament.slug}/schedule/public`} className={buttonClasses({ variant: "ghost", size: "sm" })}>
                <ExternalLink aria-hidden="true" />
                {t("tabroom.schedule.events.publicPage")}
              </Link>
            )}
          </>
        }
      />
      <CardBody className="space-y-3">
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>{t("tabroom.schedule.events.colStarts")}</TH>
                <TH>{t("tabroom.schedule.events.colEnds")}</TH>
                <TH>{t("tabroom.schedule.events.colEvent")}</TH>
                <TH>{t("tabroom.schedule.events.colType")}</TH>
                {isOwnerOrAdmin && <TH><span className="sr-only">{t("tabroom.schedule.events.colActions")}</span></TH>}
              </TR>
            </THead>
            <TBody>
              {events.length === 0 && <TableEmpty colSpan={isOwnerOrAdmin ? 5 : 4}>{t("tabroom.schedule.events.empty")}</TableEmpty>}
              {events.map((event) => {
                const title = eventTitle(event);
                return (
                  <TR key={event.id}>
                    <TD className="whitespace-nowrap">{formatScheduleTime(event.startTime, undefined, locale)}</TD>
                    <TD className="whitespace-nowrap">{event.endTime ? formatScheduleTime(event.endTime, undefined, locale) : "—"}</TD>
                    <TD className="font-medium text-fg">{title}</TD>
                    <TD>{typeLabel(event.type)}</TD>
                    {isOwnerOrAdmin && (
                      <TD>
                        <div className="flex justify-end">
                          <IconButton size="sm" label={t("tabroom.schedule.events.editLabel", { title })} icon={<Pencil aria-hidden="true" />} disabled={busy} onClick={() => { setDraftError(""); setDraft(toDraft(event)); }} />
                          <IconButton
                            size="sm"
                            label={t("tabroom.schedule.events.deleteLabel", { title })}
                            icon={<Trash2 aria-hidden="true" />}
                            disabled={busy}
                            onClick={() => void run(() => saveEvents(events.filter((item) => item.id !== event.id)))}
                          />
                        </div>
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
        {isOwnerOrAdmin && (
          <Button disabled={busy} onClick={() => { setDraftError(""); setDraft(toDraft()); }}>
            <Plus aria-hidden="true" />
            {t("tabroom.schedule.events.add")}
          </Button>
        )}
      </CardBody>

      {draft && (
        <Dialog
          open
          title={events.some((item) => item.id === draft.id) ? t("tabroom.schedule.events.edit") : t("tabroom.schedule.events.add")}
          onClose={() => setDraft(null)}
          dismissible={!busy}
          footer={
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>{t("tabroom.schedule.events.cancel")}</Button>
              <Button variant="primary" loading={busy} onClick={() => void submitDraft()}>{t("tabroom.schedule.events.save")}</Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {draftError && <Alert tone="danger" role="alert" className="sm:col-span-2">{draftError}</Alert>}
            <Select label={t("tabroom.schedule.events.typeLabel")} value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as ScheduleEventType })}>
              {SCHEDULE_EVENT_TYPES.map((item) => <option key={item.type} value={item.type}>{typeLabel(item.type)}</option>)}
            </Select>
            <Select label={t("tabroom.schedule.events.roundLabel")} value={draft.roundId} onChange={(event) => setDraft({ ...draft, roundId: event.target.value })}>
              <option value="">{t("tabroom.schedule.events.noRound")}</option>
              {live.map((round) => <option key={round.id} value={round.id}>{round.name}</option>)}
            </Select>
            <Input
              label={t("tabroom.schedule.events.titleLabel")}
              help={t("tabroom.schedule.events.titleHelp")}
              wrapperClassName="sm:col-span-2"
              maxLength={MAX_SCHEDULE_TITLE_LENGTH}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
            <Input label={t("tabroom.schedule.events.startsLabel")} type="datetime-local" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
            <Input label={t("tabroom.schedule.events.endsLabel")} type="datetime-local" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
          </div>
        </Dialog>
      )}

      {pendingPublic !== null && (
        <ReleaseActionDialog
          title={pendingPublic ? t("tabroom.schedule.events.publishTitle") : t("tabroom.schedule.events.hideTitle")}
          description={pendingPublic
            ? t("tabroom.schedule.events.publishDescription")
            : t("tabroom.schedule.events.hideDescription")}
          confirmLabel={pendingPublic ? t("tabroom.schedule.events.publish") : t("tabroom.schedule.events.hide")}
          apply={() => saveTournament({ ...tournament, preferences: { ...tournament.preferences, publicSchedule: pendingPublic } })}
          onClose={() => setPendingPublic(null)}
        />
      )}
    </Card>
  );
}
