import { unstable_cache } from "next/cache";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { readPublicMotionSummary, type PublicMotionSummary } from "@/lib/motions/publicSummary";

export { pooledMotionsIndexable } from "@/lib/motions/publicSummary";
import { PUBLIC_VIEWS_COLLECTION } from "@/lib/publicView/store";

/** Pooled statistics change slowly; an hour keeps this to about one read per tournament per hour. */
const REVALIDATE_SECONDS = 3600;

/**
 * Motion summaries of every published tournament that released its motion statistics. Each is
 * stored on the tournament's public view root at publish time, so this is one read per such
 * tournament (only the summary field is fetched), cached for an hour. Shared by the API route and
 * the page's robots metadata, so both use one cached read.
 */
export const readPublicMotionSummaries = unstable_cache(
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
