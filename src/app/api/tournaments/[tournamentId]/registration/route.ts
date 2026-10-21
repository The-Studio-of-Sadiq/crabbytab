import { NextRequest, NextResponse } from "next/server";
import { readCounters } from "@/lib/registration/quota";
import { readSettings, registrationRefs, summarizeRepresentative } from "@/lib/registration/service";
import type { RegistrationRepresentative, RegistrationSubmission, SlotTransfer } from "@/lib/registration/types";
import { defaultRegistrationSettings, parseRegistrationSettings } from "@/lib/registration/validation";
import { assertStillAdministrator } from "@/lib/tournamentAdminAuth";
import { authorizeRegistrationAdmin, NO_STORE, readJsonBody, registrationErrorResponse } from "./shared";

export const runtime = "nodejs";

function tournamentName(data: Record<string, unknown> | undefined): string {
  return typeof data?.name === "string" && data.name.trim() ? data.name : "Tournament";
}

/** Non-general, not deleted break categories in category order: the ones a team can choose. */
function registrableBreakCategories(records: Array<Record<string, unknown> & { id: string }>): Array<{ id: string; name: string }> {
  return records
    .filter((record) => record.isGeneral !== true && typeof record.deletedAt !== "string" && typeof record.name === "string")
    .sort((left, right) => (Number(left.seq) || 0) - (Number(right.seq) || 0))
    .map((record) => ({ id: record.id, name: record.name as string }));
}

function substantiveSpeakers(data: Record<string, unknown> | undefined): number {
  const preferences = data?.preferences as { substantiveSpeakers?: unknown } | undefined;
  return typeof preferences?.substantiveSpeakers === "number" ? preferences.substantiveSpeakers : 2;
}

/** Settings, every submission, representatives and counters, for the review page. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorizeRegistrationAdmin(request, params);
  if ("response" in result) return result.response;
  const { tournamentRef } = result.authorization;
  const refs = registrationRefs(tournamentRef);
  try {
    const [tournament, settings, counters, submissions, representatives, transfers] = await Promise.all([
      tournamentRef.get(),
      refs.settingsRef.get(),
      refs.countersRef.get(),
      refs.submissions.get(),
      refs.representatives.get(),
      refs.transfers.get(),
    ]);
    const data = tournament.data();
    return NextResponse.json(
      {
        settings: readSettings(settings.data()) ?? defaultRegistrationSettings(tournamentName(data), substantiveSpeakers(data)),
        configured: settings.exists,
        slug: typeof data?.slug === "string" ? data.slug : "",
        counters: readCounters(counters.data()),
        submissions: submissions.docs
          .map((document) => document.data() as RegistrationSubmission)
          .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt)),
        representatives: representatives.docs
          .map((document) => summarizeRepresentative(document.data() as RegistrationRepresentative))
          .sort((left, right) => left.institution.name.localeCompare(right.institution.name)),
        transfers: transfers.docs
          .map((document) => document.data() as SlotTransfer)
          .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt)),
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    return registrationErrorResponse(error, "Could not load registration.");
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorizeRegistrationAdmin(request, params);
  if ("response" in result) return result.response;
  const { authorization } = result;
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const refs = registrationRefs(authorization.tournamentRef);
  try {
    const settings = await authorization.firestore.runTransaction(async (transaction) => {
      const tournament = await assertStillAdministrator(transaction, authorization);
      // Copied into the settings so the public form needs no extra reads (docs/registration.md).
      const categories = await transaction.get(authorization.tournamentRef.collection("breakCategories"));
      const preferences = tournament?.preferences as { teamSeedMode?: unknown } | undefined;
      const parsed = parseRegistrationSettings(body.settings, tournamentName(tournament), {
        breakCategories: registrableBreakCategories(categories.docs.map((document) => ({ ...document.data(), id: document.id }))),
        teamSeedMode: preferences?.teamSeedMode,
      });
      const stored = { ...parsed, updatedAt: new Date().toISOString(), updatedBy: authorization.user.uid };
      transaction.set(refs.settingsRef, stored);
      return stored;
    });
    return NextResponse.json({ settings }, { headers: NO_STORE });
  } catch (error) {
    return registrationErrorResponse(error, "Could not save registration settings.");
  }
}
