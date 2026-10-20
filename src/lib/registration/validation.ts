import type { FeedbackAnswer, FeedbackQuestion, FeedbackQuestionType } from "@/types";
import { isFeedbackAnswerRecord, validateFeedbackAnswers, validateFeedbackQuestions } from "@/lib/feedback/questions";
import { normalizeEmail } from "@/lib/emailAddress";
import type {
  AdjudicatorRegistrationData,
  PublicRegistrationForm,
  RegisteredSpeaker,
  RegistrationEntry,
  RegistrationInstitution,
  RegistrationSettings,
  TeamRegistrationData,
} from "@/lib/registration/types";

/** Request bodies above this size are refused before parsing. */
export const MAX_REGISTRATION_BODY_BYTES = 32_000;
export const MAX_NAME_LENGTH = 120;
export const MAX_ANSWER_LENGTH = 2_000;
export const MAX_CONFLICTS = 20;
export const MAX_QUESTIONS = 20;
export const MAX_SPEAKERS_LIMIT = 6;
/** A form submitted faster than this after it was shown is treated as automated. */
export const MIN_FILL_MS = 3_000;
/** A form older than this must be reloaded (also bounds replay of a captured request). */
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

const QUESTION_TYPES: readonly FeedbackQuestionType[] = ["text", "textarea", "scale", "yes_no", "select_one", "select_many"];

export class RegistrationValidationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Trims, collapses whitespace and drops control characters; null when not a string or too long. */
export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length <= maxLength ? cleaned : null;
}

function requiredText(value: unknown, maxLength: number, label: string): string {
  const text = cleanText(value, maxLength);
  if (text === null) throw new RegistrationValidationError(`${label} must be at most ${maxLength} characters.`);
  if (!text) throw new RegistrationValidationError(`Enter ${label.toLowerCase()}.`);
  return text;
}

/** Normalized institution name used for quotas and duplicate matching. */
export function institutionKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function makeInstitution(name: unknown): RegistrationInstitution | null {
  const text = cleanText(name, MAX_NAME_LENGTH);
  if (text === null) throw new RegistrationValidationError(`Institution names must be at most ${MAX_NAME_LENGTH} characters.`);
  if (!text) return null;
  const key = institutionKey(text);
  if (!key) throw new RegistrationValidationError("Enter a valid institution name.");
  return { name: text, key };
}

function nonNegativeInteger(value: unknown, label: string, max: number): number {
  if (value === undefined || value === null || value === "") return 0;
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 0 || number > max) {
    throw new RegistrationValidationError(`${label} must be a whole number from 0 to ${max}.`);
  }
  return number;
}

function optionalTime(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) throw new RegistrationValidationError(`${label} must be a valid date and time.`);
  return new Date(time).toISOString();
}

function parseQuestions(value: unknown, label: string): FeedbackQuestion[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_QUESTIONS) {
    throw new RegistrationValidationError(`${label}: add at most ${MAX_QUESTIONS} questions.`);
  }
  const questions = value.map((item, index): FeedbackQuestion => {
    const record = (item ?? {}) as Record<string, unknown>;
    const type = record.type as FeedbackQuestionType;
    if (!QUESTION_TYPES.includes(type)) throw new RegistrationValidationError(`${label}: question ${index + 1} has an unknown type.`);
    const id = cleanText(record.id, 64);
    const questionLabel = cleanText(record.label, 200);
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new RegistrationValidationError(`${label}: question ${index + 1} needs a short ID.`);
    if (questionLabel === null) throw new RegistrationValidationError(`${label}: question labels must be at most 200 characters.`);
    const question: FeedbackQuestion = { id, label: questionLabel, type, required: record.required === true };
    if (type === "select_one" || type === "select_many") {
      const options = Array.isArray(record.options) ? record.options.map((option) => cleanText(option, 100)) : [];
      if (options.length > 30 || options.some((option) => option === null)) {
        throw new RegistrationValidationError(`${label}: “${questionLabel}” can have up to 30 options of 100 characters.`);
      }
      question.options = options as string[];
    }
    if (type === "scale") {
      question.min = typeof record.min === "number" ? record.min : Number(record.min);
      question.max = typeof record.max === "number" ? record.max : Number(record.max);
    }
    return question;
  });
  const error = validateFeedbackQuestions(questions);
  if (error) throw new RegistrationValidationError(`${label}: ${error.replace("feedback question", "question")}`);
  return questions;
}

