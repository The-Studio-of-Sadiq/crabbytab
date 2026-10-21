import { NextRequest, NextResponse } from "next/server";
import {
  assembleProjection,
  latestPublicRoundId,
  PUBLIC_PROJECTION_BASE_SECTIONS,
  roundSectionName,
  type PublicViewSections,
} from "@/lib/publicView/snapshot";
import {
  getPublicViewReader,
  publicCacheHeaders,
  PublicViewError,
} from "@/lib/publicView/store";

export const runtime = "nodejs";

/** Round ids are opaque keys here; imported tournaments may use any characters but "/". */
const ROUND_ID_PATTERN = /^[^/]{1,256}$/;

/**
 * The public projection, paged by round so no response or cache entry grows with the number of
 * rounds:
 * - without `round`: the base projection (tournament, rounds, teams, adjudicators, motions, ...)
 *   with the latest round's debates and ballots, plus `roundSections` (round id -> content hash)
 *   so clients can load other rounds;
 * - `?round={id}&h={hash}`: that round's debates and ballots. The hash makes the URL a content
 *   address, so the CDN may keep it for a day; without a matching hash it is cached briefly.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const reader = await getPublicViewReader(slug);
    const roundId = request.nextUrl.searchParams.get("round");
    if (roundId !== null) {
      const content = ROUND_ID_PATTERN.test(roundId) ? await reader.readRound(roundId) : undefined;
      if (!content) return NextResponse.json({ error: "This round is not public." }, { status: 404 });
      const hash = reader.roundHashes[roundId];
      const immutable = request.nextUrl.searchParams.get("h") === hash;
      return NextResponse.json(
        { version: reader.version, roundId, hash, ...content },
        { headers: immutable ? publicCacheHeaders(86_400, 3_600) : publicCacheHeaders(15, 30) }
      );
    }

    const values = await Promise.all(PUBLIC_PROJECTION_BASE_SECTIONS.map((section) => reader.readBase(section)));
    const sections = Object.fromEntries(
      PUBLIC_PROJECTION_BASE_SECTIONS.map((section, index) => [section, values[index]])
    ) as Partial<PublicViewSections>;
    const latest = latestPublicRoundId((sections.rounds as Array<Record<string, unknown>> | undefined) || []);
    const latestContent = latest ? await reader.readRound(latest) : undefined;
    if (latest && latestContent) sections[roundSectionName(latest)] = latestContent;
    return NextResponse.json(
      {
        ...assembleProjection(sections),
        version: reader.version,
        roundSections: reader.roundHashes,
        loadedRoundIds: latest && latestContent ? [latest] : [],
      },
      { headers: publicCacheHeaders(15, 30) }
    );
  } catch (error) {
    if (error instanceof PublicViewError && error.status < 500) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Could not load public tournament projection:", error);
    return NextResponse.json(
      { error: "Could not load public tournament data. Try again later." },
      { status: 503 }
    );
  }
}
