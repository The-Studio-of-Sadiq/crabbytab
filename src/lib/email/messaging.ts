import { Adjudicator, Debate, Round, Team } from "@/types";
import type { EmailMessage, EmailProvider } from "@/lib/email/provider";

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
  team?: string;
  institution?: string;
  round?: string;
  debate?: string;
  venue?: string;
  chair?: string;
  panellists?: string;
}

export interface EmailCampaignResult {
  sent: number;
  failed: number;
  results: { email: string; sent: boolean }[];
}

export class EmailCampaignInputError extends Error {}

function debateVariables(
  debate: Debate | undefined,
  adjudicators: Adjudicator[]
): Pick<EmailRecipient, "debate" | "venue" | "chair" | "panellists"> {
  if (!debate) return {};
  const adjudicatorMap = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  return {
    debate: Object.values(debate.teams)
      .map((slot) => slot?.teamName)
      .filter(Boolean)
      .join(" vs "),
    venue: debate.venueName,
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
  round?: Round
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
          team: team.name,
          institution: team.institutionName,
          round: round?.name,
          ...debateVariables(teamDebate, adjudicators),
          ...(assignedTeamSlot?.pulledUp ? { team: `${team.name} (pulled up)` } : {}),
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
        institution: adjudicator.institutionName,
        round: round?.name,
        ...debateVariables(assignedDebate, adjudicators),
      });
    }
  }

  const unique = new Map<string, EmailRecipient>();
  for (const recipient of recipients) {
    const key = recipient.email.toLowerCase();
    if (!unique.has(key)) unique.set(key, recipient);
  }
  return [...unique.values()];
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
    chair: recipient.chair || "",
    panellists: recipient.panellists || "",
  };

  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (placeholder, variable: string) => {
    if (!(variable in variables)) {
      throw new EmailCampaignInputError(`Unknown email template variable: {{${variable}}}.`);
    }
    return variables[variable];
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

  const messages: EmailMessage[] = recipients.map((recipient) => {
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

  await provider.verifyConnection();
  const results: EmailCampaignResult["results"] = [];
  for (const message of messages) {
    try {
      await provider.send(message);
      results.push({ email: message.to, sent: true });
    } catch {
      results.push({ email: message.to, sent: false });
    }
  }

  return {
    sent: results.filter((result) => result.sent).length,
    failed: results.filter((result) => !result.sent).length,
    results,
  };
}