export function defaultRegistrationSettings(tournamentName: string, substantiveSpeakers = 2): RegistrationSettings {
  const speakers = Math.min(Math.max(Math.round(substantiveSpeakers) || 2, 1), MAX_SPEAKERS_LIMIT);
  return {
    enabled: false,
    teamRegistration: true,
    adjudicatorRegistration: true,
    representativesOnly: false,
    minSpeakers: speakers,
    maxSpeakers: Math.min(speakers + 1, MAX_SPEAKERS_LIMIT),
    speakerCategories: [],
    teamQuotaPerInstitution: 0,
    adjudicatorQuotaPerInstitution: 0,
    maxTeams: 0,
    maxAdjudicators: 0,
    teamQuestions: [],
    adjudicatorQuestions: [],
    instructions: "",
    tournamentName,
  };
}

/** Validates settings an administrator saves. Throws RegistrationValidationError. */
export function parseRegistrationSettings(input: unknown, tournamentName: string): RegistrationSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RegistrationValidationError("Invalid settings.");
  const record = input as Record<string, unknown>;
  const minSpeakers = nonNegativeInteger(record.minSpeakers, "Minimum speakers", MAX_SPEAKERS_LIMIT);
  const maxSpeakers = nonNegativeInteger(record.maxSpeakers, "Maximum speakers", MAX_SPEAKERS_LIMIT);
  if (minSpeakers < 1 || maxSpeakers < minSpeakers) {
    throw new RegistrationValidationError("Speakers per team: the minimum must be at least 1 and not above the maximum.");
  }
  const opensAt = optionalTime(record.opensAt, "Opening time");
  const closesAt = optionalTime(record.closesAt, "Closing time");
  if (opensAt && closesAt && Date.parse(opensAt) >= Date.parse(closesAt)) {
    throw new RegistrationValidationError("Registration must open before it closes.");
  }
  const categories = Array.isArray(record.speakerCategories) ? record.speakerCategories.map((item) => cleanText(item, 40)) : [];
  if (categories.length > 20 || categories.some((item) => !item)) {
    throw new RegistrationValidationError("Speaker categories: up to 20 non-empty labels of 40 characters.");
  }
  const instructions = typeof record.instructions === "string" ? record.instructions.trim() : "";
  if (instructions.length > 4_000) throw new RegistrationValidationError("Instructions must be at most 4,000 characters.");
  const settings: RegistrationSettings = {
    enabled: record.enabled === true,
    teamRegistration: record.teamRegistration !== false,
    adjudicatorRegistration: record.adjudicatorRegistration !== false,
    representativesOnly: record.representativesOnly === true,
    minSpeakers,
    maxSpeakers,
    speakerCategories: [...new Set(categories as string[])],
    teamQuotaPerInstitution: nonNegativeInteger(record.teamQuotaPerInstitution, "Teams per institution", 1_000),
    adjudicatorQuotaPerInstitution: nonNegativeInteger(record.adjudicatorQuotaPerInstitution, "Adjudicators per institution", 1_000),
    maxTeams: nonNegativeInteger(record.maxTeams, "Maximum teams", 10_000),
    maxAdjudicators: nonNegativeInteger(record.maxAdjudicators, "Maximum adjudicators", 10_000),
    teamQuestions: parseQuestions(record.teamQuestions, "Team questions"),
    adjudicatorQuestions: parseQuestions(record.adjudicatorQuestions, "Adjudicator questions"),
    instructions,
    tournamentName,
  };
  if (opensAt) settings.opensAt = opensAt;
  if (closesAt) settings.closesAt = closesAt;
  if (!settings.teamRegistration && !settings.adjudicatorRegistration && settings.enabled) {
    throw new RegistrationValidationError("Allow team or adjudicator registration (or both) before opening registration.");
  }
  return settings;
}

