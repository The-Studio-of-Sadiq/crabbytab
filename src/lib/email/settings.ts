import type { DocumentReference } from "firebase-admin/firestore";
import { normalizeEmail } from "@/lib/emailAddress";
import { EmailCampaignInputError, renderEmailTemplate, type EmailRecipient } from "@/lib/email/messaging";

/**
 * Per-tournament email settings (roadmap #21; docs/email-notifications.md): the Reply-To name and
 * address, and a saved, editable template for every automatic email. Stored in the server-only
 * document `tournaments/{id}/serverOnly/emailSettings`, read and written only through
 * `/api/tournaments/{id}/email/settings`, so a change applies to the next email at once.
 */

export const TEMPLATE_EVENTS = [
  "draw_teams",
  "draw_adjudicators",
  "team_points",
  "ballot_receipt",
  "ballot_confirmed",
  "motions_released",
  "private_url",
  "feedback_url",
  "registration_received",
  "registration_approved",
  "slots_allocated",
] as const;
export type TemplateEvent = (typeof TEMPLATE_EVENTS)[number];

export interface EmailTemplate {
  subject: string;
  body: string;
}

export interface TournamentEmailSettings {
  replyToName: string;
  replyToAddress: string;
  /** Email registrants when their registration is received and when it is approved. */
  registrationEmails: boolean;
  templates: Partial<Record<TemplateEvent, EmailTemplate>>;
  updatedAt?: string;
  updatedBy?: string;
}

export const TEMPLATE_EVENT_INFO: Record<TemplateEvent, { label: string; when: string; variables: string[] }> = {
  draw_teams: {
    label: "Draw released (teams)",
    when: "Each team's speakers, once the draw is confirmed or released.",
    variables: ["team", "side", "debate", "venue", "chair", "panellists"],
  },
  draw_adjudicators: {
    label: "Draw released (adjudicators)",
    when: "Each adjudicator on a panel, once panels are revealed.",
    variables: ["debate", "venue", "chair", "panellists"],
  },
  team_points: {
    label: "Team results",
    when: "Each team's speakers, once a round's results are released.",
    variables: ["team", "side", "result", "points"],
  },
  ballot_receipt: {
    label: "Ballot receipt",
    when: "The adjudicator who submitted a ballot through their private URL.",
    variables: ["debate", "venue", "ballot"],
  },
  ballot_confirmed: {
    label: "Ballot confirmed",
    when: "The debate's adjudicators, when the tab room confirms its result.",
    variables: ["debate", "venue", "ballot"],
  },
  motions_released: {
    label: "Motions released",
    when: "Speakers and adjudicators in the round, once its motions are released.",
    variables: ["motions", "debate", "venue"],
  },
  private_url: {
    label: "Private URL (landing page)",
    when: "Sent from the compose form to teams or adjudicators.",
    variables: ["team", "private_url", "passcode"],
  },
  feedback_url: {
    label: "Feedback URL",
    when: "Sent from the compose form to teams or adjudicators.",
    variables: ["team", "private_url", "passcode"],
  },
  registration_received: {
    label: "Registration received",
    when: "The registrant's contact address, when a registration is submitted.",
    variables: ["entry", "institution"],
  },
  registration_approved: {
    label: "Registration approved",
    when: "The registrant's contact address, when the tab room approves it.",
    variables: ["entry", "institution"],
  },
  slots_allocated: {
    label: "Places allocated",
    when: "An institution representative, when their link is sent with team or adjudicator places.",
    variables: ["institution", "teams_allocated", "adjudicators_allocated", "url"],
  },
};

