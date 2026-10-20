import { randomBytes } from "node:crypto";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import type { Speaker } from "@/types";
import { createLinkToken, linkSecretMatches, parseLinkToken } from "@/lib/linkTokens";
import { readSettings, registrationRefs, RegistrationError } from "@/lib/registration/service";
import type { PersonField, RegistrationSettings } from "@/lib/registration/types";
import { parseRegisteredSpeaker, registrationWindowState } from "@/lib/registration/validation";

/**
 * Team invitations (Tabbycat registration Invitation for a team; docs/registration.md): a link an
 * organiser issues for one existing team, through which speakers add themselves to that team.
 * The link holds a single-purpose token (only its hash is stored, under the server-only
 * namespace), it can add speakers only to its own team, and every join goes through the public
 * form's speaker validation, the registration window and the team-size limit (maximum speakers).
 */

export interface TeamInvitation {
  /** The team's id: one live link per team. */
  id: string;
  teamId: string;
  teamName: string;
  tokenHash: string;
  status: "active" | "revoked";
  createdAt: string;
  createdBy: string;
  /** Speakers who joined through the link. */
  joined: number;
}

export type TeamInvitationSummary = Omit<TeamInvitation, "tokenHash">;

export function teamInvitationsRef(tournamentRef: DocumentReference) {
  return registrationRefs(tournamentRef).settingsRef.collection("teamInvitations");
}

export function summarizeTeamInvitation(record: TeamInvitation): TeamInvitationSummary {
  const { tokenHash: _tokenHash, ...summary } = record;
  return summary;
}

/** A new link for a team (replacing any earlier one, which stops working). */
export function issueTeamInvitation(
  tournamentId: string,
  team: { id: string; name: string },
  createdBy: string,
  now: string
): { record: TeamInvitation; token: string } {
  const { token, secretHash } = createLinkToken(tournamentId, team.id);
  return {
    token,
    record: {
      id: team.id,
      teamId: team.id,
      teamName: team.name,
      tokenHash: secretHash,
      status: "active",
      createdAt: now,
      createdBy,
      joined: 0,
    },
  };
}

export function teamInvitationLink(origin: string, slug: string, token: string): string {
  return `${origin}/register/${encodeURIComponent(slug)}/join#${token}`;
}

/** The record a token names, checked against the tournament it was used for. */
export async function loadTeamInvitationByToken(tournamentRef: DocumentReference, token: unknown): Promise<TeamInvitation> {
  const parsed = parseLinkToken(token);
  if (!parsed || parsed.tournamentId !== tournamentRef.id) {
    throw new RegistrationError("This team invitation link is not valid.", 404, true);
  }
  const record = (await teamInvitationsRef(tournamentRef).doc(parsed.recordId).get()).data() as TeamInvitation | undefined;
  if (!record || !linkSecretMatches(parsed.secret, record.tokenHash)) {
    throw new RegistrationError("This team invitation link is not valid.", 404, true);
  }
  if (record.status !== "active") throw new RegistrationError("This team invitation was withdrawn by the tournament.", 410);
  return record;
}

function openForJoining(settings: RegistrationSettings | null, now: number): RegistrationSettings {
  if (!settings || !settings.teamRegistration) throw new RegistrationError("This tournament is not taking team registrations.", 403);
  const state = registrationWindowState(settings, now);
  if (state === "not_open") throw new RegistrationError("Registration has not opened yet.", 403);
  if (state === "closed") throw new RegistrationError("Registration has closed.", 403);
  if (state !== "open") throw new RegistrationError("This tournament is not taking registrations.", 403);
  return settings;
}

export interface TeamInvitationView {
  teamName: string;
  institutionName?: string;
  speakers: number;
  maxSpeakers: number;
  speakerCategories: string[];
  speakerFields: PersonField[];
}

