import { NextRequest, NextResponse } from "next/server";
import { Adjudicator, Debate, Round, Team } from "@/types";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
  checkPrivateFailureLimit,
  checkPrivateTeamRateLimit,
  clientAddressFromHeaders,
  recordPrivateFailure,
} from "@/lib/privateTeamRateLimit";
import { findTeamsByPrivateKey, matchPrivateTeamCredential } from "@/lib/privateSpeakerAccess";
import { getPublicRelease, redactUnreleasedBreak } from "@/lib/publicRelease";
import {
  createPortalNamer,
  filterTeamVisibleDebates,
  portalUsesParticipantCodeNames,
  renamePortalDebate,
  sanitizeTeamPrivateDebate,
} from "@/lib/privatePortalBallots";
import { getPublicSiteSettings, publicUsesTeamCodeNames } from "@/lib/publicFeatures";
import { loadParticipantDebates, loadPortalVenues, portalRoundProjection } from "@/lib/privateParticipantData";

export const runtime = "nodejs";

function validDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { tournamentId, privateUrlKey, passcode } = body;
  if (
    !validDocumentId(tournamentId) ||
    typeof privateUrlKey !== "string" ||
    privateUrlKey.length === 0 ||
    privateUrlKey.length > 128 ||
    typeof passcode !== "string" ||
    passcode.length === 0 ||
    passcode.length > 128
  ) {
    return NextResponse.json({ error: "Invalid private team link or passcode." }, { status: 400 });
  }

  try {
    const firestore = getAdminFirestore();
    const clientIdentity = `${tournamentId}:${clientAddressFromHeaders(request.headers)}`;
    const failureLimit = await checkPrivateFailureLimit(firestore, clientIdentity, "team");
    if (!failureLimit.allowed) {
      return NextResponse.json(
        { error: "Too many private team requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(failureLimit.retryAfterSeconds) } }
      );
    }
    const noteFailedAttempt = () => recordPrivateFailure(firestore, clientIdentity, "team").catch((error) => {
      console.error("Could not record failed private team attempt:", error);
    });
    const tournamentRef = firestore.collection("tournaments").doc(tournamentId);
    // The team's own key, or one of its speakers' keys (docs/privacy-and-private-urls).
    const [tournamentSnapshot, teamCandidates] = await Promise.all([
      tournamentRef.get(),
      findTeamsByPrivateKey(tournamentRef.collection("teams"), privateUrlKey),
    ]);
    const teamDocument = teamCandidates.length === 1 ? teamCandidates[0] : undefined;
    if (!tournamentSnapshot.exists) {
      return NextResponse.json({ error: "This private team link is invalid." }, { status: 404 });
    }
    if (!teamDocument) {
      // Same response as a wrong passcode so valid keys cannot be enumerated.
      await noteFailedAttempt();
      return NextResponse.json({ error: "Invalid team link or passcode." }, { status: 403 });
    }
    let rateLimit: Awaited<ReturnType<typeof checkPrivateTeamRateLimit>>;
    try {
      rateLimit = await checkPrivateTeamRateLimit(
        firestore,
        `${tournamentId}:${privateUrlKey}`
      );
    } catch (error) {
      console.error("Could not enforce private team rate limit:", error);
      return NextResponse.json(
        { error: "Could not process private team request. Try again later." },
        { status: 503 }
      );
    }
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many private team requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }
    const credential = matchPrivateTeamCredential(teamDocument.data(), privateUrlKey, passcode);
    if (!credential) {
      await noteFailedAttempt();
      return NextResponse.json({ error: "Invalid team link or passcode." }, { status: 403 });
    }

    const teamData = teamDocument.data()!;
    const [{ debates: participantDebates }, roundsSnapshot, feedbackSnapshot] = await Promise.all([
      loadParticipantDebates(tournamentRef, teamDocument.id),
      tournamentRef.collection("rounds").get(),
      tournamentRef.collection("feedback").where("sourceId", "==", teamDocument.id).get(),
    ]);
    const liveRoundsById = new Map(
      roundsSnapshot.docs
        .filter((document) => typeof document.data().deletedAt !== "string")
        .map((document) => [document.id, { ...document.data(), id: document.id } as Round] as const)
    );
    const debates: Debate[] = filterTeamVisibleDebates(
      [...participantDebates.values()]
        .filter((debate) =>
          Object.values(debate.teams || {}).some(
            (slot) => slot?.teamId === teamDocument.id
          )
        ),
      liveRoundsById
    );
    const roundIds = new Set(debates.map((debate) => debate.roundId));
    const rounds = [...liveRoundsById.values()].filter((round) => roundIds.has(round.id));
    const tournamentData = tournamentSnapshot.data()!;
    const roundsById = new Map(rounds.map((round) => [round.id, round]));
    // Room links (online rooms, maps) for debates of rounds still running.
    const venues = await loadPortalVenues(
      tournamentRef,
      debates.filter((debate) => roundsById.get(debate.roundId)?.completed !== true)
    );
    const sanitized = debates.map((debate) =>
      sanitizeTeamPrivateDebate(
        debate,
        roundsById.get(debate.roundId),
        tournamentData.preferences?.publicResults !== false
      )
    );
    // Code-name modes rename other teams (and, with participant code names everywhere, the panel)
    // exactly as the private sync route does, so the portal never shows a real name the public
    // site hides. Only the teams and adjudicators in these debates are read.
    const siteSettings = getPublicSiteSettings(tournamentData.preferences);
    const renameTeams = publicUsesTeamCodeNames(siteSettings.teamCodeNames);
    const renameAdjudicators = portalUsesParticipantCodeNames(tournamentData.preferences);
    let safeDebates = sanitized;
    if (renameTeams || renameAdjudicators) {
      const teamIds = new Set<string>();
      const adjudicatorIds = new Set<string>();
      for (const debate of sanitized) {
        for (const slot of Object.values(debate.teams || {})) if (slot?.teamId) teamIds.add(slot.teamId);
        const panel = debate.adjudicators;
        if (renameAdjudicators && panel) {
          if (panel.chairId) adjudicatorIds.add(panel.chairId);
          for (const id of [...(panel.panellistIds ?? []), ...(panel.traineeIds ?? [])]) adjudicatorIds.add(id);
        }
      }
      const read = async <T,>(collection: string, ids: Set<string>) => {
        if (ids.size === 0) return [] as T[];
        const snapshots = await firestore.getAll(...[...ids].map((id) => tournamentRef.collection(collection).doc(id)));
        return snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => ({ ...snapshot.data(), id: snapshot.id }) as T);
      };
      const [teams, adjudicators] = await Promise.all([
        read<Team>("teams", teamIds),
        read<Adjudicator>("adjudicators", adjudicatorIds),
      ]);
      const namer = createPortalNamer({
        preferences: tournamentData.preferences,
        viewer: { type: "team", id: teamDocument.id },
        teams,
        adjudicators,
      });
      safeDebates = sanitized.map((debate) => renamePortalDebate(debate, namer));
    }

    return NextResponse.json({
      team: {
        id: teamDocument.id,
        tournamentId,
        name: teamData.name,
        // A team only learns its break result once that category is released.
        ...redactUnreleasedBreak(
          {
            breakStatus: teamData.breakStatus,
            breakCategoryIds: teamData.breakCategoryIds,
            eliminatedInRoundId: teamData.eliminatedInRoundId,
          },
          getPublicRelease(tournamentData.preferences)
        ),
        codeName: teamData.codeName,
        institutionId: teamData.institutionId,
        institutionName: teamData.institutionName,
        speakers: Array.isArray(teamData.speakers)
          ? teamData.speakers.map((speaker: Record<string, unknown>) => ({
              id: speaker.id,
              name: speaker.name,
              categories: speaker.categories,
            }))
          : [],
        breakCategories: teamData.breakCategories || [],
        speakerCategories: teamData.speakerCategories || [],
        privateUrlKey,
        // A speaker's own URL: which speaker opened the portal (it still acts as the team).
        ...(credential.speakerId ? { speakerId: credential.speakerId } : {}),
        checkedIn: teamData.checkedIn,
      },
      tournament: {
        id: tournamentSnapshot.id,
        name: tournamentData.name,
        shortName: tournamentData.shortName,
        slug: tournamentData.slug,
        format: tournamentData.format,
        preferences: tournamentData.preferences,
      },
      // Only the fields the portal needs: never preformed panels, preallocated sides or the draw seed.
      rounds: rounds.map((round) => portalRoundProjection(round as unknown as Record<string, unknown> & { id: string })),
      debates: safeDebates,
      venues,
      feedback: feedbackSnapshot.docs.map((document) => ({
        ...document.data(),
        id: document.id,
      })),
    });
  } catch (error) {
    console.error("Could not load private team portal:", error);
    return NextResponse.json(
      { error: "Could not load private team data. Try again later." },
      { status: 503 }
    );
  }
}