export const DEFAULT_EMAIL_TEMPLATES: Record<TemplateEvent, EmailTemplate> = {
  draw_teams: {
    subject: "{{tournament}} — {{round}} draw",
    body:
      "Hi {{name}},\n\nThe draw for {{round}} has been released.\n\nTeam: {{team}}\nSide: {{side}}\nDebate: {{debate}}\nVenue: {{venue}}\nChair: {{chair}}\n\nGood luck!\nTournament Staff",
  },
  draw_adjudicators: {
    subject: "{{tournament}} — {{round}} adjudicator allocation",
    body:
      "Hi {{name}},\n\nYour allocation for {{round}}:\n\nDebate: {{debate}}\nVenue: {{venue}}\nChair: {{chair}}\nPanellists: {{panellists}}\n\nThank you,\nTournament Staff",
  },
  team_points: {
    subject: "{{tournament}} — {{round}} result for {{team}}",
    body:
      "Hi {{name}},\n\nResults for {{round}} have been released.\n\nTeam: {{team}}\nResult: {{result}}\nTeam points after released rounds: {{points}}\n\nTournament Staff",
  },
  ballot_receipt: {
    subject: "{{tournament}} — ballot received for {{round}}",
    body:
      "Hi {{name}},\n\nWe received your ballot for {{debate}} ({{round}}, {{venue}}).\n\n{{ballot}}\n\nIf this is not what you submitted, contact the tab room straight away.\n\nTournament Staff",
  },
  ballot_confirmed: {
    subject: "{{tournament}} — result confirmed for {{debate}}",
    body:
      "Hi {{name}},\n\nThe tab room has confirmed the result of {{debate}} ({{round}}, {{venue}}):\n\n{{ballot}}\n\nIf this does not match your decision, contact the tab room straight away.\n\nTournament Staff",
  },
  motions_released: {
    subject: "{{tournament}} — motions for {{round}}",
    body: "Hi {{name}},\n\nThe motion(s) for {{round}}:\n\n{{motions}}\n\nVenue: {{venue}}\n\nGood luck!\nTournament Staff",
  },
  private_url: {
    subject: "{{tournament}} — your private URL",
    body:
      "Hi {{name}},\n\nThis is your personal page for {{tournament}}: your draws, check-in, ballots and feedback.\n\nPrivate link: {{private_url}}\nPasscode: {{passcode}}\n\nKeep these details private.\n\nTournament Staff",
  },
  feedback_url: {
    subject: "{{tournament}} — submit your feedback",
    body:
      "Hi {{name}},\n\nPlease submit your adjudicator feedback for {{tournament}} from your private page.\n\nPrivate link: {{private_url}}\nPasscode: {{passcode}}\n\nThank you,\nTournament Staff",
  },
  registration_received: {
    subject: "{{tournament}} — registration received",
    body:
      "Hi {{name}},\n\nWe received the registration of {{entry}}. The tab room will review it; you will hear from us if anything is missing.\n\nTournament Staff",
  },
  registration_approved: {
    subject: "{{tournament}} — registration confirmed",
    body: "Hi {{name}},\n\nThe registration of {{entry}} is confirmed. See you at {{tournament}}!\n\nTournament Staff",
  },
  slots_allocated: {
    subject: "{{tournament}} — places for {{institution}}",
    body:
      "Hi {{name}},\n\n{{institution}} has {{teams_allocated}} team place(s) and {{adjudicators_allocated}} adjudicator place(s) at {{tournament}}.\n\nRegister your teams and adjudicators with your personal link:\n{{url}}\n\nKeep the link private: anyone with it can register entries for your institution.\n\nTournament Staff",
  },
};

export function defaultEmailSettings(): TournamentEmailSettings {
  return { replyToName: "", replyToAddress: "", registrationEmails: false, templates: {} };
}

/** Reads a stored settings document; anything malformed falls back to the defaults. */
export function readEmailSettings(value: unknown): TournamentEmailSettings {
  const record = (value ?? {}) as Record<string, unknown>;
  const templates: TournamentEmailSettings["templates"] = {};
  const stored = (record.templates ?? {}) as Record<string, unknown>;
  for (const event of TEMPLATE_EVENTS) {
    const template = stored[event] as Partial<EmailTemplate> | undefined;
    if (typeof template?.subject === "string" && typeof template.body === "string") {
      templates[event] = { subject: template.subject, body: template.body };
    }
  }
  return {
    replyToName: typeof record.replyToName === "string" ? record.replyToName : "",
    replyToAddress: typeof record.replyToAddress === "string" ? record.replyToAddress : "",
    registrationEmails: record.registrationEmails === true,
    templates,
    ...(typeof record.updatedAt === "string" ? { updatedAt: record.updatedAt } : {}),
    ...(typeof record.updatedBy === "string" ? { updatedBy: record.updatedBy } : {}),
  };
}

/** The template used for an event: the tournament's saved one, else the default. */
export function templateFor(settings: TournamentEmailSettings | null | undefined, event: TemplateEvent): EmailTemplate {
  return settings?.templates[event] ?? DEFAULT_EMAIL_TEMPLATES[event];
}

