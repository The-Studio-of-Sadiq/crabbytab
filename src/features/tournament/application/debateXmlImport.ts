import {
  aggregateVotingSheets,
  ballotSides,
  consensusTeamScores,
  type BallotRules,
  type SideRecord,
} from "@/lib/ballots/result";
import { defaultPreferences, slugify } from "@/lib/setup/presets";
import type {
  Adjudicator,
  AdjudicatorConflict,
  AdjudicatorSheet,
  BallotSubmission,
  BreakCategory,
  Debate,
  DebateSide,
  DebateTeamSlot,
  FeedbackAnswer,
  FeedbackQuestion,
  FeedbackQuestionType,
  FeedbackSubmission,
  Institution,
  Motion,
  Round,
  SpeakerScoreEntry,
  Team,
  TeamScoreEntry,
  Tournament,
  TournamentFormat,
  Venue,
} from "@/types";

/**
 * Reads a Tabbycat-compatible DebateXML archive into the records of a brand-new tournament.
 *
 * The file is untrusted: it is size-limited, DTDs (and so entity expansion) are refused, only
 * attributes and text nodes are read, and every reference is resolved against the file's own
 * definitions. Problems are reported per element; when any error is found no data is returned,
 * so nothing is ever half-imported.
 */

export const DEBATE_XML_MAX_CHARACTERS = 10 * 1024 * 1024;

const LIMITS = {
  rounds: 100,
  teams: 5000,
  speakersPerTeam: 12,
  adjudicators: 5000,
  venues: 5000,
  motions: 2000,
  institutions: 5000,
  breakCategories: 10,
  questions: 100,
  debatesPerRound: 2500,
  feedback: 100000,
} as const;

const MAX_REPORTED_ISSUES = 200;

/** The minimal DOM surface the importer reads; satisfied by browser DOM and @xmldom/xmldom. */
export interface XmlNodeLike {
  nodeType: number;
  nodeValue: string | null;
  childNodes: ArrayLike<XmlNodeLike>;
}

export interface XmlElementLike extends XmlNodeLike {
  tagName: string;
  localName?: string | null;
  getAttribute(name: string): string | null;
}

/** Parses XML text and returns the document element, throwing on malformed input. */
export type XmlParser = (text: string) => XmlElementLike;

/** The browser parser. DOMParser never runs scripts or fetches external entities. */
export function parseXmlWithDomParser(text: string): XmlElementLike {
  if (typeof DOMParser === "undefined") throw new Error("This browser cannot read XML files.");
  const document = new DOMParser().parseFromString(text, "application/xml");
  const parserError = document.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error((parserError.textContent || "Unknown parser error.").trim().slice(0, 300));
  }
  return document.documentElement;
}

export interface DebateXmlIssue {
  severity: "error" | "warning";
  /** Where in the file, e.g. `round "Round 1" › debate "D3"`. */
  path: string;
  message: string;
}

export interface ImportedTournamentCollections {
  rounds: Round[];
  teams: Team[];
  adjudicators: Adjudicator[];
  venues: Venue[];
  motions: Motion[];
  breakCategories: BreakCategory[];
  debates: Debate[];
  ballots: BallotSubmission[];
  feedback: FeedbackSubmission[];
  institutions: Institution[];
}

export interface ImportedTournament {
  tournament: Tournament;
  collections: ImportedTournamentCollections;
}

export interface DebateXmlImportCounts {
  institutions: number;
  teams: number;
  speakers: number;
  adjudicators: number;
  conflicts: number;
  venues: number;
  motions: number;
  breakCategories: number;
  rounds: number;
  debates: number;
  byes: number;
  ballots: number;
  votingBallots: number;
  feedback: number;
  feedbackQuestions: number;
}

export interface DebateXmlImportResult {
  issues: DebateXmlIssue[];
  /** Present only when the file had no errors. */
  data?: ImportedTournament;
  counts: DebateXmlImportCounts;
  /** Name and short name found in the file, for pre-filling the new tournament's fields. */
  suggestedName: string;
  suggestedShortName: string;
  /** Plain-language notes about defaults the importer had to choose. */
  notes: string[];
}

export interface DebateXmlImportOptions {
  parseXml: XmlParser;
  identity: {
    id: string;
    slug: string;
    ownerId: string;
    /** Overrides the name in the file. */
    name?: string;
    shortName?: string;
  };
  now?: string;
}

/* -------------------------------------------------------------------------- */
/* Small DOM helpers                                                          */
/* -------------------------------------------------------------------------- */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;

function nameOf(element: XmlElementLike): string {
  return element.localName || element.tagName;
}

function childElements(element: XmlElementLike, name?: string): XmlElementLike[] {
  const result: XmlElementLike[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const node = element.childNodes[index];
    if (node.nodeType !== ELEMENT_NODE) continue;
    const child = node as XmlElementLike;
    if (!name || nameOf(child) === name) result.push(child);
  }
  return result;
}

/** Text directly inside the element, ignoring nested elements such as <info-slide> or <feedback>. */
function ownText(element: XmlElementLike): string {
  let text = "";
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const node = element.childNodes[index];
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) text += node.nodeValue ?? "";
  }
  return text.trim();
}

function attr(element: XmlElementLike, name: string): string | undefined {
  const value = element.getAttribute(name)?.trim();
  return value ? value : undefined;
}

function refList(element: XmlElementLike, name: string): string[] {
  return (attr(element, name) ?? "").split(/\s+/).filter(Boolean);
}

