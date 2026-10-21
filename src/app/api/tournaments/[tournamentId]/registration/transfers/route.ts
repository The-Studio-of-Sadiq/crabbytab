import { NextRequest, NextResponse } from "next/server";
import { isValidRecordId } from "@/lib/linkTokens";
import { reviewSlotTransfer } from "@/lib/registration/service";
import { assertStillAdministrator } from "@/lib/tournamentAdminAuth";
import { authorizeRegistrationAdmin, NO_STORE, readJsonBody, registrationErrorResponse } from "../shared";

export const runtime = "nodejs";

/** `{ transferId, decision: "approve" | "reject" }`: reviews a representative's place transfer. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorizeRegistrationAdmin(request, params);
  if ("response" in result) return result.response;
  const { authorization } = result;
  const body = await readJsonBody(request);
  if (!body || !isValidRecordId(body.transferId) || (body.decision !== "approve" && body.decision !== "reject")) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  try {
    const transfer = await reviewSlotTransfer({
      firestore: authorization.firestore,
      tournamentRef: authorization.tournamentRef,
      assertAdministrator: (transaction) => assertStillAdministrator(transaction, authorization),
      reviewerUid: authorization.user.uid,
      transferId: body.transferId,
      approve: body.decision === "approve",
      now: Date.now(),
    });
    return NextResponse.json({ transfer }, { headers: NO_STORE });
  } catch (error) {
    return registrationErrorResponse(error, "Could not review the transfer.");
  }
}
