import { NextRequest, NextResponse } from "next/server";
import {
  assertStillAdministrator,
  authorizeTournamentAdministrator,
  isValidTournamentId,
} from "@/lib/tournamentAdminAuth";
import {
  hashPublicFormsPassword,
  hasPublicFormsPassword,
  PUBLIC_FORMS_PASSWORD_DOCUMENT,
  publicFormsPasswordError,
} from "@/lib/publicFormsPassword";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const FORBIDDEN = "Only tournament administrators can manage the public form password.";

/**
 * The tournament password of the public forms (Tabbycat `public_password`). Administrators only.
 * GET says whether one is set (never the password or its hash); PUT `{password}` replaces it and
 * PUT `{password: null}` removes it. Stored hashed under `serverOnly`, which clients cannot read.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params;
  if (!isValidTournamentId(tournamentId)) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  const authorization = await authorizeTournamentAdministrator(request, tournamentId, FORBIDDEN);
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  try {
    const data = (await authorization.tournamentRef.collection("serverOnly").doc(PUBLIC_FORMS_PASSWORD_DOCUMENT).get()).data();
    return NextResponse.json(
      { passwordSet: hasPublicFormsPassword(data?.password), updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : null },
      { headers: NO_STORE }
    );
  } catch {
    return NextResponse.json({ error: "Could not load the public form password setting." }, { status: 503 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params;
  if (!isValidTournamentId(tournamentId)) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  const authorization = await authorizeTournamentAdministrator(request, tournamentId, FORBIDDEN);
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  let password: string | null;
  try {
    const body: unknown = await request.json();
    const value = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).password : undefined;
    if (value !== null) {
      const error = publicFormsPasswordError(value);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }
    password = value as string | null;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const reference = authorization.tournamentRef.collection("serverOnly").doc(PUBLIC_FORMS_PASSWORD_DOCUMENT);
  const updatedAt = new Date().toISOString();
  try {
    await authorization.firestore.runTransaction(async (transaction) => {
      await assertStillAdministrator(transaction, authorization);
      if (password === null) transaction.delete(reference);
      else transaction.set(reference, { password: hashPublicFormsPassword(password), updatedAt, updatedBy: authorization.user.uid });
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the password." }, { status: 409 });
  }
  return NextResponse.json({ passwordSet: password !== null, updatedAt: password === null ? null : updatedAt }, { headers: NO_STORE });
}
