import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { synchronizeGlobalAdminClaim } from "@/lib/globalAdmin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: "Sign in to check administrator access." }, { status: 401 });

  let auth;
  try {
    auth = getAdminAuth();
  } catch {
    return NextResponse.json(
      { error: "Server-side Firebase authorization is not configured." },
      { status: 503 }
    );
  }

  let uid: string;
  try {
    const decodedToken = await auth.verifyIdToken(token);
    uid = decodedToken.uid;
  } catch {
    return NextResponse.json({ error: "Your sign-in has expired. Please sign in again." }, { status: 401 });
  }

  try {
    const access = await synchronizeGlobalAdminClaim(auth, uid);
    return NextResponse.json(access, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Could not verify administrator access. Check the server Firebase configuration." },
      { status: 503 }
    );
  }
}