export function registrationWindowState(
  settings: Pick<RegistrationSettings, "enabled" | "opensAt" | "closesAt">,
  now: number
): PublicRegistrationForm["state"] {
  if (!settings.enabled) return "disabled";
  if (settings.opensAt && now < Date.parse(settings.opensAt)) return "not_open";
  if (settings.closesAt && now >= Date.parse(settings.closesAt)) return "closed";
  return "open";
}

export function toPublicForm(settings: RegistrationSettings, now: number): PublicRegistrationForm {
  const form: PublicRegistrationForm = {
    tournamentName: settings.tournamentName,
    state: registrationWindowState(settings, now),
    teamRegistration: settings.teamRegistration,
    adjudicatorRegistration: settings.adjudicatorRegistration,
    representativesOnly: settings.representativesOnly,
    minSpeakers: settings.minSpeakers,
    maxSpeakers: settings.maxSpeakers,
    speakerCategories: settings.speakerCategories,
    teamQuestions: settings.teamQuestions,
    adjudicatorQuestions: settings.adjudicatorQuestions,
    instructions: settings.instructions,
  };
  if (settings.opensAt) form.opensAt = settings.opensAt;
  if (settings.closesAt) form.closesAt = settings.closesAt;
  return form;
}

/**
 * Bot signals: a filled honeypot field, a form submitted implausibly fast, or a form older than a
 * day. Returns why the submission looks automated, or null.
 */
export function spamSignal(input: { honeypot: unknown; startedAt: unknown }, now: number): string | null {
  if (typeof input.honeypot === "string" ? input.honeypot.trim() !== "" : input.honeypot !== undefined) return "honeypot";
  const startedAt = typeof input.startedAt === "number" ? input.startedAt : NaN;
  if (!Number.isFinite(startedAt)) return "missing_start";
  if (now - startedAt < MIN_FILL_MS) return "too_fast";
  if (now - startedAt > MAX_FORM_AGE_MS || startedAt > now + 60_000) return "stale_form";
  return null;
}

function parseEmail(value: unknown, label: string, required: boolean): string | undefined {
  if (!required && (value === undefined || value === null || (typeof value === "string" && !value.trim()))) return undefined;
  const email = normalizeEmail(value);
  if (!email) throw new RegistrationValidationError(`Enter a valid email address for ${label}.`);
  return email;
}

function parseNameList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n;]+/) : null;
  if (!items) throw new RegistrationValidationError(`${label} must be a list.`);
  const cleaned = items.map((item) => cleanText(item, MAX_NAME_LENGTH));
  if (cleaned.some((item) => item === null)) throw new RegistrationValidationError(`${label}: each entry can be up to ${MAX_NAME_LENGTH} characters.`);
  const unique = [...new Set((cleaned as string[]).filter(Boolean))];
  if (unique.length > MAX_CONFLICTS) throw new RegistrationValidationError(`${label}: list at most ${MAX_CONFLICTS}.`);
  return unique;
}

function parseAnswers(value: unknown, questions: FeedbackQuestion[]): Record<string, FeedbackAnswer> {
  const answers = value === undefined ? {} : value;
  if (!isFeedbackAnswerRecord(answers)) throw new RegistrationValidationError("The answers to the tournament's questions are not valid.");
  const known = new Set(questions.map((question) => question.id));
  if (Object.keys(answers).some((id) => !known.has(id))) {
    throw new RegistrationValidationError("The form has changed since it was opened. Reload the page and try again.");
  }
  const cleaned: Record<string, FeedbackAnswer> = {};
  for (const [id, answer] of Object.entries(answers)) {
    if (typeof answer === "string") {
      if (answer.length > MAX_ANSWER_LENGTH) throw new RegistrationValidationError(`Answers can be at most ${MAX_ANSWER_LENGTH} characters.`);
      cleaned[id] = answer.trim();
    } else if (Array.isArray(answer)) {
      cleaned[id] = [...new Set(answer)];
    } else {
      cleaned[id] = answer;
    }
  }
  const error = validateFeedbackAnswers(questions, cleaned);
  if (error) throw new RegistrationValidationError(error);
  return cleaned;
}

