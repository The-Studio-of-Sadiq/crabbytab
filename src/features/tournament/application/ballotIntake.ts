import { diffBallots, usesVotingBallots, type BallotRules } from "@/lib/ballots/result";
import { checkBallotIntake, enforceGuards } from "@/features/tournament/application/stateGuards";
import type { Adjudicator, BallotIntakeRecord, BallotSubmission, Debate, Round, TournamentFormat } from "@/types";

/**
 * Paper-ballot intake: printed ballot sheets carry a barcode, the tab room scans each sheet as it
 * arrives, and a round status board shows which debates still have paper or entry outstanding.
 * Pure functions, kept free of React and storage. See docs/ballot-intake.md.
 */

/*
 * Sheet ids look like `B3-4K7M2QXZ`: "B", the round number, a dash, then an 8-character code. The
 * code is 7 characters of a hash of the debate and adjudicator ids plus a check character. Only
 * the code identifies the sheet; the round prefix is for people reading the paper.
 *
 * The alphabet leaves out I, L, O, U and Y, so a typed code cannot confuse I/L with 1 or O with 0
 * (those are read as digits). It has 31 characters, a prime, so the weighted check character
 * catches every single wrong character and every swap of two neighbouring characters.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXZ";
const BASE = ALPHABET.length;
const HASH_LENGTH = 7;
const CODE_LENGTH = HASH_LENGTH + 1;

/** cyrb53: a small, well-mixed 53-bit string hash. Not cryptographic; it only spreads ids. */
function hash53(value: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index++) {
    const character = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ character, 2654435761);
    h2 = Math.imul(h2 ^ character, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function checkCharacter(hashPart: string): string {
  let sum = 0;
  for (let index = 0; index < hashPart.length; index++) {
    sum += (index + 1) * ALPHABET.indexOf(hashPart[index]);
  }
  return ALPHABET[sum % BASE];
}

/** The stable code of a debate's sheet, or of one voting adjudicator's sheet in that debate. */
export function ballotSheetCode(debateId: string, adjudicatorId?: string): string {
  let remaining = hash53(`ballot|${debateId}|${adjudicatorId ?? ""}`) % BASE ** HASH_LENGTH;
  let hashPart = "";
  for (let index = 0; index < HASH_LENGTH; index++) {
    hashPart = ALPHABET[remaining % BASE] + hashPart;
    remaining = Math.floor(remaining / BASE);
  }
  return hashPart + checkCharacter(hashPart);
}

export function ballotSheetId(roundSeq: number, code: string): string {
  return `B${roundSeq}-${code}`;
}

/** The intake record id for a sheet: one per sheet, whichever device scans it. */
export function intakeRecordId(code: string): string {
  return `intake-${code}`;
}

export type ParsedSheetInput =
  | { ok: true; code: string; roundSeq?: number }
  | { ok: false; message: string };

/**
 * Reads a scanned or typed sheet id. Accepts the full id or the code alone, in any case, with
 * spaces or scanner start/stop asterisks, and reads O as 0 and I or L as 1.
 */
export function parseSheetInput(raw: string): ParsedSheetInput {
  const compact = raw.replace(/[\s*]/g, "").toUpperCase();
  if (!compact) return { ok: false, message: "Enter or scan a ballot sheet id." };
  const match = compact.match(/^(?:B(\d{1,3})-?)?([0-9A-Z]{8})$/);
  if (!match) {
    return { ok: false, message: `"${raw.trim()}" is not a ballot sheet id. Sheet ids look like B3-4K7M2QXZ.` };
  }
  const code = match[2].replace(/O/g, "0").replace(/[IL]/g, "1");
  if ([...code].some((character) => !ALPHABET.includes(character))) {
    return { ok: false, message: `"${raw.trim()}" is not a ballot sheet id. Check the characters against the printed id.` };
  }
  if (checkCharacter(code.slice(0, HASH_LENGTH)) !== code[HASH_LENGTH]) {
    return { ok: false, message: `"${raw.trim()}" fails its check character, so it was probably mistyped. Check it against the sheet.` };
  }
  return { ok: true, code, ...(match[1] ? { roundSeq: Number(match[1]) } : {}) };
}

/* -------------------------------------------------------------------------- */
/* Sheets                                                                      */
/* -------------------------------------------------------------------------- */

export interface BallotSheet {
  sheetId: string;
  code: string;
  roundId: string;
  roundSeq: number;
  debateId: string;
  /** Voting ballots: whose sheet this is. Absent for the debate's single (consensus) sheet. */
  adjudicatorId?: string;
  /** The adjudicator expected to fill it in: the voter, or the chair for a single sheet. */
  adjudicatorName?: string;
}

/**
 * One sheet per voting adjudicator, or one per debate. Read through this (not the raw preference)
 * so ballot-mode resolution stays in `usesVotingBallots`.
 */
export function usesPerAdjudicatorSheets(rules: BallotRules): boolean {
  return usesVotingBallots(rules);
}

function voterIds(debate: Pick<Debate, "adjudicators">): string[] {
  return [debate.adjudicators?.chairId, ...(debate.adjudicators?.panellistIds || [])]
    .filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index);
}

