import { NextRequest, NextResponse } from "next/server";
import { getPublicViewVersion, publicCacheHeaders, PublicViewError } from "@/lib/publicView/store";

export const runtime = "nodejs";

/** Tiny, cached change marker that public pages poll before refetching the full projection. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const version = await getPublicViewVersion(slug);
    return NextResponse.json({ version }, { headers: publicCacheHeaders(10, 20) });
  } catch (error) {
    if (error instanceof PublicViewError && error.status < 500) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Could not load public view version:", error);
    return NextResponse.json({ error: "Could not load public tournament data." }, { status: 503 });
  }
}