/** What the join page shows: the team, how many places are left, and the speaker fields. */
export async function describeTeamInvitation(
  tournamentRef: DocumentReference,
  token: unknown,
  now: number
): Promise<TeamInvitationView> {
  const invitation = await loadTeamInvitationByToken(tournamentRef, token);
  const settings = openForJoining(readSettings((await registrationRefs(tournamentRef).settingsRef.get()).data()), now);
  const team = (await tournamentRef.collection("teams").doc(invitation.teamId).get()).data();
  if (!team || typeof team.deletedAt === "string") throw new RegistrationError("This team no longer exists.", 410);
  return {
    teamName: String(team.name ?? invitation.teamName),
    ...(typeof team.institutionName === "string" && team.institutionName ? { institutionName: team.institutionName } : {}),
    speakers: Array.isArray(team.speakers) ? team.speakers.length : 0,
    maxSpeakers: settings.maxSpeakers,
    speakerCategories: settings.speakerCategories,
    speakerFields: settings.speakerFields ?? [],
  };
}

/** The settings a joining speaker is validated with: the team form's, without per-speaker questions (their answers have nowhere to go on a team). */
export function joinSettings(settings: RegistrationSettings): RegistrationSettings {
  return { ...settings, speakerQuestions: [] };
}

/**
 * Adds one speaker to the invitation's team, in one transaction that re-checks the link, the
 * team and its size, and bumps the team's `syncVersion` so a stale administrator upload is kept
 * as a conflict instead of dropping the new speaker.
 */
export async function joinTeamByInvitation(input: {
  firestore: Firestore;
  tournamentRef: DocumentReference;
  token: unknown;
  speaker: unknown;
  now: number;
}): Promise<{ teamName: string; speakerName: string }> {
  const { tournamentRef } = input;
  await loadTeamInvitationByToken(tournamentRef, input.token);
  const settings = openForJoining(readSettings((await registrationRefs(tournamentRef).settingsRef.get()).data()), input.now);
  const registered = parseRegisteredSpeaker(input.speaker, 0, joinSettings(settings));
  const parsed = parseLinkToken(input.token)!;
  const invitationRef = teamInvitationsRef(tournamentRef).doc(parsed.recordId);

  return input.firestore.runTransaction(async (transaction) => {
    const invitation = (await transaction.get(invitationRef)).data() as TeamInvitation | undefined;
    if (!invitation || invitation.status !== "active" || !linkSecretMatches(parsed.secret, invitation.tokenHash)) {
      throw new RegistrationError("This team invitation was withdrawn by the tournament.", 410);
    }
    // The link only ever reaches the team it was issued for.
    const teamRef = tournamentRef.collection("teams").doc(invitation.teamId);
    const team = (await transaction.get(teamRef)).data();
    if (!team || typeof team.deletedAt === "string") throw new RegistrationError("This team no longer exists.", 410);
    const speakers: Speaker[] = Array.isArray(team.speakers) ? team.speakers : [];
    if (speakers.length >= settings.maxSpeakers) {
      throw new RegistrationError(`This team already has ${speakers.length} speakers, the most allowed.`, 409);
    }
    if (speakers.some((speaker) => speaker.name.trim().toLowerCase() === registered.name.toLowerCase())) {
      throw new RegistrationError(`${registered.name} is already on this team.`, 409);
    }
    if (registered.email && speakers.some((speaker) => speaker.email?.toLowerCase() === registered.email?.toLowerCase())) {
      throw new RegistrationError("Someone on this team already registered with that email address.", 409);
    }
    const speaker: Speaker = { id: `spk-${randomBytes(8).toString("hex")}`, name: registered.name };
    if (registered.email) speaker.email = registered.email;
    if (registered.phone) speaker.phone = registered.phone;
    if (registered.gender) speaker.gender = registered.gender;
    if (registered.categories.length > 0) speaker.categories = registered.categories;
    transaction.update(teamRef, {
      speakers: [...speakers, speaker],
      syncVersion: (Number(team.syncVersion) || 0) + 1,
    });
    transaction.update(invitationRef, { joined: (invitation.joined || 0) + 1 });
    return { teamName: String(team.name ?? invitation.teamName), speakerName: speaker.name };
  });
}
