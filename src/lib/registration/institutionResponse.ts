import type { DocumentReference } from "firebase-admin/firestore";
import { registrationRefs } from "@/lib/registration/service";
import type { RegistrationRepresentative, RegistrationStatus, RegistrationSubmission } from "@/lib/registration/types";

/**
 * A coach's view of their institution's registration response (Tabbycat reg-inst-view-response;
 * docs/registration.md): what was registered for the institution and where each entry stands.
 * Shown to the holder of the institution's representative link only. Contact details, phone
 * numbers, answers and administrators' rejection reasons are left out.
 */

export interface InstitutionResponseItem {
  id: string;
  kind: RegistrationSubmission["kind"];
  name: string;
  status: RegistrationStatus;
  submittedAt: string;
  /** Teams: the speakers' names. */
  speakers?: string[];
  /** Institution requests: places asked for and, once allocated, given. */
  teamsRequested?: number;
  adjudicatorsRequested?: number;
  teamsAllocated?: number;
  adjudicatorsAllocated?: number;
}

/** The institution's submissions (made with this link, or for the same institution), newest first. */
export function institutionResponseView(
  submissions: readonly RegistrationSubmission[],
  representative: Pick<RegistrationRepresentative, "id" | "institution">
): InstitutionResponseItem[] {
  const seen = new Set<string>();
  return submissions
    .filter((submission) =>
      submission.representativeId === representative.id ||
      submission.institution?.key === representative.institution.key)
    .filter((submission) => !seen.has(submission.id) && Boolean(seen.add(submission.id)))
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt))
    .map((submission) => {
      const item: InstitutionResponseItem = {
        id: submission.id,
        kind: submission.kind,
        name:
          submission.kind === "team" ? submission.team?.name ?? "" :
          submission.kind === "adjudicator" ? submission.adjudicator?.name ?? "" :
          submission.institution?.name ?? representative.institution.name,
        status: submission.status,
        submittedAt: submission.submittedAt,
      };
      if (submission.kind === "team") item.speakers = (submission.team?.speakers ?? []).map((speaker) => speaker.name);
      if (submission.kind === "institution" && submission.institutionRequest) {
        item.teamsRequested = submission.institutionRequest.teamsRequested;
        item.adjudicatorsRequested = submission.institutionRequest.adjudicatorsRequested;
        if (submission.teamsAllocated !== undefined) item.teamsAllocated = submission.teamsAllocated;
        if (submission.adjudicatorsAllocated !== undefined) item.adjudicatorsAllocated = submission.adjudicatorsAllocated;
      }
      return item;
    });
}

/** Reads the submissions a representative may see: two indexed equality queries. */
export async function loadInstitutionResponse(
  tournamentRef: DocumentReference,
  representative: Pick<RegistrationRepresentative, "id" | "institution">
): Promise<InstitutionResponseItem[]> {
  const submissions = registrationRefs(tournamentRef).submissions;
  const [byLink, byInstitution] = await Promise.all([
    submissions.where("representativeId", "==", representative.id).get(),
    submissions.where("institution.key", "==", representative.institution.key).get(),
  ]);
  return institutionResponseView(
    [...byLink.docs, ...byInstitution.docs].map((document) => document.data() as RegistrationSubmission),
    representative
  );
}
