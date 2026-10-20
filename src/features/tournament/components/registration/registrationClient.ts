import type { User } from "firebase/auth";
import type {
  SlotTransfer,
  RegistrationCounters,
  RegistrationSettings,
  RegistrationSubmission,
  RepresentativeSummary,
} from "@/lib/registration/types";
import type { ReviewAction } from "@/lib/registration/service";

export interface RegistrationOverview {
  settings: RegistrationSettings;
  configured: boolean;
  slug: string;
  counters: RegistrationCounters;
  submissions: RegistrationSubmission[];
  representatives: RepresentativeSummary[];
  transfers?: SlotTransfer[];
}

export interface IssuedRepresentativeLink {
  email: string;
  link: string;
  delivered: boolean;
  error?: string;
}

export type RegistrationClient = ReturnType<typeof createRegistrationClient>;

/** Calls the administrator registration routes with the signed-in account's ID token. */
export function createRegistrationClient(user: User, tournamentId: string) {
  const base = `/api/tournaments/${encodeURIComponent(tournamentId)}/registration`;
  async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
    const token = await user.getIdToken();
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const result = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(result.error || "The registration request failed.");
    return result;
  }
  return {
    load: () => call<RegistrationOverview>("", "GET"),
    saveSettings: (settings: unknown) => call<{ settings: RegistrationSettings }>("", "PUT", { settings }),
    review: async (action: ReviewAction, submission: RegistrationSubmission, extra: Record<string, unknown> = {}) =>
      (
        await call<{ submission: RegistrationSubmission }>("/submissions", "POST", {
          action,
          submissionId: submission.id,
          revision: submission.revision,
          ...extra,
        })
      ).submission,
    allocate: (submission: RegistrationSubmission, teamsAllocated: number, adjudicatorsAllocated: number) =>
      call<{ submission: RegistrationSubmission; link?: IssuedRepresentativeLink }>("/submissions", "POST", {
        action: "allocate",
        submissionId: submission.id,
        revision: submission.revision,
        teamsAllocated,
        adjudicatorsAllocated,
      }),
    reviewTransfer: (transferId: string, decision: "approve" | "reject") =>
      call<{ transfer: SlotTransfer }>("/transfers", "POST", { transferId, decision }),
    addRepresentative: (input: Record<string, unknown>) =>
      call<{ representatives: RepresentativeSummary[]; link: IssuedRepresentativeLink }>("/representatives", "POST", input),
    resendRepresentative: (representativeId: string) =>
      call<{ representatives: RepresentativeSummary[]; link: IssuedRepresentativeLink }>("/representatives", "PATCH", {
        action: "resend",
        representativeId,
      }),
    revokeRepresentative: (representativeId: string) =>
      call<{ representatives: RepresentativeSummary[] }>("/representatives", "DELETE", { representativeId }),
  };
}
