import { randomBytes } from "node:crypto";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import type { Adjudicator, Institution, Team } from "@/types";
import {
  buildAdjudicatorFromSubmission,
  buildTeamFromSubmission,
  matchInstitution,
} from "@/lib/registration/review";
import type { RegistrationSettings, RegistrationSubmission } from "@/lib/registration/types";
import { applyNameGenerators } from "@/lib/registration/names";

/**
 * Automatic acceptance (Tabbycat `registration_confirmation`; docs/registration.md, "Automatic
 * acceptance"). When the settings say a submission needs no confirmation, the server creates the
 * team or adjudicator itself, directly in the live `teams` / `adjudicators` collections (as the
 * data-entry route does), with private URL keys, and marks the submission approved.
 *
 * Institutions are matched by name or code against the cloud copy; an institution that does not
 * exist yet is not created (institutions are not a live collection): the record carries the
 * institution's name, and the tab room links it when it adds the institution.
 */

/** Starting base score of automatically accepted adjudicators (the review page uses the same). */
export const REGISTERED_ADJUDICATOR_BASE_SCORE = 5;

export function needsConfirmation(
  settings: Pick<RegistrationSettings, "confirmation">,
  submission: Pick<RegistrationSubmission, "kind" | "representativeId">
): boolean {
  if (submission.kind === "institution") return true;
  const confirmation = settings.confirmation ?? "always";
  if (confirmation === "never") return false;
  if (confirmation === "open") return !submission.representativeId;
  return true;
}

const KEY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function privateKey(prefix = ""): string {
  let key = "";
  while (key.length < 12) {
    for (const value of randomBytes(16)) {
      if (value >= 240) continue;
      key += KEY_ALPHABET[value % KEY_ALPHABET.length];
      if (key.length === 12) break;
    }
  }
  return prefix ? `${prefix}_${key}` : key;
}

function randomId(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

function active<T>(documents: Array<{ id: string; data(): Record<string, unknown> | undefined }>): T[] {
  return documents
    .filter((document) => typeof document.data()?.deletedAt !== "string")
    .map((document) => ({ ...document.data(), id: document.id }) as T);
}

export interface AutoApproval {
  entityId: string;
  entityName: string;
}

/**
 * Creates the team or adjudicator for a submission that needs no confirmation. The caller marks
 * the submission approved with the returned id in the same request.
 */
export async function createRegisteredEntity(input: {
  firestore: Firestore;
  tournamentRef: DocumentReference;
  submission: RegistrationSubmission;
  settings: RegistrationSettings;
  adjudicatorBaseScore: number;
}): Promise<AutoApproval> {
  const { tournamentRef, submission, settings } = input;
  const [institutionsSnapshot, teamsSnapshot] = await Promise.all([
    tournamentRef.collection("institutions").get(),
    tournamentRef.collection("teams").get(),
  ]);
  const institutions = active<Institution>(institutionsSnapshot.docs);
  const teams = active<Team>(teamsSnapshot.docs);
  const match = submission.institution ? matchInstitution(submission.institution.name, institutions) : undefined;
  const institution = match
    ? { id: match.id, name: match.name }
    : undefined;
  const tournamentId = tournamentRef.id;
  if (submission.kind === "team") {
    // Break categories are checked against the current ones only when the registrant chose some.
    const breakCategoryIds = submission.team?.breakCategories?.length
      ? active<{ id: string }>((await tournamentRef.collection("breakCategories").get()).docs).map((category) => category.id)
      : undefined;
    const built = applyNameGenerators(buildTeamFromSubmission(submission, institution, randomId, { teams, breakCategoryIds }), {
      settings,
      institutionName: institution?.name ?? submission.institution?.name,
      teams,
    });
    const id = randomId("team");
    const team: Team = {
      ...built,
      ...(institution ? {} : submission.institution ? { institutionName: submission.institution.name } : {}),
      id,
      tournamentId,
      privateUrlKey: privateKey("team"),
      privatePasscode: privateKey(),
    };
    await tournamentRef.collection("teams").doc(id).create({ ...stripUndefined(team), syncVersion: 1 });
    return { entityId: id, entityName: team.name };
  }
  if (submission.kind === "adjudicator") {
    const { adjudicator: built } = buildAdjudicatorFromSubmission(submission, {
      institution,
      institutions,
      teams,
      baseScore: input.adjudicatorBaseScore,
    });
    const id = randomId("adj");
    const adjudicator: Adjudicator = {
      ...built,
      ...(institution ? {} : submission.institution ? { institutionName: submission.institution.name } : {}),
      id,
      tournamentId,
      privateUrlKey: privateKey("adj"),
      privatePasscode: privateKey(),
    };
    await tournamentRef.collection("adjudicators").doc(id).create({ ...stripUndefined(adjudicator), syncVersion: 1 });
    return { entityId: id, entityName: adjudicator.name };
  }
  throw new Error("Institution registrations are always reviewed.");
}

function stripUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
