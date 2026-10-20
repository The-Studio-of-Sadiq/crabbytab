import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
  checkPrivateApiRateLimit,
  checkPrivateFailureLimit,
  clientAddressFromHeaders,
  recordPrivateFailure,
} from "@/lib/privateTeamRateLimit";
import { publicCacheHeaders } from "@/lib/publicView/store";
import {
  describeRepresentative,
  loadRepresentativeByToken,
  readSettings,
  registrationRefs,
  RegistrationError,
  resolveTournamentBySlug,
  submitRegistration,
} from "@/lib/registration/service";
import {
  MAX_REGISTRATION_BODY_BYTES,
  RegistrationValidationError,
  spamSignal,
  toPublicForm,
} from "@/lib/registration/validation";

export const runtime = "nodejs";

/**
 * Submissions per hour: per client address per tournament (a representative on one network may
 * register a whole institution), per client address overall, and per tournament.
 */
const PER_ADDRESS_PER_TOURNAMENT = 40;
const PER_ADDRESS = 60;
const PER_TOURNAMENT = 600;
const MAX_FAILED_LINKS = 30;
const NO_STORE = { "Cache-Control": "no-store" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function json(body: unknown, status = 200, headers: Record<string, string> = NO_STORE) {
  return NextResponse.json(body, { status, headers });
}

function getFirestore(): Firestore | null {
  try {
    return getAdminFirestore();
  } catch {
    return null;
  }
}

/**
 * The public registration form. Cached briefly at the edge so a busy form costs Firestore a few
 * reads a minute, not a few per visitor.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const firestore = getFirestore();
  if (!firestore) return json({ error: "Registration is not available on this server." }, 503);
  try {
    const tournamentRef = await resolveTournamentBySlug(firestore, slug);
    const settings = tournamentRef ? readSettings((await registrationRefs(tournamentRef).settingsRef.get()).data()) : null;
    if (!settings) return json({ error: "This tournament is not taking registrations." }, 404, publicCacheHeaders(60, 120));
    return json({ form: toPublicForm(settings, Date.now()) }, 200, publicCacheHeaders(30, 60));
  } catch (error) {
    console.error("Could not load the registration form:", error instanceof Error ? error.message : error);
    return json({ error: "Could not load the registration form. Try again later." }, 503);
  }
}

async function throttled(firestore: Firestore, identity: string, scope: string, max: number, now: number) {
  const result = await checkPrivateApiRateLimit(firestore, identity, scope, max, now);
  return result.allowed ? null : result.retryAfterSeconds;
}

/**
 * `{action: "representative", token}` describes a representative link; `{action: "submit",
 * registration, representativeToken?, website, startedAt}` stores a registration for review.
 * `website` is a honeypot field people never see, and `startedAt` is when the form was shown.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REGISTRATION_BODY_BYTES) return json({ error: "This registration is too large." }, 413);
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_REGISTRATION_BODY_BYTES) return json({ error: "This registration is too large." }, 413);
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error("not an object");
    body = parsed;
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  if (body.action !== "representative" && body.action !== "submit") return json({ error: "Invalid request body." }, 400);

  const now = Date.now();
  if (body.action === "submit") {
    const signal = spamSignal({ honeypot: body.website, startedAt: body.startedAt }, now);
    // A filled honeypot gets an ordinary-looking answer, so automated senders learn nothing.
    if (signal === "honeypot") return json({ received: true });
    if (signal === "too_fast") return json({ error: "That was quick! Check your entry and submit again." }, 400);
    if (signal) return json({ error: "This form has expired. Reload the page and submit again." }, 400);
  }

  const firestore = getFirestore();
  if (!firestore) return json({ error: "Registration is not available on this server." }, 503);
  const address = clientAddressFromHeaders(request.headers);

  try {
    const tournamentRef = await resolveTournamentBySlug(firestore, slug);
    if (!tournamentRef) return json({ error: "This tournament is not taking registrations." }, 404);
    const hasToken = typeof body.token === "string" || typeof body.representativeToken === "string";
    if (hasToken) {
      const limit = await checkPrivateFailureLimit(firestore, address, "reg-link", MAX_FAILED_LINKS, now);
      if (!limit.allowed) {
        return NextResponse.json(
          { error: "Too many invalid registration links from this network. Try again later." },
          { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } }
        );
      }
    }

    if (body.action === "representative") {
      const settings = readSettings((await registrationRefs(tournamentRef).settingsRef.get()).data());
      if (!settings) return json({ error: "This tournament is not taking registrations." }, 404);
      const representative = await loadRepresentativeByToken(tournamentRef, body.token);
      return json({ representative: await describeRepresentative(tournamentRef, representative, settings) });
    }

    for (const [identity, scope, max] of [
      [`${tournamentRef.id}:${address}`, "reg-address-tournament", PER_ADDRESS_PER_TOURNAMENT],
      [address, "reg-address", PER_ADDRESS],
      [tournamentRef.id, "reg-tournament", PER_TOURNAMENT],
    ] as const) {
      const retryAfter = await throttled(firestore, identity, scope, max, now);
      if (retryAfter !== null) {
        return NextResponse.json(
          { error: "Too many registrations right now. Try again later." },
          { status: 429, headers: { ...NO_STORE, "Retry-After": String(retryAfter) } }
        );
      }
    }

    const result = await submitRegistration({
      firestore,
      tournamentRef,
      registration: body.registration,
      representativeToken: body.representativeToken,
      sourceHash: createHash("sha256").update(`${tournamentRef.id}:${address}`).digest("hex").slice(0, 16),
      now,
    });
    return json({ received: true, kind: result.kind });
  } catch (error) {
    if (error instanceof RegistrationError) {
      if (error.badToken) {
        await recordPrivateFailure(firestore, address, "reg-link", MAX_FAILED_LINKS, now).catch((recordError) =>
          console.warn("Could not record a failed registration link:", recordError instanceof Error ? recordError.message : recordError)
        );
      }
      return json({ error: error.message }, error.status);
    }
    if (error instanceof RegistrationValidationError) return json({ error: error.message }, error.status);
    console.error("Registration request failed:", error instanceof Error ? error.message : error);
    return json({ error: "Could not save the registration. Try again later." }, 503);
  }
}
