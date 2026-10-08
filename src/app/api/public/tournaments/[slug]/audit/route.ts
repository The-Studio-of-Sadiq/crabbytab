import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { AuditCategory, PublicAuditEvent } from "@/types";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }

  try {
    const firestore = getAdminFirestore();
    const tournamentSnapshot = await firestore
      .collection("tournaments")
      .where("slug", "==", slug)
      .limit(1)
      .get();
    const tournamentDocument = tournamentSnapshot.docs[0];
    if (!tournamentDocument) {
      return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    }

    const releaseSnapshot = await tournamentDocument.ref
      .collection("auditReleases")
      .doc("current")
      .get();
    if (!releaseSnapshot.exists) {
      return NextResponse.json({ error: "This audit log has not been released." }, { status: 404 });
    }

    const release = releaseSnapshot.data();
    if (
      typeof release?.releaseId !== "string" ||
      !/^[0-9a-f-]{36}$/.test(release.releaseId) ||
      typeof release.releasedAt !== "string" ||
      !Number.isSafeInteger(release.eventCount) ||
      release.eventCount < 0
    ) {
      throw new Error("The published audit release metadata is invalid.");
    }

    const releaseInfo = {
      tournamentName:
        typeof tournamentDocument.data().shortName === "string"
          ? tournamentDocument.data().shortName
          : tournamentDocument.data().name,
      releasedAt: release.releasedAt,
      eventCount: release.eventCount,
    };
    if (request.nextUrl.searchParams.get("status") === "1") {
      return NextResponse.json(releaseInfo, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const eventSnapshot = await tournamentDocument.ref
      .collection("auditReleases")
      .doc(release.releaseId)
      .collection("events")
      .orderBy("sequence")
      .get();
    const events: PublicAuditEvent[] = eventSnapshot.docs.map((document) => {
      const value = document.data();
      return {
        sequence: value.sequence as number,
        timestamp: value.timestamp as string,
        category: value.category as AuditCategory,
        action: value.action as string,
        summary: value.summary as string,
        previousHash: value.previousHash as string,
        hash: value.hash as string,
      };
    });
    if (events.length !== release.eventCount) {
      throw new Error("The published audit release is incomplete.");
    }

    return NextResponse.json(
      {
        ...releaseInfo,
        events,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Could not load the public tournament audit log:", error);
    return NextResponse.json(
      { error: "Could not load the public audit log. Try again later." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
