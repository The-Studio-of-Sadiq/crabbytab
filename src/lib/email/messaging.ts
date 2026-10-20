import { Adjudicator, Debate, Round, Team, Venue } from "@/types";
import { safeVenueUrl } from "@/lib/venues/venues";
import type { EmailMessage, EmailProvider } from "@/lib/email/provider";
import { getAdjudicatorPrivatePath, getTeamPrivatePath } from "@/lib/privateUrls";

export const MAX_CAMPAIGN_RECIPIENTS = 100;

export const EMAIL_RECIPIENT_GROUPS = [
  "all_teams",
  "breaking_teams",
  "non_breaking_teams",
  "all_adjudicators",
  "checked_in_adjudicators",
  "trainees",
  "all_participants",
  "round_participants",
  "round_adjudicators",
  "chairs",
  "panellists",
] as const;

export type EmailRecipientGroup = (typeof EMAIL_RECIPIENT_GROUPS)[number];

export interface EmailRecipient {
  email: string;
  name: string;
  adjudicatorId?: string;
  /** Set for team speakers, so a retry can look the team's private credentials up again. */
  teamId?: string;
  team?: string;
  institution?: string;
  round?: string;
  debate?: string;
  venue?: string;
  /** The room's http(s) link (online meeting or map), for {{venue_url}}. */
  venueUrl?: string;
  chair?: string;
  panellists?: string;
  privateUrl?: string;
  passcode?: string;
  /** Automatic notifications: the recipient's side, round result, running points and ballot summary. */
  side?: string;
  result?: string;
  points?: string;
  ballot?: string;
}

export interface EmailCampaignResult {
  sent: number;
  failed: number;
  results: { email: string; sent: boolean; error?: string }[];
}

export class EmailCampaignInputError extends Error {}

export interface StoredEmailCampaign {
  id: string;
  tournamentId: string;
  createdAt: string;
  senderUid: string;
  senderEmail: string;
  senderName: string;
  recipientGroup: EmailRecipientGroup;
  roundId?: string;
  roundName?: string;
  subjectTemplate: string;
  bodyTemplate: string;
  status: "sending" | "completed" | "failed";
  sent: number;
  failed: number;
  results: EmailCampaignResult["results"];
  failedRecipients: EmailRecipient[];
  retryOf?: string;
  retriedBy?: string;
  retryInProgress?: boolean;
  /** Set when the campaign was sent automatically (draw release, results, ballot receipt). */
  notificationKey?: string;
}

function describeSendError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Email delivery failed.";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

function debateVariables(
  debate: Debate | undefined,
  adjudicators: Adjudicator[],
  venues: Array<Pick<Venue, "id" | "url">> = []
): Pick<EmailRecipient, "debate" | "venue" | "venueUrl" | "chair" | "panellists"> {
  if (!debate) return {};
  const venueUrl = safeVenueUrl(venues.find((venue) => venue.id === debate.venueId)?.url);
  const adjudicatorMap = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  return {
    debate: Object.values(debate.teams)
      .map((slot) => slot?.teamName)
      .filter(Boolean)
      .join(" vs "),
    venue: debate.venueName,
    ...(venueUrl ? { venueUrl } : {}),
    chair: debate.adjudicators.chairName ||
      adjudicatorMap.get(debate.adjudicators.chairId || "")?.name,
    panellists: debate.adjudicators.panellistNames
      .map((name, index) =>
        name || adjudicatorMap.get(debate.adjudicators.panellistIds[index])?.name
      )
      .filter(Boolean)
      .join(", "),
  };
}

