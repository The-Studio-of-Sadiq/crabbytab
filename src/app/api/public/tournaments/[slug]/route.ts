import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_COLLECTION_NAMES } from "@/lib/publicView/projection";
import { assembleProjection } from "@/lib/publicView/snapshot";
import {
  getPublicSections,
  publicCacheHeaders,
  PublicViewError,
} from "@/lib/publicView/store";

export const runtime = "nodejs";

const PROJECTION_SECTIONS = ["tournament", ...PUBLIC_COLLECTION_NAMES] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const { version, sections } = await getPublicSections(slug, PROJECTION_SECTIONS);
    return NextResponse.json(
      { ...assembleProjection(sections), version },
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
