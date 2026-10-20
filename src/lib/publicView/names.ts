import type { Adjudicator, Team } from "@/types";
import { publicUsesTeamCodeNames, type PublicSiteSettings } from "@/lib/publicFeatures";
import { hasCodeName } from "@/lib/codeNames";

/**
 * Public names of teams, speakers and adjudicators under the anonymity and code-name settings.
 * The projection rewrites every name it publishes through this, so a hidden real name never leaves
 * the server:
 * - team code names (any mode but "off" / "all-tooltips"): the team is published under its code
 *   name; a team without one is published with an empty name (pages show a placeholder);
 * - participant code names "everywhere": speakers and adjudicators likewise;
 * - anonymous speakers and adjudicators (Tabbycat Person.anonymous): an empty name and
 *   `anonymous: true`; pages show "Redacted".
 * Unknown ids keep the stored name (e.g. a deleted adjudicator still named on an old panel).
 */
export interface PublicNamer {
  team(teamId: string | undefined, storedName?: string): string;
  speaker(speakerId: string | undefined, storedName?: string): string;
  isSpeakerAnonymous(speakerId: string | undefined): boolean;
  adjudicator(adjudicatorId: string | undefined, storedName?: string): string;
  isAdjudicatorAnonymous(adjudicatorId: string | undefined): boolean;
}

type NamedTeam = Pick<Team, "id" | "name" | "codeName" | "speakers">;
type NamedAdjudicator = Pick<Adjudicator, "id" | "name" | "codeName" | "anonymous">;

export function createPublicNamer(
  teams: NamedTeam[],
  adjudicators: NamedAdjudicator[],
  settings: Pick<PublicSiteSettings, "teamCodeNames" | "participantCodeNames">
): PublicNamer {
  const teamCodes = publicUsesTeamCodeNames(settings.teamCodeNames);
  const participantCodes = settings.participantCodeNames === "everywhere";
  const teamNames = new Map<string, string>();
  const speakers = new Map<string, { name: string; anonymous: boolean }>();
  for (const team of teams) {
    // Older versions stored the team name as its code name; that is no code name.
    teamNames.set(team.id, teamCodes ? (hasCodeName(team) ? team.codeName!.trim() : "") : team.name);
    for (const speaker of Array.isArray(team.speakers) ? team.speakers : []) {
      if (!speaker?.id) continue;
      const anonymous = speaker.anonymous === true;
      speakers.set(speaker.id, {
        anonymous,
        name: anonymous ? "" : participantCodes ? speaker.codeName?.trim() || "" : speaker.name,
      });
    }
  }
  const adjudicatorNames = new Map<string, { name: string; anonymous: boolean }>();
  for (const adjudicator of adjudicators) {
    const anonymous = adjudicator.anonymous === true;
    adjudicatorNames.set(adjudicator.id, {
      anonymous,
      name: anonymous ? "" : participantCodes ? adjudicator.codeName?.trim() || "" : adjudicator.name,
    });
  }
  return {
    team: (teamId, storedName = "") => (teamId !== undefined && teamNames.has(teamId) ? teamNames.get(teamId)! : storedName),
    speaker: (speakerId, storedName = "") =>
      speakerId !== undefined && speakers.has(speakerId) ? speakers.get(speakerId)!.name : storedName,
    isSpeakerAnonymous: (speakerId) => speakerId !== undefined && speakers.get(speakerId)?.anonymous === true,
    adjudicator: (adjudicatorId, storedName = "") =>
      adjudicatorId !== undefined && adjudicatorNames.has(adjudicatorId) ? adjudicatorNames.get(adjudicatorId)!.name : storedName,
    isAdjudicatorAnonymous: (adjudicatorId) =>
      adjudicatorId !== undefined && adjudicatorNames.get(adjudicatorId)?.anonymous === true,
  };
}

/** Rewrites the names on a published debate panel. */
export function renamePanel<T extends {
  chairId?: string;
  chairName?: string;
  panellistIds?: string[];
  panellistNames?: string[];
  traineeIds?: string[];
  traineeNames?: string[];
}>(panel: T, namer: PublicNamer): T {
  const names = (ids: string[] | undefined, stored: string[] | undefined) =>
    (ids ?? []).map((id, index) => namer.adjudicator(id, stored?.[index] ?? ""));
  return {
    ...panel,
    ...(panel.chairId !== undefined || panel.chairName !== undefined
      ? { chairName: namer.adjudicator(panel.chairId, panel.chairName ?? "") }
      : {}),
    panellistNames: names(panel.panellistIds, panel.panellistNames),
    traineeNames: names(panel.traineeIds, panel.traineeNames),
  };
}
