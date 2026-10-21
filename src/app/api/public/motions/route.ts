import { NextResponse } from "next/server";
import { poolMotionSummaries } from "@/lib/motions/crossTournament";
import { readPublicMotionSummaries } from "@/lib/motions/publicSummaryStore";
import { publicCacheHeaders } from "@/lib/publicView/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const summaries = await readPublicMotionSummaries();
    return NextResponse.json(
      {
        tournaments: summaries
          .map((summary) => ({ ...summary.tournament, isBP: summary.isBP, motions: summary.motions.length }))
          .sort((left, right) => left.name.localeCompare(right.name)),
        statistics: poolMotionSummaries(summaries),
      },
      { headers: publicCacheHeaders(600, 3600) }
    );
  } catch (error) {
    console.error("Could not load public motion statistics:", error);
    return NextResponse.json({ error: "Could not load motion statistics." }, { status: 503 });
  }
}
