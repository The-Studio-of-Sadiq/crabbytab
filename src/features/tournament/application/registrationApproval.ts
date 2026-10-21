import type { Adjudicator, Institution, Team } from "@/types";
import {
  buildAdjudicatorFromSubmission,
  buildTeamFromSubmission,
  matchInstitution,
  suggestInstitutionCode,
} from "@/lib/registration/review";
import type { RegistrationSettings, RegistrationSubmission } from "@/lib/registration/types";
import { applyNameGenerators } from "@/lib/registration/names";

/**
 * Approving a registration (docs/registration.md). The server cannot create teams or
 * adjudicators itself, because the administrator devices' working copies and the live sync
 * path (docs/live-collaboration.md) own those records. So approval is three steps:
 *
 * 1. `claim` the submission on the server (pending → being approved), so a second
 *    administrator cannot approve it at the same time;
 * 2. create the team or adjudicator here with the ordinary entity commands, which add private URL
 *    keys and, on a live cloud tournament, write the record live for every other device;
 * 3. `approve` it on the server with the new record's id.
 *
 * If step 2 fails the claim is released. If step 3 fails the record exists and the submission
 * stays "being approved"; `ApprovalIncompleteError` carries the record so the reviewer can finish
 * with **Mark approved** instead of creating it twice.
 */

export interface RegistrationReviewApi {
  claim(submission: RegistrationSubmission): Promise<RegistrationSubmission>;
  release(submission: RegistrationSubmission): Promise<RegistrationSubmission>;
  approve(submission: RegistrationSubmission, entity: { id: string; name: string }): Promise<RegistrationSubmission>;
}

export interface ApprovalDependencies {
  api: RegistrationReviewApi;
  institutions: Institution[];
  teams: Pick<Team, "id" | "name" | "codeName" | "emoji" | "institutionId" | "institutionName">[];
  /** Current break category ids; registered categories not among them are dropped. Absent: kept. */
  breakCategoryIds?: string[];
  addInstitutions(institutions: Omit<Institution, "id" | "tournamentId">[]): Promise<Institution[]>;
  addTeams(teams: Omit<Team, "id" | "tournamentId">[]): Promise<Team[]>;
  addAdjudicators(adjudicators: Omit<Adjudicator, "id" | "tournamentId">[]): Promise<Adjudicator[]>;
  createId(prefix: string): string;
  /** Starting base score for registered adjudicators. */
  adjudicatorBaseScore: number;
  /** Team-name and code-name generators (absent: keep the registrant's name). */
  settings?: Pick<RegistrationSettings, "teamNameGenerator" | "codeNameGenerator">;
}

export interface ApprovalResult {
  submission: RegistrationSubmission;
  entity: { id: string; name: string; kind: RegistrationSubmission["kind"] };
  /** An institution created for this registration (institutions sync by upload, not live). */
  createdInstitution?: Institution;
  /** Declared adjudicator conflicts that matched no institution or team. */
  unmatchedConflicts: string[];
}

export class ApprovalIncompleteError extends Error {
  constructor(
    readonly entity: { id: string; name: string },
    readonly submission: RegistrationSubmission,
    cause: unknown
  ) {
    super(
      `${entity.name} was created, but the submission could not be marked approved (${
        cause instanceof Error ? cause.message : "unknown error"
      }). Use “Mark approved” to finish.`
    );
  }
}

async function resolveInstitution(
  submission: RegistrationSubmission,
  dependencies: ApprovalDependencies
): Promise<{ institution?: Institution; created?: Institution }> {
  if (!submission.institution) return {};
  const match = matchInstitution(submission.institution.name, dependencies.institutions);
  const existing = match && dependencies.institutions.find((institution) => institution.id === match.id);
  if (existing) return { institution: existing };
  const [created] = await dependencies.addInstitutions([
    {
      name: submission.institution.name,
      code: suggestInstitutionCode(submission.institution.name, dependencies.institutions.map((institution) => institution.code)),
    },
  ]);
  if (!created) throw new Error(`Could not create the institution ${submission.institution.name}.`);
  return { institution: created, created };
}

export async function approveRegistration(
  submission: RegistrationSubmission,
  dependencies: ApprovalDependencies
): Promise<ApprovalResult> {
  if (submission.status !== "pending") throw new Error("Only pending submissions can be approved.");
  if (submission.kind === "institution") throw new Error("Give an institution registration its places instead.");
  const claimed = await dependencies.api.claim(submission);

  let entity: { id: string; name: string };
  let createdInstitution: Institution | undefined;
  let unmatchedConflicts: string[] = [];
  try {
    const { institution, created } = await resolveInstitution(claimed, dependencies);
    createdInstitution = created;
    if (claimed.kind === "team") {
      const built = applyNameGenerators(buildTeamFromSubmission(claimed, institution, dependencies.createId, {
        teams: dependencies.teams,
        breakCategoryIds: dependencies.breakCategoryIds,
      }), {
        settings: dependencies.settings ?? {},
        institutionName: institution?.name,
        teams: dependencies.teams,
      });
      const [team] = await dependencies.addTeams([built]);
      if (!team) throw new Error("The team was not created.");
      entity = { id: team.id, name: team.name };
    } else {
      const built = buildAdjudicatorFromSubmission(claimed, {
        institution,
        institutions: created ? [...dependencies.institutions, created] : dependencies.institutions,
        teams: dependencies.teams,
        baseScore: dependencies.adjudicatorBaseScore,
      });
      unmatchedConflicts = built.unmatchedConflicts;
      const [adjudicator] = await dependencies.addAdjudicators([built.adjudicator]);
      if (!adjudicator) throw new Error("The adjudicator was not created.");
      entity = { id: adjudicator.id, name: adjudicator.name };
    }
  } catch (error) {
    await dependencies.api.release(claimed).catch((releaseError: unknown) =>
      console.warn("Could not release the registration claim:", releaseError instanceof Error ? releaseError.message : releaseError)
    );
    throw error;
  }

  try {
    const approved = await dependencies.api.approve(claimed, entity);
    return { submission: approved, entity: { ...entity, kind: claimed.kind }, createdInstitution, unmatchedConflicts };
  } catch (error) {
    throw new ApprovalIncompleteError(entity, claimed, error);
  }
}

/** Existing records that a stuck "being approved" submission most likely created. */
export function likelyCreatedEntities(
  submission: RegistrationSubmission,
  teams: Pick<Team, "id" | "name">[],
  adjudicators: Pick<Adjudicator, "id" | "name" | "email">[]
): Array<{ id: string; name: string }> {
  const key = (value: string | undefined) => (value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  if (submission.kind === "team") {
    return teams.filter((team) => key(team.name) === key(submission.team?.name)).map(({ id, name }) => ({ id, name }));
  }
  return adjudicators
    .filter(
      (adjudicator) =>
        key(adjudicator.name) === key(submission.adjudicator?.name) ||
        (adjudicator.email && key(adjudicator.email) === key(submission.adjudicator?.email))
    )
    .map(({ id, name }) => ({ id, name }));
}
