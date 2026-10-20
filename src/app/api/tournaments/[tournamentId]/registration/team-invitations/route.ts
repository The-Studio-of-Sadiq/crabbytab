import { NextRequest, NextResponse } from "next/server";
import { isValidRecordId, linkOrigin } from "@/lib/linkTokens";
import { RegistrationError } from "@/lib/registration/service";
import {
  issueTeamInvitation,
  summarizeTeamInvitation,
  teamInvitationLink,
  teamInvitationsRef,
  type TeamInvitation,
} from "@/lib/registration/teamInvitations";
import { assertStillAdministrator, type TournamentAdministratorAuthorization } from "@/lib/tournamentAdminAuth";
import { authorizeRegistrationAdmin, NO_STORE, readJsonBody, registrationErrorResponse } from "../shared";

export const runtime = "nodejs";

/**
 * Team invitation links (docs/registration.md, "Team invitations"), administrators only. A link
 * is shown once when issued; only its hash is stored.
 */

async function list(authorization: TournamentAdministratorAuthorization) {
  const snapshot = await teamInvitationsRef(authorization.tournamentRef).get();
  return snapshot.docs
    .map((document) => summarizeTeamInvitation(document.data() as TeamInvitation))
    .sort((left, right) => left.teamName.localeCompare(right.teamName));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorizeRegistrationAdmin(request, params);
  if ("response" in result) return result.response;
  try {
    return NextResponse.json({ invitations: await list(result.authorization) }, { headers: NO_STORE });
  } catch (error) {
    return registrationErrorResponse(error, "Could not load team invitations.");
  }
}

/** `{teamId}`: a new link for the team (an earlier link stops working). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorizeRegistrationAdmin(request, params);
  if ("response" in result) return result.response;
  const { authorization, tournamentId } = result;
  const body = await readJsonBody(request);
  if (!body || !isValidRecordId(body.teamId)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const teamId = body.teamId;
  try {
    const issued = await authorization.firestore.runTransaction(async (transaction) => {
      const tournament = await assertStillAdministrator(transaction, authorization);
      const team = (await transaction.get(authorization.tournamentRef.collection("teams").doc(teamId))).data();
      if (!team || typeof team.deletedAt === "string") {
        throw new RegistrationError("That team is not in the cloud copy. Upload the tournament first.", 404);
      }
      const slug = typeof tournament.slug === "string" ? tournament.slug : "";
      if (!slug) throw new RegistrationError("Give the tournament a URL slug before sending invitation links.", 409);
      const { record, token } = issueTeamInvitation(
        tournamentId,
        { id: teamId, name: String(team.name ?? "") },
        authorization.user.uid,
        new Date().toISOString()
      );
      transaction.set(teamInvitationsRef(authorization.tournamentRef).doc(teamId), record);
      return { token, slug };
    });
    return NextResponse.json(
      {
        invitations: await list(authorization),
        link: teamInvitationLink(linkOrigin(request.nextUrl.origin), issued.slug, issued.token),
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    return registrationErrorResponse(error, "Could not create the team invitation.");
  }
}

/** `{teamId}`: withdraws the team's link. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorizeRegistrationAdmin(request, params);
  if ("response" in result) return result.response;
  const { authorization } = result;
  const body = await readJsonBody(request);
  if (!body || !isValidRecordId(body.teamId)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const teamId = body.teamId;
  try {
    await authorization.firestore.runTransaction(async (transaction) => {
      await assertStillAdministrator(transaction, authorization);
      const reference = teamInvitationsRef(authorization.tournamentRef).doc(teamId);
      if (!(await transaction.get(reference)).exists) throw new RegistrationError("Team invitation not found.", 404);
      transaction.update(reference, { status: "revoked" });
    });
    return NextResponse.json({ invitations: await list(authorization) }, { headers: NO_STORE });
  } catch (error) {
    return registrationErrorResponse(error, "Could not withdraw the team invitation.");
  }
}