function sheetFor(
  debate: Pick<Debate, "id" | "roundId" | "roundSeq">,
  adjudicatorId: string | undefined,
  adjudicatorName: string | undefined
): BallotSheet {
  const code = ballotSheetCode(debate.id, adjudicatorId);
  return {
    sheetId: ballotSheetId(debate.roundSeq, code),
    code,
    roundId: debate.roundId,
    roundSeq: debate.roundSeq,
    debateId: debate.id,
    ...(adjudicatorId ? { adjudicatorId } : {}),
    ...(adjudicatorName ? { adjudicatorName } : {}),
  };
}

/**
 * The sheets the tab room expects back for a debate: one per voting adjudicator (chair first) for
 * voting ballots, else one for the debate. A bye has none. A voting panel with no adjudicators
 * yet gets one debate sheet, so the paper can still be tracked.
 */
export function expectedBallotSheets(
  debate: Pick<Debate, "id" | "roundId" | "roundSeq" | "byeTeamId" | "adjudicators">,
  adjudicators: Pick<Adjudicator, "id" | "name">[],
  perAdjudicator: boolean
): BallotSheet[] {
  if (debate.byeTeamId) return [];
  const names = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator.name]));
  const voters = voterIds(debate);
  if (perAdjudicator && voters.length > 0) {
    return voters.map((id) => sheetFor(debate, id, names.get(id) || id));
  }
  const chairId = debate.adjudicators?.chairId;
  return [sheetFor(debate, undefined, chairId ? names.get(chairId) || chairId : undefined)];
}

export interface BallotSheetIndex {
  byCode: Map<string, BallotSheet>;
  /** Codes shared by two different sheets (astronomically rare); scans of these are refused. */
  ambiguousCodes: Set<string>;
}

/**
 * Every sheet that may have been printed for these debates: the debate sheet and each voter's
 * sheet, whatever the current ballot mode, so paper printed before a mode change still resolves.
 */
export function buildBallotSheetIndex(
  debates: Pick<Debate, "id" | "roundId" | "roundSeq" | "byeTeamId" | "adjudicators">[],
  adjudicators: Pick<Adjudicator, "id" | "name">[]
): BallotSheetIndex {
  const byCode = new Map<string, BallotSheet>();
  const ambiguousCodes = new Set<string>();
  const add = (sheet: BallotSheet) => {
    const existing = byCode.get(sheet.code);
    if (existing && (existing.debateId !== sheet.debateId || existing.adjudicatorId !== sheet.adjudicatorId)) {
      ambiguousCodes.add(sheet.code);
      return;
    }
    byCode.set(sheet.code, sheet);
  };
  for (const debate of debates) {
    if (debate.byeTeamId) continue;
    for (const sheet of expectedBallotSheets(debate, adjudicators, false)) add(sheet);
    for (const sheet of expectedBallotSheets(debate, adjudicators, true)) add(sheet);
  }
  return { byCode, ambiguousCodes };
}

