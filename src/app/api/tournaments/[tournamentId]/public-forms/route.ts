import { NextRequest, NextResponse } from "next/server";
import { authorizeTournamentAdministrator, isValidTournamentId } from "@/lib/tournamentAdminAuth";
import { hashPublicPassword, PUBLIC_FORMS_DOCUMENT, publicPasswordProblem } from "@/lib/publicForms";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

async function authorize(request: NextRequest, params: Promise<{ tournamentId: string }>) {
  const { tournamentId } = await params;
  if (!isValidTournamentId(tournamentId)) {
    return { response: NextResponse.json({ error: "Tournament not found." }, { status: 404, headers: NO_STORE }) };
  }
  const authorization = await authorizeTournamentAdministrator(request, tournamentId, "Only tournament administrators can manage the public form password.");
  if ("error" in authorization) {
    return {
      response: NextResponse.json(
        { error: authorization.status === 404 ? "This tournament has no cloud copy. Upload it first." : authorization.error },
        { status: authorization.status, headers: NO_STORE }
      ),
    };
  }
  return { documentRef: authorization.tournamentRef.collection("serverOnly").doc(PUBLIC_FORMS_DOCUMENT) };
}

/** Whether a public form password is set (the password itself is never returned). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorize(request, params);
  if ("response" in result) return result.response;
  try {
    const data = (await result.documentRef.get()).data();
    return NextResponse.json(
      { passwordSet: typeof data?.passwordHash === "string", updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : null },
      { headers: NO_STORE }
    );
  } catch (error) {
    console.error("Could not read the public form password state:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not read the password setting. Try again later." }, { status: 503, headers: NO_STORE });
  }
}

/** `{password}` sets the password (stored as a salted hash); `{password: null}` removes it. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorize(request, params);
  if ("response" in result) return result.response;
  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: NO_STORE });
  }
  try {
    if (body.password === null) {
      await result.documentRef.delete();
      return NextResponse.json({ passwordSet: false, updatedAt: null }, { headers: NO_STORE });
    }
    const problem = publicPasswordProblem(body.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400, headers: NO_STORE });
    const stored = hashPublicPassword(body.password as string);
    await result.documentRef.set(stored);
    return NextResponse.json({ passwordSet: true, updatedAt: stored.updatedAt }, { headers: NO_STORE });
  } catch (error) {
    console.error("Could not save the public form password:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not save the password. Try again later." }, { status: 503, headers: NO_STORE });
  }
}
