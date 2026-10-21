"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import type { ScheduleEvent } from "@/types";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PublicShell } from "@/components/public/PublicShell";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { groupScheduleByDay, nextScheduleEvent } from "@/lib/schedule/events";
import type { MessageKey } from "@/lib/i18n";

const LOAD_ERROR = "__load_error__";

interface PublicScheduleResponse {
  tournamentName: string;
  events: ScheduleEvent[];
}

/** Tabbycat's public schedule: events by day, with an iCalendar feed. Served from the cached projection. */
export default function PublicSchedulePage() {
  const params = useParams<{ tournamentSlug: string }>();
  const slug = params.tournamentSlug;
  const { t, formatDateTime, formatTime } = useI18n();
  const [schedule, setSchedule] = useState<PublicScheduleResponse | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(`/api/public/tournaments/${encodeURIComponent(slug)}/schedule`);
        const result = (await response.json()) as PublicScheduleResponse & { error?: string };
        if (!response.ok) throw new Error(result.error || LOAD_ERROR);
        if (active) {
          setSchedule(result);
          setError("");
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : LOAD_ERROR);
      }
    })();
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [slug]);

  const days = useMemo(() => groupScheduleByDay(schedule?.events || []), [schedule]);
  const highlighted = useMemo(() => nextScheduleEvent(schedule?.events || [], now), [schedule, now]);
  const errorMessage = error === LOAD_ERROR ? t("publicSchedule.loadError") : error;
  const icalUrl = `/api/public/tournaments/${encodeURIComponent(slug)}/schedule/ical`;
  const highlightLabel = (event: ScheduleEvent) => {
    const start = Date.parse(event.startTime);
    return start <= now.getTime() ? t("publicSchedule.now") : t("publicSchedule.next");
  };

  return (
    <PublicShell
      width="narrow"
      title={schedule?.tournamentName || t("publicSchedule.title")}
      backHref={`/${slug}/public`}
      backLabel={t("publicSchedule.back")}
    >
      <PageHeader
        title={schedule ? t("publicSchedule.heading", { tournament: schedule.tournamentName }) : t("publicSchedule.title")}
        description={t("publicSchedule.description")}
        actions={
          schedule && (
            <a href={icalUrl} className={buttonClasses({ variant: "secondary", size: "md" })}>
              <CalendarPlus aria-hidden="true" />
              {t("publicSchedule.subscribe")}
            </a>
          )
        }
      />

      {error && <Alert role="alert" tone="warning">{errorMessage}</Alert>}
      {!schedule && !error && <p role="status" className="text-[13px] text-fg-muted">{t("publicSchedule.loading")}</p>}

      {schedule &&
        (days.length === 0 ? (
          <EmptyState icon={<CalendarPlus />} title={t("publicSchedule.empty")} />
        ) : (
          days.map(({ day, events }) => (
            <section key={day} aria-labelledby={`day-${day}`} className="space-y-2">
              <h2 id={`day-${day}`} className="text-[15px] font-semibold text-fg">
                {formatDateTime(events[0].startTime, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </h2>
              <TableContainer>
                <Table className="text-start">
                  <THead>
                    <TR>
                      <TH className="text-start">{t("publicSchedule.col.time")}</TH>
                      <TH className="text-start">{t("publicSchedule.col.event")}</TH>
                      <TH className="hidden text-start sm:table-cell">{t("publicSchedule.col.type")}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {events.map((event) => {
                      const current = highlighted?.id === event.id;
                      return (
                        <TR key={event.id} className={current ? "[&>*]:bg-accent-subtle" : undefined}>
                          <TD className="whitespace-nowrap font-mono text-xs text-fg">
                            {event.endTime
                              ? t("publicSchedule.range", { start: formatTime(event.startTime), end: formatTime(event.endTime) })
                              : formatTime(event.startTime)}
                          </TD>
                          <TH scope="row" className="whitespace-normal border-b border-border bg-transparent text-start text-[13px] font-medium normal-case tracking-normal text-fg">
                            {event.title}
                            {current && <Badge tone="accent" className="ms-2">{highlightLabel(event)}</Badge>}
                          </TH>
                          <TD className="hidden text-fg-muted sm:table-cell">
                            {t(`publicSchedule.type.${event.type}` as MessageKey)}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableContainer>
            </section>
          ))
        ))}
    </PublicShell>
  );
}