/** A sample recipient filling every variable, used to check templates before they are saved. */
const SAMPLE_RECIPIENT: EmailRecipient = {
  email: "sample@example.com",
  name: "Sample",
  team: "Team",
  institution: "Institution",
  round: "Round 1",
  debate: "A vs B",
  venue: "Room 1",
  chair: "Chair",
  panellists: "Panellist",
  privateUrl: "https://example.com/p",
  passcode: "code",
  side: "Gov",
  result: "Win",
  points: "1",
  ballot: "Ballot",
  motions: "Motion",
  entry: "Entry",
  url: "https://example.com/r",
  teamsAllocated: "2",
  adjudicatorsAllocated: "1",
};

/** Validates settings an administrator saves. Throws EmailCampaignInputError. */
export function parseEmailSettings(input: unknown): Omit<TournamentEmailSettings, "updatedAt" | "updatedBy"> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new EmailCampaignInputError("Invalid email settings.");
  const record = input as Record<string, unknown>;
  const replyToName = typeof record.replyToName === "string" ? record.replyToName.replace(/[\r\n"<>]+/g, " ").replace(/\s+/g, " ").trim() : "";
  if (replyToName.length > 100) throw new EmailCampaignInputError("The Reply-To name must be at most 100 characters.");
  const rawAddress = typeof record.replyToAddress === "string" ? record.replyToAddress.trim() : "";
  const replyToAddress = rawAddress ? normalizeEmail(rawAddress) : "";
  if (replyToAddress === null) throw new EmailCampaignInputError("Enter a valid Reply-To email address, or leave it empty.");
  if (replyToName && !replyToAddress) throw new EmailCampaignInputError("Add a Reply-To address for the Reply-To name.");
  const templates: TournamentEmailSettings["templates"] = {};
  const submitted = (record.templates ?? {}) as Record<string, unknown>;
  if (typeof submitted !== "object" || Array.isArray(submitted)) throw new EmailCampaignInputError("Invalid templates.");
  for (const [event, value] of Object.entries(submitted)) {
    if (!(TEMPLATE_EVENTS as readonly string[]).includes(event)) throw new EmailCampaignInputError(`Unknown email event: ${event}.`);
    if (value === null || value === undefined) continue;
    const template = value as Partial<EmailTemplate>;
    const label = TEMPLATE_EVENT_INFO[event as TemplateEvent].label;
    if (typeof template.subject !== "string" || typeof template.body !== "string") {
      throw new EmailCampaignInputError(`${label}: enter a subject and a message.`);
    }
    const subject = template.subject.trim();
    const body = template.body.replace(/\r\n/g, "\n");
    if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) {
      throw new EmailCampaignInputError(`${label}: the subject is required, on one line, and at most 200 characters.`);
    }
    if (!body.trim() || body.length > 20_000) throw new EmailCampaignInputError(`${label}: the message is required and at most 20,000 characters.`);
    // Throws on an unknown {{variable}}.
    renderEmailTemplate(subject, SAMPLE_RECIPIENT, "Tournament", "Round 1");
    renderEmailTemplate(body, SAMPLE_RECIPIENT, "Tournament", "Round 1");
    const defaults = DEFAULT_EMAIL_TEMPLATES[event as TemplateEvent];
    // Saving the default text again stores nothing, so later default improvements still apply.
    if (subject !== defaults.subject || body !== defaults.body) templates[event as TemplateEvent] = { subject, body };
  }
  return { replyToName, replyToAddress: replyToAddress ?? "", registrationEmails: record.registrationEmails === true, templates };
}

/** The Reply-To header value, or undefined when none is set. */
export function replyToHeader(settings: Pick<TournamentEmailSettings, "replyToName" | "replyToAddress"> | null | undefined): string | undefined {
  if (!settings?.replyToAddress) return undefined;
  return settings.replyToName ? `"${settings.replyToName}" <${settings.replyToAddress}>` : settings.replyToAddress;
}

export function emailSettingsRef(tournamentRef: DocumentReference): DocumentReference {
  return tournamentRef.collection("serverOnly").doc("emailSettings");
}

/** Loads a tournament's settings; a read failure falls back to the defaults so email still goes out. */
export async function loadEmailSettings(tournamentRef: DocumentReference): Promise<TournamentEmailSettings> {
  try {
    return readEmailSettings((await emailSettingsRef(tournamentRef).get()).data());
  } catch (error) {
    console.error("Could not read email settings:", error instanceof Error ? error.message : "unknown error");
    return defaultEmailSettings();
  }
}
