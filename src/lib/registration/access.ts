import type { RegistrationSettings } from "@/lib/registration/types";

/**
 * Who may register what (Tabbycat `open_team_registration`, `open_adj_registration` and
 * `institution_participant_registration`; docs/registration.md, "Registration channels").
 *
 * Settings saved before the per-kind switches existed have only `representativesOnly`, which
 * applied to teams and adjudicators together; an absent switch reads exactly as before:
 * open registration = not representatives-only, representative links always register.
 */

export type ParticipantKind = "team" | "adjudicator";

export interface RegistrationChannels {
  /** On the public form without a link. */
  open: boolean;
  /** With an institution representative link. */
  representative: boolean;
}

type AccessSettings = Pick<
  RegistrationSettings,
  | "teamRegistration"
  | "adjudicatorRegistration"
  | "representativesOnly"
  | "openTeamRegistration"
  | "openAdjudicatorRegistration"
  | "institutionParticipantRegistration"
>;

export function openRegistration(settings: AccessSettings, kind: ParticipantKind): boolean {
  const explicit = kind === "team" ? settings.openTeamRegistration : settings.openAdjudicatorRegistration;
  return typeof explicit === "boolean" ? explicit : settings.representativesOnly !== true;
}

export function representativeRegistration(settings: AccessSettings): boolean {
  return settings.institutionParticipantRegistration !== false;
}

export function registrationChannels(settings: AccessSettings, kind: ParticipantKind): RegistrationChannels {
  const allowed = kind === "team" ? settings.teamRegistration !== false : settings.adjudicatorRegistration !== false;
  return {
    open: allowed && openRegistration(settings, kind),
    representative: allowed && representativeRegistration(settings),
  };
}

/**
 * Why a team or adjudicator registration is refused on this channel, or null when it is allowed.
 * `viaRepresentative`: the registrant holds a representative link.
 */
export function channelRefusal(settings: AccessSettings, kind: ParticipantKind, viaRepresentative: boolean): string | null {
  const channels = registrationChannels(settings, kind);
  if (viaRepresentative) {
    return channels.representative
      ? null
      : "Institution representatives cannot register teams or adjudicators for this tournament.";
  }
  if (channels.open) return null;
  return kind === "team"
    ? "Team registration is through institution representatives only. Use the link your representative received."
    : "Adjudicator registration is through institution representatives only. Use the link your representative received.";
}

/** Whether the person fields Tabbycat can switch off are asked (absent = asked, as before). */
export function askedPersonFields(settings: Pick<RegistrationSettings, "askSpeakerEmail" | "askSpeakerCategories" | "askAdjudicatorEmail">) {
  return {
    speakerEmail: settings.askSpeakerEmail !== false,
    speakerCategories: settings.askSpeakerCategories !== false,
    adjudicatorEmail: settings.askAdjudicatorEmail !== false,
  };
}

/** A team-name generator names registered teams, so the form does not ask for a name. */
export function teamNameGenerated(settings: Pick<RegistrationSettings, "teamNameGenerator">): boolean {
  return (settings.teamNameGenerator ?? "user") !== "user";
}
