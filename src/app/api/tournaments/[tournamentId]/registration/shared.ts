import { NextRequest, NextResponse } from "next/server";
import { RegistrationError } from "@/lib/registration/service";
import { RegistrationValidationError } from "@/lib/registration/validation";
import {
  authorizeTournamentAdministrator,
  isValidTournamentId,
  StaleAuthorizationError,
  type TournamentAdministratorAuthorization,
} from "@/lib/tournamentAdminAuth";

export const NO_STORE = { "Cache-Control": "no-store" };

export async function authorizeRegistrationAdmin(
  request: NextRequest,
  params: Promise<{ tournamentId: string }>
): Promise<{ authorization: TournamentAdministratorAuthorization; tournamentId: string } | { response: NextResponse }> {
  const { tournamentId } = await params;
  if (!isValidTournamentId(tournamentId)) {
    return { response: NextResponse.json({ error: "Tournament not found." }, { status: 404 }) };
  }
  const authorization = await authorizeTournamentAdministrator(
    request,
    tournamentId,
    "Only tournament administrators can manage registration."
  );
  if ("error" in authorization) {
    return {
      response: NextResponse.json(
        {
          error:
            authorization.status === 404
              ? "This tournament has no cloud copy. Upload it before using registration."
              : authorization.error,
        },
        { status: authorization.status }
      ),
    };
  }
  return { authorization, tournamentId };
}

export async function readJsonBody(request: NextRequest, maxBytes = 64_000): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    const body: unknown = JSON.parse(text);
    return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function registrationErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof RegistrationError || error instanceof RegistrationValidationError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
  }
  if (error instanceof StaleAuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: 409, headers: NO_STORE });
  }
  console.error(fallback, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 503, headers: NO_STORE });
}