/* -------------------------------------------------------------------------- */
/* Scanning                                                                    */
/* -------------------------------------------------------------------------- */

export type IntakeScanOutcome =
  | { kind: "invalid"; message: string }
  | { kind: "unknown"; message: string }
  | { kind: "blocked"; sheet: BallotSheet; message: string }
  | { kind: "wrong_round"; sheet: BallotSheet; message: string }
  | { kind: "duplicate"; sheet: BallotSheet; existing: BallotIntakeRecord; message: string }
  | { kind: "accepted"; sheet: BallotSheet; message: string };

function roundLabel(round: Pick<Round, "name"> | undefined, seq: number): string {
  return round?.name || `Round ${seq}`;
}

function sheetLabel(sheet: BallotSheet, debate: Pick<Debate, "venueName" | "roomRank"> | undefined): string {
  const room = debate?.venueName || (debate ? `Room ${debate.roomRank}` : "this debate");
  return sheet.adjudicatorId ? `${room} (${sheet.adjudicatorName || "adjudicator"})` : room;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * What scanning `input` during intake for `roundId` means. Only "accepted" should be recorded;
 * a re-scan of a received sheet is reported, not recorded again.
 */
export function resolveIntakeScan(input: {
  input: string;
  roundId: string;
  index: BallotSheetIndex;
  intake: BallotIntakeRecord[];
  /** All rounds, including cancelled ones, so their sheets get a clear message. */
  rounds: Pick<Round, "id" | "name" | "cancelled">[];
  debates: Pick<Debate, "id" | "venueName" | "roomRank">[];
}): IntakeScanOutcome {
  const parsed = parseSheetInput(input.input);
  if (!parsed.ok) return { kind: "invalid", message: parsed.message };
  if (input.index.ambiguousCodes.has(parsed.code)) {
    return { kind: "unknown", message: `Sheet ${parsed.code} matches more than one debate. Find the debate on the board and enter its ballot directly.` };
  }
  const sheet = input.index.byCode.get(parsed.code);
  if (!sheet) {
    return {
      kind: "unknown",
      message: `No current debate has sheet ${parsed.code}. It may be from a draw or panel that has since changed; reprint ballots for the round.`,
    };
  }
  const round = input.rounds.find((item) => item.id === sheet.roundId);
  const debate = input.debates.find((item) => item.id === sheet.debateId);
  const label = sheetLabel(sheet, debate);
  const blocker = checkBallotIntake(round as Round | undefined, sheet.debateId)[0];
  if (blocker) return { kind: "blocked", sheet, message: `${label}: ${blocker.message} Its ballot was not recorded.` };
  if (sheet.roundId !== input.roundId) {
    return {
      kind: "wrong_round",
      sheet,
      message: `This sheet is for ${roundLabel(round, sheet.roundSeq)} (${label}), not the round being received. Switch rounds to record it.`,
    };
  }
  const existing = input.intake.find((record) => record.id === intakeRecordId(sheet.code));
  if (existing) {
    const by = existing.receivedByName ? ` by ${existing.receivedByName}` : "";
    return { kind: "duplicate", sheet, existing, message: `${label} was already received at ${formatTime(existing.receivedAt)}${by}. Nothing changed.` };
  }
  return { kind: "accepted", sheet, message: `Received ${label}.` };
}

/** The receipt record for an accepted sheet. Throws a rule error for a cancelled round. */
export function createIntakeRecord(input: {
  sheet: BallotSheet;
  round: Round | undefined;
  tournamentId: string;
  receivedAt: string;
  receivedBy?: string;
  receivedByName?: string;
}): BallotIntakeRecord {
  enforceGuards(checkBallotIntake(input.round, input.sheet.debateId));
  return {
    id: intakeRecordId(input.sheet.code),
    tournamentId: input.tournamentId,
    roundId: input.sheet.roundId,
    debateId: input.sheet.debateId,
    sheetCode: input.sheet.code,
    ...(input.sheet.adjudicatorId ? { adjudicatorId: input.sheet.adjudicatorId } : {}),
    receivedAt: input.receivedAt,
    ...(input.receivedBy ? { receivedBy: input.receivedBy } : {}),
    ...(input.receivedByName ? { receivedByName: input.receivedByName } : {}),
  };
}

/**
 * Adds a receipt unless the sheet is already recorded; the first receipt is kept, so re-scans and
 * the same sheet scanned on two devices leave one record.
 */
export function addIntakeRecord(
  intake: BallotIntakeRecord[],
  record: BallotIntakeRecord
): { intake: BallotIntakeRecord[]; added: boolean } {
  if (intake.some((item) => item.id === record.id)) return { intake, added: false };
  return { intake: [...intake, record], added: true };
}

/* -------------------------------------------------------------------------- */
/* Round status board                                                          */
/* -------------------------------------------------------------------------- */

export type DebateIntakeStatus =
  /** No paper and no ballot. */
  | "missing"
  /** Voting ballots: some, not all, adjudicators' sheets have arrived. */
  | "partial"
  /** All paper has arrived; nothing entered yet. */
  | "received"
  /** An unconfirmed version exists (double entry off). */
  | "entered"
  /** An unconfirmed version is waiting for a second person's check (double entry on). */
  | "awaiting_check"
  | "confirmed"
  /** No confirmed result, and either every entered version was discarded or two pending versions disagree. */
  | "disputed";

export const INTAKE_STATUS_ORDER: DebateIntakeStatus[] = [
  "missing", "partial", "received", "entered", "awaiting_check", "disputed", "confirmed",
];

export const INTAKE_STATUS_LABELS: Record<DebateIntakeStatus, string> = {
  missing: "Missing",
  partial: "Partly received",
  received: "Received",
  entered: "Entered",
  awaiting_check: "Awaiting check",
  disputed: "Disputed",
  confirmed: "Confirmed",
};

export interface DebateIntakeRow {
  debateId: string;
  status: DebateIntakeStatus;
  expectedSheets: BallotSheet[];
  /** Expected sheets whose paper has arrived. */
  receivedSheets: BallotSheet[];
  missingSheets: BallotSheet[];
  lastReceivedAt?: string;
  /** Unconfirmed, undiscarded versions, newest first. */
  pendingVersions: number[];
  confirmedVersion?: number;
  /** Why the debate is disputed, when it is. */
  disputeReason?: string;
}

export function debateIntakeRow(input: {
  debate: Pick<Debate, "id" | "roundId" | "roundSeq" | "byeTeamId" | "adjudicators">;
  adjudicators: Pick<Adjudicator, "id" | "name">[];
  /** Receipts for this debate (others are ignored). */
  intake: BallotIntakeRecord[];
  /** Ballot versions for this debate (others are ignored). */
  ballots: BallotSubmission[];
  perAdjudicator: boolean;
  doubleEntry: boolean;
  format: TournamentFormat;
}): DebateIntakeRow {
  const { debate } = input;
  const expectedSheets = expectedBallotSheets(debate, input.adjudicators, input.perAdjudicator);
  const records = input.intake.filter((record) => record.debateId === debate.id);
  // A debate-level sheet holds the whole result, so it covers every voter's sheet too.
  const wholeDebateReceived = records.some((record) => !record.adjudicatorId);
  const receivedAdjudicators = new Set(records.map((record) => record.adjudicatorId).filter(Boolean));
  const isReceived = (sheet: BallotSheet) =>
    sheet.adjudicatorId
      ? wholeDebateReceived || receivedAdjudicators.has(sheet.adjudicatorId)
      : records.length > 0;
  const receivedSheets = expectedSheets.filter(isReceived);
  const missingSheets = expectedSheets.filter((sheet) => !isReceived(sheet));
  const lastReceivedAt = records.map((record) => record.receivedAt).sort().at(-1);

  const versions = input.ballots.filter((ballot) => ballot.debateId === debate.id);
  const confirmed = versions.find((ballot) => ballot.confirmed && !ballot.discarded);
  const pending = versions
    .filter((ballot) => !ballot.confirmed && !ballot.discarded)
    .sort((left, right) => (right.version || 0) - (left.version || 0));
  const discarded = versions.filter((ballot) => ballot.discarded);

  let status: DebateIntakeStatus;
  let disputeReason: string | undefined;
  if (confirmed) {
    status = "confirmed";
  } else if (pending.length === 0 && discarded.length > 0) {
    status = "disputed";
    disputeReason = "Every entered version was discarded; the ballot needs entering again.";
  } else if (
    input.doubleEntry &&
    pending.length >= 2 &&
    pending.slice(1).some((other) => diffBallots(pending[0], other, input.format).length > 0)
  ) {
    status = "disputed";
    disputeReason = `Pending versions ${pending.map((ballot) => `v${ballot.version}`).join(", ")} disagree.`;
  } else if (pending.length > 0) {
    status = input.doubleEntry ? "awaiting_check" : "entered";
  } else if (expectedSheets.length > 0 && missingSheets.length === 0) {
    status = "received";
  } else {
    status = receivedSheets.length > 0 ? "partial" : "missing";
  }

  return {
    debateId: debate.id,
    status,
    expectedSheets,
    receivedSheets,
    missingSheets,
    ...(lastReceivedAt ? { lastReceivedAt } : {}),
    pendingVersions: pending.map((ballot) => ballot.version),
    ...(confirmed ? { confirmedVersion: confirmed.version } : {}),
    ...(disputeReason ? { disputeReason } : {}),
  };
}

/** Status rows for every non-bye debate of a round, in room order. */
export function roundIntakeRows(input: {
  roundId: string;
  debates: Debate[];
  adjudicators: Pick<Adjudicator, "id" | "name">[];
  intake: BallotIntakeRecord[];
  ballots: BallotSubmission[];
  perAdjudicator: boolean;
  doubleEntry: boolean;
  format: TournamentFormat;
}): DebateIntakeRow[] {
  const intakeByDebate = groupByDebate(input.intake);
  const ballotsByDebate = groupByDebate(input.ballots);
  return input.debates
    .filter((debate) => debate.roundId === input.roundId && !debate.byeTeamId)
    .sort((left, right) => left.roomRank - right.roomRank)
    .map((debate) => debateIntakeRow({
      debate,
      adjudicators: input.adjudicators,
      intake: intakeByDebate.get(debate.id) || [],
      ballots: ballotsByDebate.get(debate.id) || [],
      perAdjudicator: input.perAdjudicator,
      doubleEntry: input.doubleEntry,
      format: input.format,
    }));
}

function groupByDebate<T extends { debateId: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const list = grouped.get(item.debateId);
    if (list) list.push(item);
    else grouped.set(item.debateId, [item]);
  }
  return grouped;
}

export interface IntakeSummary {
  debates: number;
  counts: Record<DebateIntakeStatus, number>;
  sheetsExpected: number;
  sheetsReceived: number;
}

export function summarizeIntake(rows: DebateIntakeRow[]): IntakeSummary {
  const counts = Object.fromEntries(INTAKE_STATUS_ORDER.map((status) => [status, 0])) as Record<DebateIntakeStatus, number>;
  let sheetsExpected = 0;
  let sheetsReceived = 0;
  for (const row of rows) {
    counts[row.status] += 1;
    sheetsExpected += row.expectedSheets.length;
    sheetsReceived += row.receivedSheets.length;
  }
  return { debates: rows.length, counts, sheetsExpected, sheetsReceived };
}
