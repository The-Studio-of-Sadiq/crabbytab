import { NextRequest, NextResponse } from "next/server";
import { getPublicViewReader, publicCacheHeaders, PublicViewError } from "@/lib/publicView/store";
import { publicScheduleFromTournament, publicScheduleICalendar } from "@/lib/schedule/publicSchedule";

export const runtime = "nodejs";

/** The public schedule as an iCalendar feed (Tabbycat's PublicScheduleICalendarView), cached like the JSON. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const reader = await getPublicViewReader(slug);
    const schedule = publicScheduleFromTournament(await reader.readBase("tournament"), slug);
    if (!schedule.enabled) {
      return new NextResponse("This tournament's schedule is not public.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...publicCacheHeaders(60, 120) },
      });
    }
    return new NextResponse(publicScheduleICalendar(schedule, request.nextUrl.origin), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug.replace(/[^A-Za-z0-9_-]/g, "") || "tournament"}-schedule.ics"`,
        ...publicCacheHeaders(300, 900),
      },
    });
  } catch (error) {
    if (error instanceof PublicViewError && error.status < 500) {
      return new NextResponse(error.message, { status: error.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    console.error("Could not build the schedule calendar:", error);
    return new NextResponse("Could not load the schedule. Try again later.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