function parseSpeakers(value: unknown, settings: RegistrationSettings): RegisteredSpeaker[] {
  if (!Array.isArray(value)) throw new RegistrationValidationError("Add the team's speakers.");
  const speakers = value.map((item, index): RegisteredSpeaker => {
    const record = (item ?? {}) as Record<string, unknown>;
    const name = requiredText(record.name, MAX_NAME_LENGTH, `Speaker ${index + 1}'s name`);
    const categories = Array.isArray(record.categories) ? record.categories : [];
    if (categories.some((category) => typeof category !== "string" || !settings.speakerCategories.includes(category))) {
      throw new RegistrationValidationError(`Choose valid categories for ${name}.`);
    }
    const speaker: RegisteredSpeaker = { name, categories: [...new Set(categories as string[])] };
    const email = parseEmail(record.email, name, false);
    if (email) speaker.email = email;
    return speaker;
  });
  if (speakers.length < settings.minSpeakers || speakers.length > settings.maxSpeakers) {
    throw new RegistrationValidationError(
      settings.minSpeakers === settings.maxSpeakers
        ? `A team needs exactly ${settings.minSpeakers} speakers.`
        : `A team needs ${settings.minSpeakers} to ${settings.maxSpeakers} speakers.`
    );
  }
  const names = speakers.map((speaker) => speaker.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new RegistrationValidationError("Each speaker in a team must have a different name.");
  return speakers;
}

/**
 * Validates and normalizes one registration. `institution` overrides the submitted institution
 * (a representative's link fixes it). Kinds the settings do not allow are refused.
 */
export function parseRegistrationEntry(
  input: unknown,
  settings: RegistrationSettings,
  options: { institution?: RegistrationInstitution } = {}
): RegistrationEntry {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RegistrationValidationError("Invalid registration.");
  const record = input as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== "team" && kind !== "adjudicator") throw new RegistrationValidationError("Choose team or adjudicator registration.");
  if (kind === "team" && !settings.teamRegistration) throw new RegistrationValidationError("This tournament is not taking team registrations.", 403);
  if (kind === "adjudicator" && !settings.adjudicatorRegistration) {
    throw new RegistrationValidationError("This tournament is not taking adjudicator registrations.", 403);
  }
  const institution = options.institution ?? makeInstitution(record.institution);
  const contactName = requiredText(record.contactName, MAX_NAME_LENGTH, "Your name");
  const contactEmail = parseEmail(record.contactEmail, "yourself", true)!;
  const questions = kind === "team" ? settings.teamQuestions : settings.adjudicatorQuestions;
  const entry: RegistrationEntry = {
    kind,
    institution,
    contactName,
    contactEmail,
    answers: parseAnswers(record.answers, questions),
  };
  if (kind === "team") {
    const team = (record.team ?? {}) as Record<string, unknown>;
    const data: TeamRegistrationData = {
      name: requiredText(team.name, MAX_NAME_LENGTH, "Team name"),
      speakers: parseSpeakers(team.speakers, settings),
    };
    entry.team = data;
  } else {
    const adjudicator = (record.adjudicator ?? {}) as Record<string, unknown>;
    const data: AdjudicatorRegistrationData = {
      name: requiredText(adjudicator.name, MAX_NAME_LENGTH, "Adjudicator name"),
      email: parseEmail(adjudicator.email, "the adjudicator", true)!,
      institutionConflicts: parseNameList(adjudicator.institutionConflicts, "Institution conflicts"),
      teamConflicts: parseNameList(adjudicator.teamConflicts, "Team conflicts"),
    };
    entry.adjudicator = data;
  }
  return entry;
}

/** The display name of an entry (team or adjudicator name). */
export function entryName(entry: Pick<RegistrationEntry, "kind" | "team" | "adjudicator">): string {
  return (entry.kind === "team" ? entry.team?.name : entry.adjudicator?.name) ?? "";
}
