import { NextRequest, NextResponse } from "next/server";
import { getPublicViewReader, publicCacheHeaders, PublicViewError } from "@/lib/publicView/store";
import { publicScheduleFromTournament } from "@/lib/schedule/publicSchedule";

export const runtime = "nodejs";

/**
 * The public schedule, read from the published tournament section (one cached read, no Firestore
 * scan). Schedules change rarely, so the CDN may keep it for a few minutes.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const reader = await getPublicViewReader(slug);
    const schedule = publicScheduleFromTournament(await reader.readBase("tournament"), slug);
    if (!schedule.enabled) {
      return NextResponse.json({ error: "This tournament's schedule is not public." }, { status: 404, headers: publicCacheHeaders(60, 120) });
    }
    return NextResponse.json({ version: reader.version, ...schedule }, { headers: publicCacheHeaders(120, 600) });
  } catch (error) {
    if (error instanceof PublicViewError && error.status < 500) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Could not load public schedule:", error);
    return NextResponse.json({ error: "Could not load the schedule. Try again later." }, { status: 503 });
  }
}