export function resolveEmailRecipients(
  group: EmailRecipientGroup,
  teams: Team[],
  adjudicators: Adjudicator[],
  debates: Debate[],
  round?: Round,
  options: {
    /** Fill {{private_url}} / {{passcode}} with each adjudicator's or team's own credentials. */
    includePrivateCredentials?: boolean;
    privateUrlOrigin?: string;
    tournamentSlug?: string;
    preserveDuplicateEmails?: boolean;
    /** Rooms, so {{venue_url}} can carry each debate's room link. */
    venues?: Array<Pick<Venue, "id" | "url">>;
  } = {}
): EmailRecipient[] {
  const roundDebates = round ? debates.filter((debate) => debate.roundId === round.id) : [];
  const roundTeamIds = new Set(
    roundDebates.flatMap((debate) =>
      Object.values(debate.teams).map((slot) => slot?.teamId).filter(Boolean)
    )
  );
  const adjudicatorRoles = new Map<string, Set<"chair" | "panellist" | "trainee">>();
  for (const debate of roundDebates) {
    const chairId = debate.adjudicators.chairId;
    if (chairId) {
      const roles = adjudicatorRoles.get(chairId) ?? new Set();
      roles.add("chair");
      adjudicatorRoles.set(chairId, roles);
    }
    for (const panellistId of debate.adjudicators.panellistIds || []) {
      const roles = adjudicatorRoles.get(panellistId) ?? new Set();
      roles.add("panellist");
      adjudicatorRoles.set(panellistId, roles);
    }
    for (const traineeId of debate.adjudicators.traineeIds || []) {
      const roles = adjudicatorRoles.get(traineeId) ?? new Set();
      roles.add("trainee");
      adjudicatorRoles.set(traineeId, roles);
    }
  }

  const recipients: EmailRecipient[] = [];
  const addRecipient = (recipient: EmailRecipient) => {
    const email = recipient.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    recipients.push({ ...recipient, email });
  };

  const teamMatches = (team: Team) => {
    if (group === "round_participants") return Boolean(round && roundTeamIds.has(team.id));
    if (group === "breaking_teams") return team.breakStatus === "breaking";
    if (group === "non_breaking_teams") return team.breakStatus !== "breaking";
    return group === "all_teams" || group === "all_participants";
  };

  if (
    group === "all_teams" ||
    group === "breaking_teams" ||
    group === "non_breaking_teams" ||
    group === "round_participants" ||
    group === "all_participants"
  ) {
    for (const team of teams) {
      if (!teamMatches(team)) continue;
      const teamDebate = roundDebates.find((debate) =>
        Object.values(debate.teams).some((slot) => slot?.teamId === team.id)
      );
      const assignedTeamSlot = teamDebate &&
        Object.values(teamDebate.teams).find((slot) => slot?.teamId === team.id);
      for (const speaker of team.speakers || []) {
        if (!speaker.email?.trim()) continue;
        addRecipient({
          email: speaker.email,
          name: speaker.name,
          teamId: team.id,
          team: team.name,
          institution: team.institutionName,
          round: round?.name,
          ...debateVariables(teamDebate, adjudicators, options.venues),
          ...(assignedTeamSlot?.pulledUp ? { team: `${team.name} (pulled up)` } : {}),
          ...(options.includePrivateCredentials
            ? privateCredentials("team", team.privateUrlKey, team.privatePasscode, options)
            : {}),
        });
      }
    }
  }

  const adjMatches = (adjudicator: Adjudicator) => {
    if (group === "round_adjudicators") return adjudicatorRoles.has(adjudicator.id);
    if (group === "chairs") return adjudicatorRoles.get(adjudicator.id)?.has("chair") ?? false;
    if (group === "panellists") return adjudicatorRoles.get(adjudicator.id)?.has("panellist") ?? false;
    if (group === "checked_in_adjudicators") return adjudicator.checkedIn !== false;
    if (group === "trainees") return adjudicator.trainee;
    return group === "all_adjudicators" || group === "all_participants";
  };

  if (
    group === "all_adjudicators" ||
    group === "checked_in_adjudicators" ||
    group === "trainees" ||
    group === "round_adjudicators" ||
    group === "chairs" ||
    group === "panellists" ||
    group === "all_participants"
  ) {
    for (const adjudicator of adjudicators) {
      if (!adjudicator.email?.trim() || !adjMatches(adjudicator)) continue;
      const assignedDebate = roundDebates.find((debate) =>
        debate.adjudicators.chairId === adjudicator.id ||
          (debate.adjudicators.panellistIds || []).includes(adjudicator.id) ||
          (debate.adjudicators.traineeIds || []).includes(adjudicator.id)
      );
      addRecipient({
        email: adjudicator.email,
        name: adjudicator.name,
        adjudicatorId: adjudicator.id,
        institution: adjudicator.institutionName,
        round: round?.name,
        ...debateVariables(assignedDebate, adjudicators, options.venues),
        ...(options.includePrivateCredentials
          ? privateCredentials("adjudicator", adjudicator.privateUrlKey, adjudicator.privatePasscode, options)
          : {}),
      });
    }
  }

  // With credentials, an address shared by two participants is kept twice (with different links) so
  // findCredentialEmailConflict can refuse the send; speakers of one team share one link.
  const unique = new Map<string, EmailRecipient>();
  for (const recipient of recipients) {
    const email = recipient.email.toLowerCase();
    const key = options.preserveDuplicateEmails ? `${email}
${recipient.privateUrl ?? ""}` : email;
    if (!unique.has(key)) unique.set(key, recipient);
  }
  return [...unique.values()];
}

/** The private portal link and passcode for one participant. */
export function privateCredentials(
  type: "adjudicator" | "team",
  privateUrlKey: string | undefined,
  passcode: string | undefined,
  options: { privateUrlOrigin?: string; tournamentSlug?: string }
): Pick<EmailRecipient, "privateUrl" | "passcode"> {
  const path = privateUrlKey && options.tournamentSlug
    ? type === "adjudicator"
      ? getAdjudicatorPrivatePath(options.tournamentSlug, privateUrlKey)
      : getTeamPrivatePath(options.tournamentSlug, privateUrlKey)
    : "";
  return {
    privateUrl: path && options.privateUrlOrigin ? new URL(path, options.privateUrlOrigin).toString() : "",
    passcode: passcode || "",
  };
}

/**
 * An email address that would receive two different private links (for example a speaker
 * registered in two teams), or null. Such sends are refused so nobody gets another person's portal.
 */
