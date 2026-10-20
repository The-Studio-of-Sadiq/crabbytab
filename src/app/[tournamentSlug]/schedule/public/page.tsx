"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import type { ScheduleEvent } from "@/types";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
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
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">
            {schedule
              ? t("publicSchedule.heading", { tournament: schedule.tournamentName })
              : t("publicSchedule.title")}
          </h1>
          <p className="mt-1 text-sm text-gray-600">{t("publicSchedule.description")}</p>
        </div>
        <LanguageSwitcher />
      </header>

      {error && <p role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{errorMessage}</p>}
      {!schedule && !error && <p role="status" className="text-sm text-gray-600">{t("publicSchedule.loading")}</p>}

      {schedule && (
        <>
          <a
            href={icalUrl}
            className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            {t("publicSchedule.subscribe")}
          </a>
          {days.length === 0 ? (
            <p className="rounded border border-dashed border-gray-300 p-6 text-center text-sm text-gray-600">{t("publicSchedule.empty")}</p>
          ) : (
            days.map(({ day, events }) => (
              <section key={day} aria-labelledby={`day-${day}`} className="space-y-2">
                <h2 id={`day-${day}`} className="text-base font-bold text-gray-900">
                  {formatDateTime(events[0].startTime, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </h2>
                <div className="overflow-x-auto rounded border border-gray-200 bg-white">
                  <table className="w-full text-start text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                      <tr>
                        <th scope="col" className="px-4 py-2 text-start">{t("publicSchedule.col.time")}</th>
                        <th scope="col" className="px-4 py-2 text-start">{t("publicSchedule.col.event")}</th>
                        <th scope="col" className="hidden px-4 py-2 text-start sm:table-cell">{t("publicSchedule.col.type")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {events.map((event) => {
                        const current = highlighted?.id === event.id;
                        return (
                          <tr key={event.id} className={current ? "bg-blue-50" : undefined}>
                            <td className="whitespace-nowrap px-4 py-2 font-mono text-gray-800">
                              {event.endTime
                                ? t("publicSchedule.range", { start: formatTime(event.startTime), end: formatTime(event.endTime) })
                                : formatTime(event.startTime)}
                            </td>
                            <th scope="row" className="px-4 py-2 text-start font-semibold text-gray-900">
                              {event.title}
                              {current && (
                                <span className="ms-2 rounded border border-blue-300 bg-white px-1.5 py-0.5 text-[11px] font-bold uppercase text-blue-800">
                                  {highlightLabel(event)}
                                </span>
                              )}
                            </th>
                            <td className="hidden px-4 py-2 text-gray-600 sm:table-cell">
                              {t(`publicSchedule.type.${event.type}` as MessageKey)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}
        </>
      )}

      <Link href={`/${slug}/public`} className="inline-block text-sm font-semibold text-blue-700 hover:underline">
        {t("publicSchedule.back")}
      </Link>
    </main>
  );
}