function isTrue(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function quoted(value: string | undefined): string {
  return value ? ` "${value.slice(0, 60)}"` : "";
}

/* -------------------------------------------------------------------------- */
/* Issues and ids                                                             */
/* -------------------------------------------------------------------------- */

class IssueLog {
  readonly issues: DebateXmlIssue[] = [];
  private suppressed = 0;

  add(severity: DebateXmlIssue["severity"], path: string, message: string) {
    if (this.issues.length >= MAX_REPORTED_ISSUES) {
      this.suppressed += 1;
      return;
    }
    this.issues.push({ severity, path, message });
  }

  error(path: string, message: string) {
    this.add("error", path, message);
  }

  warning(path: string, message: string) {
    this.add("warning", path, message);
  }

  get hasErrors() {
    return this.suppressed > 0 || this.issues.some((issue) => issue.severity === "error");
  }

  finish(): DebateXmlIssue[] {
    return this.suppressed > 0
      ? [...this.issues, { severity: "error", path: "file", message: `${this.suppressed} more problem(s) were not listed.` }]
      : this.issues;
  }
}

type IdKind =
  | "institution"
  | "team"
  | "speaker"
  | "adjudicator"
  | "venue"
  | "motion"
  | "breakCategory"
  | "division"
  | "speakerCategory"
  | "question"
  | "debate";

/** The prefixes CrabbyTab's exporter adds, stripped so an export → import keeps record ids. */
const EXPORT_PREFIXES: Record<IdKind, string> = {
  institution: "institution_",
  team: "team_",
  speaker: "speaker_",
  adjudicator: "adj_",
  venue: "venue_",
  motion: "motion_",
  breakCategory: "break_",
  division: "division_",
  speakerCategory: "speaker_category_",
  question: "question_",
  debate: "debate_",
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

class IdRegistry {
  private readonly byXmlId = new Map<IdKind, Map<string, string>>();
  private readonly used = new Map<IdKind, Set<string>>();
  private counter = 0;

  constructor(private readonly log: IssueLog) {}

  /** Registers an XML id and returns the CrabbyTab id for it. */
  define(kind: IdKind, xmlId: string | undefined, path: string, required = true): string {
    const map = this.byXmlId.get(kind) ?? new Map<string, string>();
    this.byXmlId.set(kind, map);
    if (!xmlId) {
      if (required) this.log.error(path, "Missing the id attribute that other elements use to refer to it.");
      return this.allocate(kind, "");
    }
    if (map.has(xmlId)) {
      this.log.error(path, `The id "${xmlId.slice(0, 60)}" is used more than once.`);
      return map.get(xmlId)!;
    }
    const prefix = EXPORT_PREFIXES[kind];
    const id = this.allocate(kind, xmlId.startsWith(prefix) ? xmlId.slice(prefix.length) : xmlId);
    map.set(xmlId, id);
    return id;
  }

  resolve(kind: IdKind, xmlId: string): string | undefined {
    return this.byXmlId.get(kind)?.get(xmlId);
  }

  private allocate(kind: IdKind, candidate: string): string {
    const used = this.used.get(kind) ?? new Set<string>();
    this.used.set(kind, used);
    let id = SAFE_ID.test(candidate) ? candidate : `${kind}-${++this.counter}`;
    while (used.has(id)) id = `${kind}-${++this.counter}`;
    used.add(id);
    return id;
  }
}

/* -------------------------------------------------------------------------- */
/* Raw structures read in the first pass                                      */
/* -------------------------------------------------------------------------- */

interface RawBallot {
  key: string;
  rank?: number;
  points?: number;
}

interface RawSpeech {
  speakerId: string;
  reply: boolean;
  ghost: boolean;
  scores: Map<string, number>;
  path: string;
}

interface RawSide {
  teamId: string;
  ballots: RawBallot[];
  speeches: RawSpeech[];
}

interface RawDebate {
  id: string;
  path: string;
  chairId?: string;
  adjudicatorIds: string[];
  venueId?: string;
  motionId?: string;
  sides: RawSide[];
}

interface RawRound {
  name: string;
  abbreviation?: string;
  elimination: boolean;
  feedbackWeight?: number;
  breakCategoryId?: string;
  divisionId?: string;
  silent: boolean;
  debates: RawDebate[];
  byeTeamIds: string[];
}

const QUESTION_TYPES: Record<string, FeedbackQuestionType> = {
  t: "text",
  tl: "textarea",
  i: "scale",
  is: "scale",
  f: "scale",
  bc: "yes_no",
  bs: "yes_no",
  ss: "select_one",
  ms: "select_many",
};

const STYLES: Record<string, TournamentFormat> = {
  bp: "bp",
  uadc: "uadc",
  australs: "australs",
  wsdc: "wsdc",
};

function emptyCounts(): DebateXmlImportCounts {
  return {
    institutions: 0,
    teams: 0,
    speakers: 0,
    adjudicators: 0,
    conflicts: 0,
    venues: 0,
    motions: 0,
    breakCategories: 0,
    rounds: 0,
    debates: 0,
    byes: 0,
    ballots: 0,
    votingBallots: 0,
    feedback: 0,
    feedbackQuestions: 0,
  };
}

function failure(log: IssueLog, path: string, message: string): DebateXmlImportResult {
  log.error(path, message);
  return { issues: log.finish(), counts: emptyCounts(), suggestedName: "", suggestedShortName: "", notes: [] };
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

export function importDebateXmlArchive(text: string, options: DebateXmlImportOptions): DebateXmlImportResult {
  const log = new IssueLog();
  if (text.length > DEBATE_XML_MAX_CHARACTERS) {
    return failure(log, "file", `The file is larger than ${DEBATE_XML_MAX_CHARACTERS / 1024 / 1024} MB.`);
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    return failure(log, "file", "Files with a DOCTYPE or entity declarations are not accepted.");
  }
  let root: XmlElementLike;
  try {
    root = options.parseXml(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failure(log, "file", `The file is not well-formed XML: ${detail.slice(0, 300)}`);
  }
  if (nameOf(root) !== "tournament") {
    return failure(log, "file", `Expected a <tournament> root element, found <${nameOf(root).slice(0, 40)}>.`);
  }

  const now = options.now ?? new Date().toISOString();
  const tournamentId = options.identity.id;
  const ids = new IdRegistry(log);
  const notes: string[] = [];
  const counts = emptyCounts();
  const suggestedName = attr(root, "name") ?? "";
  const suggestedShortName = attr(root, "short") ?? "";

  const number = (element: XmlElementLike, name: string, path: string): number | undefined => {
    const raw = attr(element, name);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      log.error(path, `The ${name} "${raw.slice(0, 20)}" is not a number.`);
      return undefined;
    }
    return value;
  };
  const tooMany = (elements: unknown[], limit: number, label: string) => {
    if (elements.length > limit) log.error("file", `The file has ${elements.length} ${label}; at most ${limit} are supported.`);
  };

  /* ----------------------------- definitions ----------------------------- */

  const institutionElements = childElements(root, "institution");
  tooMany(institutionElements, LIMITS.institutions, "institutions");
  const institutions: Institution[] = [];
  for (const element of institutionElements.slice(0, LIMITS.institutions)) {
    const name = ownText(element);
    const path = `institution${quoted(attr(element, "id") ?? name)}`;
    const id = ids.define("institution", attr(element, "id"), path);
    if (!name) log.error(path, "The institution has no name.");
    institutions.push({
      id,
      tournamentId,
      name,
      code: attr(element, "reference") ?? "",
      ...(attr(element, "region") ? { region: attr(element, "region") } : {}),
    });
  }
  const institutionById = new Map(institutions.map((institution) => [institution.id, institution]));

  const speakerCategoryNames = new Map<string, string>();
  for (const element of childElements(root, "speaker-category")) {
    const name = ownText(element) || attr(element, "name");
    const path = `speaker-category${quoted(attr(element, "id") ?? name)}`;
    const id = ids.define("speakerCategory", attr(element, "id"), path);
    if (!name) log.error(path, "The speaker category has no name.");
    else speakerCategoryNames.set(id, name);
  }

  const divisionNames = new Map<string, string>();
  for (const element of childElements(root, "division")) {
    const path = `division${quoted(attr(element, "id"))}`;
    const id = ids.define("division", attr(element, "id"), path);
    divisionNames.set(id, ownText(element) || id);
  }

  const breakElements = childElements(root, "break-category");
  tooMany(breakElements, LIMITS.breakCategories, "break categories");
  const breakCategories: BreakCategory[] = breakElements.slice(0, LIMITS.breakCategories).map((element, index) => {
    const name = ownText(element);
    const path = `break-category${quoted(attr(element, "id") ?? name)}`;
    const id = ids.define("breakCategory", attr(element, "id"), path);
    if (!name) log.error(path, "The break category has no name.");
    const breakSize = number(element, "break-size", path);
    if (breakSize === undefined) {
      log.warning(path, "The file has no break size for this category; it is set to 0. Set it in Break settings.");
    } else if (!Number.isInteger(breakSize) || breakSize < 0) {
      log.error(path, "The break size must be a whole number of 0 or more.");
    }
    const reserveSize = number(element, "reserve-size", path) ?? 0;
    return {
      id,
      tournamentId,
      name,
      slug: slugify(name) || `category-${index + 1}`,
      seq: index + 1,
      breakSize: breakSize ?? 0,
      reserveSize: Number.isInteger(reserveSize) && reserveSize >= 0 ? reserveSize : 0,
      isGeneral: isTrue(attr(element, "general")),
      priority: number(element, "priority", path) ?? index + 1,
    };
  });
  if (breakCategories.length > 0 && !breakCategories.some((category) => category.isGeneral)) {
    log.warning("break categories", "No break category is marked as the general (open) break; review this in Break settings.");
  }

  const venueElements = childElements(root, "venue");
  tooMany(venueElements, LIMITS.venues, "venues");
  const venues: Venue[] = venueElements.slice(0, LIMITS.venues).map((element) => {
    const name = ownText(element);
    const path = `venue${quoted(attr(element, "id") ?? name)}`;
    const id = ids.define("venue", attr(element, "id"), path);
    if (!name) log.error(path, "The venue has no name.");
    return { id, tournamentId, name, priority: number(element, "priority", path) ?? 0 };
  });
  const venueById = new Map(venues.map((venue) => [venue.id, venue]));

  const motionElements = childElements(root, "motion");
  tooMany(motionElements, LIMITS.motions, "motions");
  const motions: Motion[] = motionElements.slice(0, LIMITS.motions).map((element, index) => {
    const text = ownText(element);
    const path = `motion${quoted(attr(element, "id") ?? text)}`;
    const id = ids.define("motion", attr(element, "id"), path);
    if (!text) log.error(path, "The motion has no text.");
    const infoSlide = childElements(element, "info-slide").map(ownText).join("\n").trim();
    return {
      id,
      tournamentId,
      text,
      ...(attr(element, "reference") ? { reference: attr(element, "reference") } : {}),
      ...(infoSlide ? { infoSlide } : {}),
      rounds: [],
      seq: index + 1,
      released: false,
    };
  });
  const motionById = new Map(motions.map((motion) => [motion.id, motion]));

  const questionElements = childElements(root, "question");
  tooMany(questionElements, LIMITS.questions, "feedback questions");
  const teamQuestions: FeedbackQuestion[] = [];
  const adjudicatorQuestions: FeedbackQuestion[] = [];
  for (const element of questionElements.slice(0, LIMITS.questions)) {
    const label = attr(element, "name") ?? ownText(element);
    const path = `question${quoted(attr(element, "id") ?? label)}`;
    const id = ids.define("question", attr(element, "id"), path);
    const rawType = attr(element, "type") ?? "";
    const type = QUESTION_TYPES[rawType];
    if (!label) log.error(path, "The question has no text.");
    if (!type) {
      log.error(path, `Unknown question type "${rawType.slice(0, 10)}".`);
      continue;
    }
    const options = childElements(element, "choice").map(ownText).filter(Boolean);
    const min = number(element, "min-value", path);
    const max = number(element, "max-value", path);
    const question: FeedbackQuestion = {
      id,
      label,
      type,
      required: isTrue(attr(element, "required")),
      ...(options.length ? { options } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    };
    if (isTrue(attr(element, "from-teams"))) teamQuestions.push(question);
    if (isTrue(attr(element, "from-adjudicators"))) adjudicatorQuestions.push(question);
  }
  const questionTypes = {
    team: new Map(teamQuestions.map((question) => [question.id, question.type])),
    adjudicator: new Map(adjudicatorQuestions.map((question) => [question.id, question.type])),
  };

  /* ----------------------------- participants ---------------------------- */

  const participants = childElements(root, "participants");
  if (participants.length > 1) log.error("participants", "The file has more than one <participants> element.");
  const participantRoot = participants[0];
  const teamElements = participantRoot ? childElements(participantRoot, "team") : [];
  const adjudicatorElements = participantRoot ? childElements(participantRoot, "adjudicator") : [];
  tooMany(teamElements, LIMITS.teams, "teams");
  tooMany(adjudicatorElements, LIMITS.adjudicators, "adjudicators");

  const resolveRef = (kind: IdKind, ref: string, path: string, label: string): string | undefined => {
    const id = ids.resolve(kind, ref);
    if (!id) log.error(path, `Refers to ${label} "${ref.slice(0, 60)}", which is not defined in the file.`);
    return id;
  };
  /** Turns a ballot's `adjudicators` refs into a key of CrabbyTab ids. */
  const ballotKey = (element: XmlElementLike, path: string): string =>
    refList(element, "adjudicators")
      .map((ref) => resolveRef("adjudicator", ref, path, "adjudicator") ?? `unknown:${ref}`)
      .join(" ");

  // Register every participant id first so conflicts and feedback can refer forwards.
  const teamIdsByElement = teamElements.slice(0, LIMITS.teams).map((element) =>
    ids.define("team", attr(element, "id"), `team${quoted(attr(element, "id") ?? attr(element, "name"))}`)
  );
  const adjudicatorIdsByElement = adjudicatorElements.slice(0, LIMITS.adjudicators).map((element) =>
    ids.define("adjudicator", attr(element, "id"), `adjudicator${quoted(attr(element, "id") ?? attr(element, "name"))}`)
  );

  const speakerTeam = new Map<string, string>();
  const teams: Team[] = teamElements.slice(0, LIMITS.teams).map((element, index) => {
    const id = teamIdsByElement[index];
    const name = attr(element, "name") ?? ownText(element);
    const path = `team${quoted(attr(element, "id") ?? name)}`;
    if (!name) log.error(path, "The team has no name.");
    const speakerElements = childElements(element, "speaker");
    if (speakerElements.length > LIMITS.speakersPerTeam) {
      log.error(path, `The team has ${speakerElements.length} speakers; at most ${LIMITS.speakersPerTeam} are supported.`);
    }
    let speakerInstitutionRef: string | undefined;
    const speakers = speakerElements.slice(0, LIMITS.speakersPerTeam).map((speakerElement) => {
      const speakerName = attr(speakerElement, "name") ?? ownText(speakerElement);
      const speakerPath = `${path} › speaker${quoted(attr(speakerElement, "id") ?? speakerName)}`;
      const speakerId = ids.define("speaker", attr(speakerElement, "id"), speakerPath);
      speakerTeam.set(speakerId, id);
      if (!speakerName) log.error(speakerPath, "The speaker has no name.");
      speakerInstitutionRef ??= refList(speakerElement, "institutions")[0];
      const categories = refList(speakerElement, "categories").flatMap((ref) => {
        const categoryId = resolveRef("speakerCategory", ref, speakerPath, "speaker category");
        const categoryName = categoryId ? speakerCategoryNames.get(categoryId) : undefined;
        return categoryName ? [categoryName] : [];
      });
      const gender = attr(speakerElement, "gender");
      return {
        id: speakerId,
        name: speakerName,
        ...(gender ? { gender } : {}),
        ...(categories.length ? { categories } : {}),
      };
    });
    counts.speakers += speakers.length;
    const institutionRef = attr(element, "institution") ?? speakerInstitutionRef;
    const institutionId = institutionRef ? resolveRef("institution", institutionRef, path, "institution") : undefined;
    const institution = institutionId ? institutionById.get(institutionId) : undefined;
    const breakEligibility = refList(element, "break-eligibilities").flatMap((ref) => {
      const categoryId = resolveRef("breakCategory", ref, path, "break category");
      return categoryId ? [categoryId] : [];
    });
    const divisionRef = attr(element, "division");
    const divisionId = divisionRef ? resolveRef("division", divisionRef, path, "division") : undefined;
    const code = attr(element, "code");
    return {
      id,
      tournamentId,
      name,
      ...(code ? { codeName: code } : {}),
      ...(institution ? { institutionId: institution.id, institutionName: institution.name } : {}),
      ...(divisionId ? { divisionId, divisionName: divisionNames.get(divisionId) } : {}),
      speakers,
      breakCategories: breakEligibility,
      speakerCategories: [...new Set(speakers.flatMap((speaker) => speaker.categories ?? []))],
    };
  });
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const speakerNames = new Map(teams.flatMap((team) => team.speakers.map((speaker) => [speaker.id, speaker.name] as const)));

  interface PendingFeedback {
    element: XmlElementLike;
    targetId: string;
    path: string;
  }
  const pendingFeedback: PendingFeedback[] = [];
  const adjudicators: Adjudicator[] = adjudicatorElements.slice(0, LIMITS.adjudicators).map((element, index) => {
    const id = adjudicatorIdsByElement[index];
    const name = attr(element, "name") ?? ownText(element);
    const path = `adjudicator${quoted(attr(element, "id") ?? name)}`;
    if (!name) log.error(path, "The adjudicator has no name.");
    const institutionRef = refList(element, "institutions")[0];
    const institutionId = institutionRef ? resolveRef("institution", institutionRef, path, "institution") : undefined;
    const institution = institutionId ? institutionById.get(institutionId) : undefined;
    let score = number(element, "score", path);
    if (score === undefined) {
      log.warning(path, "No adjudicator score in the file; it is set to 5.");
      score = 5;
    }
    const conflicts: AdjudicatorConflict[] = [
      ...refList(element, "team-conflicts").flatMap((ref) => {
        const teamId = resolveRef("team", ref, path, "team");
        return teamId ? [{ teamId, type: "personal" as const }] : [];
      }),
      ...refList(element, "institution-conflicts").flatMap((ref) => {
        const conflictId = resolveRef("institution", ref, path, "institution");
        return conflictId ? [{ institutionId: conflictId, type: "institution" as const }] : [];
      }),
      ...refList(element, "adjudicator-conflicts").flatMap((ref) => {
        const adjudicatorId = resolveRef("adjudicator", ref, path, "adjudicator");
        if (adjudicatorId === id) {
          log.warning(path, "An adjudicator conflict with themself was ignored.");
          return [];
        }
        return adjudicatorId ? [{ adjudicatorId, type: "personal" as const }] : [];
      }),
    ];
    // CrabbyTab always conflicts adjudicators with their own institution.
    if (institution && !conflicts.some((conflict) => conflict.institutionId === institution.id && !conflict.teamId)) {
      conflicts.push({ institutionId: institution.id, type: "institution" });
    }
    counts.conflicts += conflicts.length;
    for (const feedbackElement of childElements(element, "feedback")) {
      pendingFeedback.push({ element: feedbackElement, targetId: id, path: `${path} › feedback` });
    }
    const gender = attr(element, "gender");
    return {
      id,
      tournamentId,
      name,
      ...(institution ? { institutionId: institution.id, institutionName: institution.name } : {}),
      baseScore: score,
      trainee: isTrue(attr(element, "trainee")),
      independent: isTrue(attr(element, "independent")),
      conflicts,
      ...(gender ? { gender } : {}),
    };
  });
  const adjudicatorById = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));

  /* -------------------------------- rounds ------------------------------- */

  const roundElements = childElements(root, "round");
  tooMany(roundElements, LIMITS.rounds, "rounds");
  const rawRounds: RawRound[] = roundElements.slice(0, LIMITS.rounds).map((element, roundIndex) => {
    const name = attr(element, "name") ?? "";
    const roundPath = `round${quoted(name || String(roundIndex + 1))}`;
    if (!name) log.warning(roundPath, `The round has no name; it is called "Round ${roundIndex + 1}".`);
    const breakRef = attr(element, "break-category");
    const divisionRef = attr(element, "division");
    const debateElements = childElements(element, "debate");
    if (debateElements.length > LIMITS.debatesPerRound) {
      log.error(roundPath, `The round has ${debateElements.length} debates; at most ${LIMITS.debatesPerRound} are supported.`);
    }
    const busyTeams = new Set<string>();
    const busyAdjudicators = new Set<string>();
    const debates = debateElements.slice(0, LIMITS.debatesPerRound).map((debateElement, debateIndex): RawDebate => {
      const path = `${roundPath} › debate${quoted(attr(debateElement, "id") ?? String(debateIndex + 1))}`;
      const id = ids.define("debate", attr(debateElement, "id"), path, false);
      const chairRef = attr(debateElement, "chair");
      const chairId = chairRef ? resolveRef("adjudicator", chairRef, path, "adjudicator") : undefined;
      const adjudicatorIds = [...new Set([
        ...(chairId ? [chairId] : []),
        ...refList(debateElement, "adjudicators").flatMap((ref) => {
          const adjudicatorId = resolveRef("adjudicator", ref, path, "adjudicator");
          return adjudicatorId ? [adjudicatorId] : [];
        }),
      ])];
      for (const adjudicatorId of adjudicatorIds) {
        if (busyAdjudicators.has(adjudicatorId)) {
          log.error(path, `Adjudicator "${adjudicatorById.get(adjudicatorId)?.name}" is in more than one debate in this round.`);
        }
        busyAdjudicators.add(adjudicatorId);
      }
      const venueRef = attr(debateElement, "venue");
      const motionRef = attr(debateElement, "motion");
      const sides = childElements(debateElement, "side").flatMap((sideElement, sideIndex): RawSide[] => {
        const sidePath = `${path} › side ${sideIndex + 1}`;
        const teamRef = attr(sideElement, "team");
        if (!teamRef) {
          log.error(sidePath, "The side has no team.");
          return [];
        }
        const teamId = resolveRef("team", teamRef, sidePath, "team");
        if (!teamId) return [];
        if (busyTeams.has(teamId)) {
          log.error(sidePath, `Team "${teamById.get(teamId)?.name}" appears more than once in this round.`);
        }
        busyTeams.add(teamId);
        const ballots = childElements(sideElement, "ballot").flatMap((ballotElement): RawBallot[] => {
          const rank = number(ballotElement, "rank", sidePath);
          const pointsText = ownText(ballotElement);
          const points = pointsText === "" ? undefined : Number(pointsText);
          if (points !== undefined && !Number.isFinite(points)) {
            log.error(sidePath, `The ballot value "${pointsText.slice(0, 20)}" is not a number.`);
          }
          if (rank === undefined && points === undefined) return [];
          return [{ key: ballotKey(ballotElement, sidePath), rank, points: Number.isFinite(points) ? points : undefined }];
        });
        const speeches = childElements(sideElement, "speech").flatMap((speechElement, speechIndex): RawSpeech[] => {
          const speechPath = `${sidePath} › speech ${speechIndex + 1}`;
          const speakerRef = attr(speechElement, "speaker");
          const speakerId = speakerRef ? resolveRef("speaker", speakerRef, speechPath, "speaker") : undefined;
          if (!speakerRef) log.error(speechPath, "The speech has no speaker.");
          if (!speakerId) return [];
          if (speakerTeam.get(speakerId) !== teamId) {
            log.warning(speechPath, "The speaker is not a member of this team.");
          }
          const scores = new Map<string, number>();
          for (const ballotElement of childElements(speechElement, "ballot")) {
            const value = Number(ownText(ballotElement));
            const key = ballotKey(ballotElement, speechPath);
            if (ownText(ballotElement) === "" || !Number.isFinite(value)) {
              log.error(speechPath, `The speaker score "${ownText(ballotElement).slice(0, 20)}" is not a number.`);
              continue;
            }
            if (scores.has(key)) log.error(speechPath, "The speech has two scores from the same adjudicator.");
            scores.set(key, value);
          }
          return [{
            speakerId,
            reply: isTrue(attr(speechElement, "reply")),
            ghost: isTrue(attr(speechElement, "ghost")),
            scores,
            path: speechPath,
          }];
        });
        return [{ teamId, ballots, speeches }];
      });
      return {
        id,
        path,
        chairId,
        adjudicatorIds,
        venueId: venueRef ? resolveRef("venue", venueRef, path, "venue") : undefined,
        motionId: motionRef ? resolveRef("motion", motionRef, path, "motion") : undefined,
        sides,
      };
    });
    const byeTeamIds = childElements(element, "bye").flatMap((byeElement) => {
      const ref = ownText(byeElement) || attr(byeElement, "team");
      const path = `${roundPath} › bye`;
      if (!ref) {
        log.error(path, "The bye has no team.");
        return [];
      }
      const teamId = resolveRef("team", ref, path, "team");
      if (!teamId) return [];
      if (busyTeams.has(teamId)) log.error(path, `Team "${teamById.get(teamId)?.name}" appears more than once in this round.`);
      busyTeams.add(teamId);
      return [teamId];
    });
    return {
      name: name || `Round ${roundIndex + 1}`,
      abbreviation: attr(element, "abbreviation"),
      elimination: isTrue(attr(element, "elimination")),
      feedbackWeight: number(element, "feedback-weight", roundPath),
      breakCategoryId: breakRef ? resolveRef("breakCategory", breakRef, roundPath, "break category") : undefined,
      divisionId: divisionRef ? resolveRef("division", divisionRef, roundPath, "division") : undefined,
      silent: isTrue(attr(element, "silent")),
      debates,
      byeTeamIds,
    };
  });

  /* --------------------------- format and rules -------------------------- */

  const styleAttribute = attr(root, "style");
  const sideCounts = new Set(rawRounds.flatMap((round) => round.debates.map((debate) => debate.sides.length)));
  let format: TournamentFormat = styleAttribute && STYLES[styleAttribute]
    ? STYLES[styleAttribute]
    : sideCounts.has(4) ? "bp" : "custom_2team";
  if (styleAttribute && !STYLES[styleAttribute]) {
    log.warning("tournament", `Unknown style "${styleAttribute.slice(0, 20)}"; the format is inferred from the debates.`);
  }
  if (format !== "bp" && sideCounts.has(4) && !sideCounts.has(2)) format = "bp";
  const sides = ballotSides(format);
  for (const round of rawRounds) {
    for (const debate of round.debates) {
      if (debate.sides.length !== sides.length) {
        log.error(debate.path, `A ${format === "bp" ? "BP" : "two-team"} debate needs ${sides.length} teams; this one has ${debate.sides.length}.`);
      }
    }
  }

  const allSides = rawRounds.flatMap((round) => round.debates.flatMap((debate) => debate.sides));
  const allSpeeches = allSides.flatMap((side) => side.speeches);
  const preferences = defaultPreferences(format);
  if (allSpeeches.length > 0) {
    const substantive = Math.max(0, ...allSides.map((side) => side.speeches.filter((speech) => !speech.reply).length));
    if (substantive > 0) preferences.substantiveSpeakers = substantive;
    preferences.replyScoresEnabled = format !== "bp" && allSpeeches.some((speech) => speech.reply);
  }
  const widen = (values: number[], minKey: "minSpeakerScore" | "minReplyScore", maxKey: "maxSpeakerScore" | "maxReplyScore") => {
    if (values.length === 0) return;
    const low = Math.min(...values);
    const high = Math.max(...values);
    if (low < preferences[minKey] || high > preferences[maxKey]) {
      preferences[minKey] = Math.min(preferences[minKey], Math.floor(low));
      preferences[maxKey] = Math.max(preferences[maxKey], Math.ceil(high));
    }
  };
  const scoresOf = (reply: boolean) =>
    allSpeeches.filter((speech) => speech.reply === reply).flatMap((speech) => [...speech.scores.values()]);
  widen(scoresOf(false), "minSpeakerScore", "maxSpeakerScore");
  widen(scoresOf(true), "minReplyScore", "maxReplyScore");
  notes.push(
    `Speaker scores ${preferences.minSpeakerScore}–${preferences.maxSpeakerScore}` +
      (preferences.replyScoresEnabled ? `, reply scores ${preferences.minReplyScore}–${preferences.maxReplyScore}` : "") +
      `, ${preferences.substantiveSpeakers} substantive speakers per team. Check these in Configuration after importing.`
  );
  if (teamQuestions.length || adjudicatorQuestions.length) {
    preferences.teamFeedbackQuestions = teamQuestions;
    preferences.adjudicatorFeedbackQuestions = adjudicatorQuestions;
  }
  const rules: BallotRules = { format, preferences };

  /* ------------------------- debates and ballots ------------------------- */

  const rounds: Round[] = [];
  const debates: Debate[] = [];
  const ballots: BallotSubmission[] = [];
  const motionRounds = new Map<string, Set<string>>();
  let usesVoting = false;

  rawRounds.forEach((rawRound, roundIndex) => {
    const seq = roundIndex + 1;
    const roundId = `round-${seq}`;
    const roundDebates: Debate[] = [];
    let allResulted = true;
    rawRound.debates.forEach((raw, debateIndex) => {
      if (raw.sides.length !== sides.length) return;
      const teamIds: SideRecord<string> = Object.fromEntries(sides.map((side, index) => [side, raw.sides[index].teamId]));
      const motion = raw.motionId ? motionById.get(raw.motionId) : undefined;
      if (motion) motionRounds.set(motion.id, (motionRounds.get(motion.id) ?? new Set()).add(roundId));
      const result = buildBallot(raw, sides, teamIds, rules, speakerNames, log);
      if (result?.sheets) usesVoting = true;
      const ballot: BallotSubmission | undefined = result
        ? {
            id: `ballot-${raw.id}`,
            tournamentId,
            roundId,
            debateId: raw.id,
            version: 1,
            confirmed: true,
            discarded: false,
            submitterType: "tabroom",
            submitterName: "DebateXML import",
            ...(motion ? { motionId: motion.id, motionText: motion.text } : {}),
            speakerScores: result.speakerScores,
            teamScores: result.teamScores,
            ...(result.chairId ? { chairId: result.chairId } : {}),
            ...(result.sheets ? { sheets: result.sheets } : {}),
            timestamp: now,
            confirmedBy: "DebateXML import",
            confirmedTimestamp: now,
          }
        : undefined;
      if (ballot) ballots.push(ballot);
      else allResulted = false;
      const panel = raw.adjudicatorIds.filter((id) => id !== raw.chairId);
      const panellistIds = panel.filter((id) => !adjudicatorById.get(id)?.trainee);
      const traineeIds = panel.filter((id) => adjudicatorById.get(id)?.trainee);
      const venue = raw.venueId ? venueById.get(raw.venueId) : undefined;
      const slots = Object.fromEntries(sides.map((side, index): [DebateSide, DebateTeamSlot] => {
        const teamId = raw.sides[index].teamId;
        const teamScore = ballot?.teamScores[side];
        return [side, {
          teamId,
          teamName: teamById.get(teamId)?.name ?? "",
          side,
          ...(teamScore ? { points: teamScore.points, speakerScoreTotal: teamScore.totalSpeakerScore } : {}),
        }];
      })) as Debate["teams"];
      roundDebates.push({
        id: raw.id,
        tournamentId,
        roundId,
        roundSeq: seq,
        ...(rawRound.breakCategoryId ? { breakCategoryId: rawRound.breakCategoryId } : {}),
        ...(venue ? { venueId: venue.id, venueName: venue.name } : {}),
        bracket: 0,
        roomRank: debateIndex + 1,
        importance: 0,
        resultStatus: ballot ? "confirmed" : "none",
        sidesConfirmed: true,
        flags: [],
        teams: slots,
        adjudicators: {
          ...(raw.chairId ? { chairId: raw.chairId, chairName: adjudicatorById.get(raw.chairId)?.name } : {}),
          panellistIds,
          panellistNames: panellistIds.map((id) => adjudicatorById.get(id)?.name ?? ""),
          traineeIds,
          traineeNames: traineeIds.map((id) => adjudicatorById.get(id)?.name ?? ""),
        },
        ...(motion ? { motionId: motion.id, motionText: motion.text } : {}),
      });
    });
    rawRound.byeTeamIds.forEach((teamId, byeIndex) => {
      const side = sides[0];
      roundDebates.push({
        id: `bye-${roundId}-${byeIndex + 1}`,
        tournamentId,
        roundId,
        roundSeq: seq,
        ...(rawRound.breakCategoryId ? { breakCategoryId: rawRound.breakCategoryId } : {}),
        venueName: "Bye",
        bracket: 0,
        roomRank: roundDebates.length + 1,
        importance: 0,
        resultStatus: "confirmed",
        sidesConfirmed: true,
        flags: rawRound.elimination ? ["bye", "elimination_bye"] : ["bye"],
        byeTeamId: teamId,
        byeResult: preferences.byeTeamResults ?? "absent",
        teams: { [side]: { teamId, teamName: teamById.get(teamId)?.name ?? "", side } } as Debate["teams"],
        adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
      });
      counts.byes += 1;
    });
    debates.push(...roundDebates);
    const hasDraw = roundDebates.length > 0;
    rounds.push({
      id: roundId,
      tournamentId,
      seq,
      name: rawRound.name,
      abbreviation: rawRound.abbreviation ?? (rawRound.elimination ? rawRound.name.slice(0, 3).toUpperCase() : `R${seq}`),
      stage: rawRound.elimination ? "elimination" : "preliminary",
      drawType: rawRound.elimination ? "elimination" : "manual",
      drawStatus: hasDraw ? "confirmed" : "none",
      feedbackWeight: rawRound.feedbackWeight ?? 1,
      silent: rawRound.silent,
      motionsReleased: false,
      resultsReleased: false,
      ...(rawRound.breakCategoryId ? { breakCategoryIds: [rawRound.breakCategoryId] } : {}),
      ...(rawRound.divisionId ? { divisionId: rawRound.divisionId } : {}),
      completed: hasDraw && allResulted,
      createdAt: now,
    });
  });
  if (usesVoting) preferences.ballotMode = "voting";
  for (const motion of motions) motion.rounds = [...(motionRounds.get(motion.id) ?? [])];

  /* ------------------------------- feedback ------------------------------ */

  if (pendingFeedback.length > LIMITS.feedback) {
    log.error("file", `The file has ${pendingFeedback.length} feedback submissions; at most ${LIMITS.feedback} are supported.`);
  }
  const debateById = new Map(debates.map((debate) => [debate.id, debate]));
  const feedback: FeedbackSubmission[] = [];
  const feedbackScores: number[] = [];
  pendingFeedback.slice(0, LIMITS.feedback).forEach(({ element, targetId, path }, index) => {
    const teamRef = attr(element, "source-team");
    const adjudicatorRef = attr(element, "source-adjudicator");
    if (Boolean(teamRef) === Boolean(adjudicatorRef)) {
      log.error(path, "Feedback needs exactly one of source-team or source-adjudicator.");
      return;
    }
    const sourceType = teamRef ? "team" : "adjudicator";
    const sourceId = teamRef
      ? resolveRef("team", teamRef, path, "team")
      : resolveRef("adjudicator", adjudicatorRef!, path, "adjudicator");
    const debateRef = attr(element, "debate");
    const debateId = debateRef ? resolveRef("debate", debateRef, path, "debate") : undefined;
    if (!debateRef) log.error(path, "Feedback has no debate.");
    const score = number(element, "score", path);
    if (score === undefined) log.error(path, "Feedback has no score.");
    const debate = debateId ? debateById.get(debateId) : undefined;
    if (!sourceId || !debate || score === undefined) return;
    feedbackScores.push(score);
    const answers: Record<string, FeedbackAnswer> = {};
    for (const answerElement of childElements(element, "answer")) {
      const questionRef = attr(answerElement, "question") ?? "";
      const questionId = ids.resolve("question", questionRef);
      const type = questionId ? questionTypes[sourceType].get(questionId) : undefined;
      if (!questionId || !type) {
        log.warning(path, `An answer to unknown question "${questionRef.slice(0, 40)}" was skipped.`);
        continue;
      }
      answers[questionId] = coerceAnswer(ownText(answerElement), type);
    }
    const target = adjudicatorById.get(targetId);
    feedback.push({
      id: `feedback-${index + 1}`,
      tournamentId,
      roundId: debate.roundId,
      debateId: debate.id,
      targetType: "adjudicator",
      targetAdjudicatorId: targetId,
      ...(target ? { targetAdjudicatorName: target.name } : {}),
      sourceType,
      sourceId,
      sourceName: (sourceType === "team" ? teamById.get(sourceId)?.name : adjudicatorById.get(sourceId)?.name) ?? "",
      score,
      ...(Object.keys(answers).length ? { answers } : {}),
      confirmed: true,
      ...(isTrue(attr(element, "ignored")) ? { ignored: true } : {}),
      timestamp: now,
    });
  });
  if (feedbackScores.length > 0) {
    const low = Math.min(...feedbackScores);
    const high = Math.max(...feedbackScores);
    if (low < preferences.feedbackMinScore || high > preferences.feedbackMaxScore) {
      preferences.feedbackMinScore = Math.min(preferences.feedbackMinScore, Math.floor(low));
      preferences.feedbackMaxScore = Math.max(preferences.feedbackMaxScore, Math.ceil(high));
      notes.push(`Feedback scale widened to ${preferences.feedbackMinScore}–${preferences.feedbackMaxScore} to fit the imported scores.`);
    }
  }

  /* ------------------------------- summary ------------------------------- */

  if (teams.length === 0) log.error("participants", "The file has no teams.");
  notes.push("Draws, motions and results are imported unreleased. Release them from each round when ready.");
  notes.push("Private URLs, emails and check-ins are not part of DebateXML; set them up after importing.");

  Object.assign(counts, {
    institutions: institutions.length,
    teams: teams.length,
    adjudicators: adjudicators.length,
    venues: venues.length,
    motions: motions.length,
    breakCategories: breakCategories.length,
    rounds: rounds.length,
    debates: debates.length - counts.byes,
    ballots: ballots.length,
    votingBallots: ballots.filter((ballot) => ballot.sheets).length,
    feedback: feedback.length,
    feedbackQuestions: teamQuestions.length + adjudicatorQuestions.length,
  });

  const result: DebateXmlImportResult = {
    issues: log.finish(),
    counts,
    suggestedName,
    suggestedShortName,
    notes,
  };
  if (log.hasErrors) return result;

  const name = (options.identity.name ?? suggestedName).trim() || "Imported tournament";
  const shortName = (options.identity.shortName ?? suggestedShortName).trim() || name;
  result.data = {
    tournament: {
      id: tournamentId,
      name,
      nameLower: name.toLowerCase(),
      shortName: shortName.slice(0, 15),
      slug: options.identity.slug,
      format,
      active: true,
      ownerId: options.identity.ownerId,
      admins: { [options.identity.ownerId]: true },
      preferences,
      createdAt: now,
      updatedAt: now,
    },
    collections: {
      rounds,
      teams,
      adjudicators,
      venues,
      motions,
      breakCategories,
      debates,
      ballots,
      feedback,
      institutions,
    },
  };
  return result;
}

function coerceAnswer(text: string, type: FeedbackQuestionType): FeedbackAnswer {
  if (type === "yes_no") return text === "true" || text === "1" ? true : text === "false" || text === "0" ? false : text;
  if (type === "scale") {
    const value = Number(text);
    return text !== "" && Number.isFinite(value) ? value : text;
  }
  if (type === "select_many") return text ? text.split(", ") : [];
  return text;
}

interface BuiltBallot {
  speakerScores: Record<DebateSide, SpeakerScoreEntry[]>;
  teamScores: Record<DebateSide, TeamScoreEntry>;
  chairId?: string;
  sheets?: AdjudicatorSheet[];
}

/**
 * Rebuilds a debate's result. One scoresheet is a consensus ballot; several scoresheets in a
 * two-team debate are a voting ballot (one sheet per adjudicator, aggregated by majority).
 */
function buildBallot(
  raw: RawDebate,
  sides: DebateSide[],
  teamIds: SideRecord<string>,
  rules: BallotRules,
  speakerNames: Map<string, string>,
  log: IssueLog
): BuiltBallot | undefined {
  const keys = [...new Set(raw.sides.flatMap((side) => [
    ...side.ballots.map((ballot) => ballot.key),
    ...side.speeches.flatMap((speech) => [...speech.scores.keys()]),
  ]))];
  if (keys.length === 0) return undefined;

  const speakerScoresFor = (key: string, strict: boolean): Record<DebateSide, SpeakerScoreEntry[]> | undefined => {
    const result = {} as Record<DebateSide, SpeakerScoreEntry[]>;
    let complete = true;
    sides.forEach((side, index) => {
      result[side] = raw.sides[index].speeches.flatMap((speech, speechIndex) => {
        const score = speech.scores.get(key) ?? (strict ? undefined : [...speech.scores.values()][0]);
        if (score === undefined) {
          log.error(speech.path, "The speech has no score on one of the debate's ballots.");
          complete = false;
          return [];
        }
        return [{
          speakerId: speech.speakerId,
          speakerName: speakerNames.get(speech.speakerId) ?? "",
          position: speechIndex + 1,
          score,
          ...(speech.ghost && !speech.reply ? { ghost: true } : {}),
        }];
      });
    });
    return complete ? result : undefined;
  };

  if (keys.length > 1) {
    if (rules.format === "bp") {
      log.error(raw.path, "BP debates must have a single consensus ballot.");
      return undefined;
    }
    const sheets: AdjudicatorSheet[] = [];
    for (const key of keys) {
      const adjudicatorId = resolveBallotAdjudicator(key, raw);
      if (!adjudicatorId) {
        log.error(raw.path, `A ballot is not linked to exactly one of the debate's adjudicators ("${key.slice(0, 60)}").`);
        return undefined;
      }
      const speakerScores = speakerScoresFor(key, true);
      if (!speakerScores) return undefined;
      sheets.push({ adjudicatorId, speakerScores });
    }
    try {
      const voting = aggregateVotingSheets(sheets, raw.chairId, teamIds, rules);
      return { speakerScores: voting.speakerScores, teamScores: voting.teamScores, chairId: raw.chairId, sheets };
    } catch (error) {
      log.error(raw.path, error instanceof Error ? error.message : "The voting ballots could not be combined.");
      return undefined;
    }
  }

  const key = keys[0];
  const speakerScores = speakerScoresFor(key, false);
  if (!speakerScores) return undefined;
  const ranks: SideRecord<number> = {};
  sides.forEach((side, index) => {
    const ballot = raw.sides[index].ballots.find((candidate) => candidate.key === key) ?? raw.sides[index].ballots[0];
    if (ballot?.rank !== undefined) ranks[side] = ballot.rank;
    else if (rules.format === "bp" && ballot?.points !== undefined && [0, 1, 2, 3].includes(ballot.points)) {
      ranks[side] = 4 - ballot.points;
    }
  });
  if (Object.keys(ranks).length !== sides.length) {
    if (rules.format === "bp") {
      log.error(raw.path, "Every team in a BP result needs a rank.");
      return undefined;
    }
    // Two-team ballots without ranks: the higher total wins.
    const totals = consensusTeamScores(speakerScores, { [sides[0]]: 1, [sides[1]]: 2 }, teamIds, rules);
    const first = totals[sides[0]].totalSpeakerScore;
    const second = totals[sides[1]].totalSpeakerScore;
    if (first === second) {
      log.error(raw.path, "The result has no ranks and the team totals are tied, so the winner is unknown.");
      return undefined;
    }
    ranks[sides[0]] = first > second ? 1 : 2;
    ranks[sides[1]] = first > second ? 2 : 1;
  }
  const rankValues = sides.map((side) => ranks[side]).sort();
  if (rankValues.some((rank, index) => rank !== index + 1)) {
    log.error(raw.path, `The ranks must be 1 to ${sides.length}, each used once.`);
    return undefined;
  }
  const teamScores = consensusTeamScores(speakerScores, ranks, teamIds, rules);
  return {
    speakerScores,
    teamScores,
    chairId: consensusChair(key, raw),
  };
}

/** Ballot keys are space-separated CrabbyTab adjudicator ids (resolved while reading the file). */
function keyIds(key: string): string[] {
  return key.split(" ").filter(Boolean);
}

/** A voting scoresheet belongs to exactly one adjudicator on the debate's panel. */
function resolveBallotAdjudicator(key: string, raw: RawDebate): string | undefined {
  const keyed = keyIds(key);
  return keyed.length === 1 && raw.adjudicatorIds.includes(keyed[0]) ? keyed[0] : undefined;
}

/** A consensus ballot may list the whole panel; the chair is recorded when they signed it. */
function consensusChair(key: string, raw: RawDebate): string | undefined {
  const keyed = keyIds(key);
  if (raw.chairId && (keyed.length === 0 || keyed.includes(raw.chairId))) return raw.chairId;
  return keyed[0] ?? raw.chairId;
}