export function findCredentialEmailConflict(recipients: EmailRecipient[]): string | null {
  const linkByEmail = new Map<string, string>();
  for (const recipient of recipients) {
    const email = recipient.email.toLowerCase();
    const link = recipient.privateUrl ?? "";
    const previous = linkByEmail.get(email);
    if (previous !== undefined && previous !== link) return recipient.email;
    linkByEmail.set(email, link);
  }
  return null;
}

export function usesPrivateCredentials(subject: string, body: string): boolean {
  return templateUsesVariable(`${subject}\n${body}`, "private_url") ||
    templateUsesVariable(`${subject}\n${body}`, "passcode");
}

function templateUsesVariable(template: string, variable: string): boolean {
  return new RegExp(`\\{\\{\\s*${variable}\\s*\\}\\}`).test(template);
}

export function renderEmailTemplate(
  template: string,
  recipient: EmailRecipient,
  tournamentName: string,
  roundName?: string
): string {
  const variables: Record<string, string> = {
    name: recipient.name,
    email: recipient.email,
    tournament: tournamentName,
    team: recipient.team || "",
    institution: recipient.institution || "",
    round: recipient.round || roundName || "",
    debate: recipient.debate || "",
    venue: recipient.venue || "",
    venue_url: recipient.venueUrl || "",
    chair: recipient.chair || "",
    panellists: recipient.panellists || "",
    private_url: recipient.privateUrl || "",
    passcode: recipient.passcode || "",
    side: recipient.side || "",
    result: recipient.result || "",
    points: recipient.points || "",
    ballot: recipient.ballot || "",
  };

  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (placeholder, variable: string) => {
    if (!(variable in variables)) {
      throw new EmailCampaignInputError(`Unknown email template variable: {{${variable}}}.`);
    }
    return variables[variable];
  });
}

export function prepareEmailMessages(
  recipients: EmailRecipient[],
  tournamentName: string,
  roundName: string | undefined,
  subjectTemplate: string,
  bodyTemplate: string
): EmailMessage[] {
  if (recipients.length === 0) {
    throw new EmailCampaignInputError("No recipients with email addresses were found.");
  }
  if (recipients.length > MAX_CAMPAIGN_RECIPIENTS) {
    throw new EmailCampaignInputError(
      `This send is limited to ${MAX_CAMPAIGN_RECIPIENTS} unique recipients.`
    );
  }
  if (!subjectTemplate.trim() || subjectTemplate.length > 200) {
    throw new EmailCampaignInputError("Subject is required and must be 200 characters or fewer.");
  }
  if (!bodyTemplate.trim() || bodyTemplate.length > 20_000) {
    throw new EmailCampaignInputError("Message is required and must be 20,000 characters or fewer.");
  }
  for (const recipient of recipients) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)) {
      throw new EmailCampaignInputError(
        `The recipient address "${recipient.email}" is not a valid email address.`
      );
    }
  }

  const needsPrivateUrl =
    templateUsesVariable(subjectTemplate, "private_url") ||
    templateUsesVariable(bodyTemplate, "private_url");
  const needsPasscode =
    templateUsesVariable(subjectTemplate, "passcode") ||
    templateUsesVariable(bodyTemplate, "passcode");
  if (needsPrivateUrl || needsPasscode) {
    for (const recipient of recipients) {
      if (
        needsPrivateUrl && !recipient.privateUrl
      ) {
        throw new EmailCampaignInputError(
          `A private URL is missing for ${recipient.name}. Generate private URLs and try again.`
        );
      }
      if (
        needsPasscode && !recipient.passcode
      ) {
        throw new EmailCampaignInputError(
          `A passcode is missing for ${recipient.name}. Generate private URLs and try again.`
        );
      }
    }
  }

  return recipients.map((recipient) => {
    const subject = renderEmailTemplate(subjectTemplate, recipient, tournamentName, roundName);
    if (subject.length > 200 || /[\r\n]/.test(subject)) {
      throw new EmailCampaignInputError(
        "Rendered email subjects must be 200 characters or fewer and contain no line breaks."
      );
    }
    return {
      to: recipient.email,
      subject,
      text: renderEmailTemplate(bodyTemplate, recipient, tournamentName, roundName),
    };
  });
}

export async function sendEmailCampaign(
  provider: EmailProvider,
  recipients: EmailRecipient[],
  tournamentName: string,
  roundName: string | undefined,
  subjectTemplate: string,
  bodyTemplate: string
): Promise<EmailCampaignResult> {
  const messages = prepareEmailMessages(
    recipients,
    tournamentName,
    roundName,
    subjectTemplate,
    bodyTemplate
  );

  const results: EmailCampaignResult["results"] = [];
  try {
    await provider.verifyConnection();
  } catch (error) {
    const description = describeSendError(error);
    return {
      sent: 0,
      failed: messages.length,
      results: messages.map((message) => ({
        email: message.to,
        sent: false,
        error: description,
      })),
    };
  }

  for (const message of messages) {
    try {
      await provider.send(message);
      results.push({ email: message.to, sent: true });
    } catch (error) {
      results.push({ email: message.to, sent: false, error: describeSendError(error) });
    }
  }

  return {
    sent: results.filter((result) => result.sent).length,
    failed: results.filter((result) => !result.sent).length,
    results,
  };
}
