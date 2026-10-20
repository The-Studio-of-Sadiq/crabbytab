import type { Adjudicator, AdjudicatorConflict, Institution, Speaker, Team } from "@/types";
import { institutionKey } from "@/lib/registration/validation";
import type { RegistrationSubmission } from "@/lib/registration/types";

/**
 * Review-queue helpers that run on the administrator's device: duplicate flags against the
 * tournament's current teams and adjudicators and against other submissions, and the records an
 * approval creates through the ordinary entity commands (which add private URL keys and write
 * live for cloud tournaments).
 */

export interface DuplicateFlag {
  against: "team" | "adjudicator" | "submission";
  id: string;
  name: string;
  reason: "same_name" | "same_email" | "same_speaker";
}

function nameKey(name: string | undefined): string {
  return (name ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function emailKey(email: string | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function isActive(submission: RegistrationSubmission): boolean {
  return submission.status !== "rejected";
}

/** Possible duplicates for each submission that is still open (pending or being approved). */
export function findRegistrationDuplicates(
  submissions: RegistrationSubmission[],
  teams: Pick<Team, "id" | "name" | "speakers">[],
  adjudicators: Pick<Adjudicator, "id" | "name" | "email">[]
): Map<string, DuplicateFlag[]> {
  const teamsByName = new Map<string, Pick<Team, "id" | "name">[]>();
  const teamsBySpeakerEmail = new Map<string, Pick<Team, "id" | "name">>();
  for (const team of teams) {
    const key = nameKey(team.name);
    teamsByName.set(key, [...(teamsByName.get(key) ?? []), team]);
    for (const speaker of team.speakers) if (speaker.email) teamsBySpeakerEmail.set(emailKey(speaker.email), team);
  }
  const adjudicatorsByName = new Map<string, Pick<Adjudicator, "id" | "name">[]>();
  const adjudicatorsByEmail = new Map<string, Pick<Adjudicator, "id" | "name">>();
  for (const adjudicator of adjudicators) {
    const key = nameKey(adjudicator.name);
    adjudicatorsByName.set(key, [...(adjudicatorsByName.get(key) ?? []), adjudicator]);
    if (adjudicator.email) adjudicatorsByEmail.set(emailKey(adjudicator.email), adjudicator);
  }

  const flags = new Map<string, DuplicateFlag[]>();
  const active = submissions.filter(isActive);
  for (const submission of active) {
    if (submission.status === "approved") continue;
    const found: DuplicateFlag[] = [];
    const add = (flag: DuplicateFlag) => {
      if (!found.some((item) => item.against === flag.against && item.id === flag.id && item.reason === flag.reason)) found.push(flag);
    };
    if (submission.kind === "team" && submission.team) {
      const key = nameKey(submission.team.name);
      for (const team of teamsByName.get(key) ?? []) add({ against: "team", id: team.id, name: team.name, reason: "same_name" });
      const emails = submission.team.speakers.map((speaker) => emailKey(speaker.email)).filter(Boolean);
      for (const email of emails) {
        const team = teamsBySpeakerEmail.get(email);
        if (team) add({ against: "team", id: team.id, name: team.name, reason: "same_speaker" });
      }
      for (const other of active) {
        if (other.id === submission.id || other.kind !== "team" || !other.team || other.status === "approved") continue;
        if (nameKey(other.team.name) === key) add({ against: "submission", id: other.id, name: other.team.name, reason: "same_name" });
        const otherEmails = new Set(other.team.speakers.map((speaker) => emailKey(speaker.email)).filter(Boolean));
        if (emails.some((email) => otherEmails.has(email))) {
          add({ against: "submission", id: other.id, name: other.team.name, reason: "same_speaker" });
        }
      }
    } else if (submission.kind === "adjudicator" && submission.adjudicator) {
      const key = nameKey(submission.adjudicator.name);
      const email = emailKey(submission.adjudicator.email);
      for (const adjudicator of adjudicatorsByName.get(key) ?? []) {
        add({ against: "adjudicator", id: adjudicator.id, name: adjudicator.name, reason: "same_name" });
      }
      const byEmail = adjudicatorsByEmail.get(email);
      if (byEmail) add({ against: "adjudicator", id: byEmail.id, name: byEmail.name, reason: "same_email" });
      for (const other of active) {
        if (other.id === submission.id || other.kind !== "adjudicator" || !other.adjudicator || other.status === "approved") continue;
        if (nameKey(other.adjudicator.name) === key) {
          add({ against: "submission", id: other.id, name: other.adjudicator.name, reason: "same_name" });
        }
        if (emailKey(other.adjudicator.email) === email) {
          add({ against: "submission", id: other.id, name: other.adjudicator.name, reason: "same_email" });
        }
      }
    }
    if (found.length > 0) flags.set(submission.id, found);
  }
  return flags;
}

/** The tournament institution a registration names, matched by normalized name or code. */
export function matchInstitution(
  name: string,
  institutions: Pick<Institution, "id" | "name" | "code">[]
): Pick<Institution, "id" | "name" | "code"> | undefined {
  const key = institutionKey(name);
  return institutions.find((institution) => institutionKey(institution.name) === key) ??
    institutions.find((institution) => institution.code && institutionKey(institution.code) === key);
}

/** A short, unique-enough institution code for an institution created from a registration. */
export function suggestInstitutionCode(name: string, existingCodes: string[]): string {
  const words = name.normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const base = (words.length > 1 ? words.map((word) => word[0]).join("") : (words[0] ?? "INST").slice(0, 4))
    .toUpperCase()
    .slice(0, 6) || "INST";
  const taken = new Set(existingCodes.map((code) => code.toUpperCase()));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    if (!taken.has(`${base}${suffix}`)) return `${base}${suffix}`;
  }
}

export function buildTeamFromSubmission(
  submission: RegistrationSubmission,
  institution: Pick<Institution, "id" | "name"> | undefined,
  createId: (prefix: string) => string
): Omit<Team, "id" | "tournamentId"> {
  if (submission.kind !== "team" || !submission.team) throw new Error("This submission is not a team registration.");
  const speakers: Speaker[] = submission.team.speakers.map((speaker) => {
    const record: Speaker = { id: createId("spk"), name: speaker.name };
    if (speaker.email) record.email = speaker.email;
    // Registration fields map onto the real person fields (diversity, contact).
    if (speaker.phone) record.phone = speaker.phone;
    if (speaker.gender) record.gender = speaker.gender;
    if (speaker.categories.length > 0) record.categories = [...speaker.categories];
    return record;
  });
  const team: Omit<Team, "id" | "tournamentId"> = {
    name: submission.team.name,
    speakers,
    breakCategories: [],
    speakerCategories: [],
  };
  if (institution) {
    team.institutionId = institution.id;
    team.institutionName = institution.name;
  }
  return team;
}

/**
 * The adjudicator an approval creates. Declared institution conflicts become institution
 * conflicts where the institution exists; team conflicts become personal conflicts where a team
 * of that name exists. Declarations that match nothing are returned so the reviewer sees them.
 */
export function buildAdjudicatorFromSubmission(
  submission: RegistrationSubmission,
  context: {
    institution: Pick<Institution, "id" | "name"> | undefined;
    institutions: Pick<Institution, "id" | "name" | "code">[];
    teams: Pick<Team, "id" | "name">[];
    baseScore: number;
  }
): { adjudicator: Omit<Adjudicator, "id" | "tournamentId">; unmatchedConflicts: string[] } {
  if (submission.kind !== "adjudicator" || !submission.adjudicator) {
    throw new Error("This submission is not an adjudicator registration.");
  }
  const conflicts: AdjudicatorConflict[] = [];
  const unmatched: string[] = [];
  for (const name of submission.adjudicator.institutionConflicts) {
    const match = matchInstitution(name, context.institutions);
    if (match && match.id !== context.institution?.id) {
      if (!conflicts.some((conflict) => conflict.institutionId === match.id)) conflicts.push({ type: "institution", institutionId: match.id });
    } else if (!match) {
      unmatched.push(name);
    }
  }
  for (const name of submission.adjudicator.teamConflicts) {
    const key = nameKey(name);
    const team = context.teams.find((item) => nameKey(item.name) === key);
    if (team) {
      if (!conflicts.some((conflict) => conflict.teamId === team.id)) conflicts.push({ type: "personal", teamId: team.id });
    } else {
      unmatched.push(name);
    }
  }
  const adjudicator: Omit<Adjudicator, "id" | "tournamentId"> = {
    name: submission.adjudicator.name,
    email: submission.adjudicator.email,
    baseScore: context.baseScore,
    trainee: false,
    independent: !context.institution,
    conflicts,
  };
  if (context.institution) {
    adjudicator.institutionId = context.institution.id;
    adjudicator.institutionName = context.institution.name;
  }
  if (submission.adjudicator.phone) adjudicator.phone = submission.adjudicator.phone;
  if (submission.adjudicator.gender) adjudicator.gender = submission.adjudicator.gender;
  return { adjudicator, unmatchedConflicts: unmatched };
}
