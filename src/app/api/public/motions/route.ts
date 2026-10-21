import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { poolMotionSummaries } from "@/lib/motions/crossTournament";
import { readPublicMotionSummary, type PublicMotionSummary } from "@/lib/motions/publicSummary";
import { PUBLIC_VIEWS_COLLECTION, publicCacheHeaders } from "@/lib/publicView/store";

export const runtime = "nodejs";

/** Pooled statistics change slowly; an hour keeps this page to about one read per tournament per hour. */
const REVALIDATE_SECONDS = 3600;

/**
 * Motion summaries of every published tournament that released its motion statistics. Each is
 * stored on the tournament's public view root at publish time, so this is one read per such
 * tournament (only the summary field is fetched), cached for an hour.
 */
const readSummariesCached = unstable_cache(
  async (): Promise<PublicMotionSummary[]> => {
    const snapshot = await getAdminFirestore()
      .collection(PUBLIC_VIEWS_COLLECTION)
      .where("motionSummary.isBP", "in", [true, false])
      .select("motionSummary")
      .get();
    return snapshot.docs.flatMap((document) => {
      const summary = readPublicMotionSummary(document.get("motionSummary"));
      return summary ? [summary] : [];
    });
  },
  ["public-motion-summaries"],
  { revalidate: REVALIDATE_SECONDS }
);

export async function GET() {
  try {
    const summaries = await readSummariesCached();
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
