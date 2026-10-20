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
  scheduleEventTitle,
  scheduleEventTypeLabel,
  sortScheduleEvents,
  validateScheduleEvents,
} from "@/lib/schedule/events";
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
      setError(caught instanceof Error ? caught.message : "Could not save the schedule.");
    } finally {
      setBusy(false);
    }
  };

  const submitDraft = async () => {
    if (!draft) return;
    const event = fromDraft(draft);
    if (!event) {
      setDraftError("Give the event a complete start time.");
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
      setDraftError(caught instanceof Error ? caught.message : "Could not save the event.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<CalendarDays aria-hidden="true" />}
        title="Tournament schedule"
        description={isPublic
          ? "Public: changes appear on the public schedule and calendar feed after the next upload."
          : "Hidden: only the tab room sees the schedule until you publish it."}
        actions={
          <>
            <StatusPill tone={isPublic ? "success" : "neutral"}>{isPublic ? "Public" : "Hidden"}</StatusPill>
            {isOwnerOrAdmin && (
              <Button size="sm" onClick={() => setPendingPublic(!isPublic)}>
                {isPublic ? "Hide schedule" : "Publish schedule"}
              </Button>
            )}
            {isPublic && (
              <Link href={`/${tournament.slug}/schedule/public`} className={buttonClasses({ variant: "ghost", size: "sm" })}>
                <ExternalLink aria-hidden="true" />
                Public page
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
                <TH>Starts</TH>
                <TH>Ends</TH>
                <TH>Event</TH>
                <TH>Type</TH>
                {isOwnerOrAdmin && <TH><span className="sr-only">Actions</span></TH>}
              </TR>
            </THead>
            <TBody>
              {events.length === 0 && <TableEmpty colSpan={isOwnerOrAdmin ? 5 : 4}>No events yet.</TableEmpty>}
              {events.map((event) => {
                const title = scheduleEventTitle(event, rounds);
                return (
                  <TR key={event.id}>
                    <TD className="whitespace-nowrap">{formatScheduleTime(event.startTime)}</TD>
                    <TD className="whitespace-nowrap">{event.endTime ? formatScheduleTime(event.endTime) : "—"}</TD>
                    <TD className="font-medium text-fg">{title}</TD>
                    <TD>{scheduleEventTypeLabel(event.type)}</TD>
                    {isOwnerOrAdmin && (
                      <TD>
                        <div className="flex justify-end">
                          <IconButton size="sm" label={`Edit ${title}`} icon={<Pencil aria-hidden="true" />} disabled={busy} onClick={() => { setDraftError(""); setDraft(toDraft(event)); }} />
                          <IconButton
                            size="sm"
                            label={`Delete ${title}`}
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
            Add event
          </Button>
        )}
      </CardBody>

      {draft && (
        <Dialog
          open
          title={events.some((item) => item.id === draft.id) ? "Edit event" : "Add event"}
          onClose={() => setDraft(null)}
          dismissible={!busy}
          footer={
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={() => void submitDraft()}>Save event</Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {draftError && <Alert tone="danger" role="alert" className="sm:col-span-2">{draftError}</Alert>}
            <Select label="Type" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as ScheduleEventType })}>
              {SCHEDULE_EVENT_TYPES.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
            </Select>
            <Select label="Round (optional)" value={draft.roundId} onChange={(event) => setDraft({ ...draft, roundId: event.target.value })}>
              <option value="">No round</option>
              {live.map((round) => <option key={round.id} value={round.id}>{round.name}</option>)}
            </Select>
            <Input
              label="Title (optional)"
              help="Leave empty to use the round and event type."
              wrapperClassName="sm:col-span-2"
              maxLength={MAX_SCHEDULE_TITLE_LENGTH}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
            <Input label="Starts" type="datetime-local" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
            <Input label="Ends (optional)" type="datetime-local" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
          </div>
        </Dialog>
      )}

      {pendingPublic !== null && (
        <ReleaseActionDialog
          title={pendingPublic ? "Publish the schedule?" : "Hide the schedule?"}
          description={pendingPublic
            ? "The schedule appears on the public schedule page and as an iCalendar feed participants can subscribe to."
            : "The public schedule page and calendar feed stop showing events. Subscribed calendars keep events they already downloaded."}
          confirmLabel={pendingPublic ? "Publish schedule" : "Hide schedule"}
          apply={() => saveTournament({ ...tournament, preferences: { ...tournament.preferences, publicSchedule: pendingPublic } })}
          onClose={() => setPendingPublic(null)}
        />
      )}
    </Card>
  );
}
