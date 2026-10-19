/**
 * The JSON both engines produce for a fixture. Tabbycat writes it from
 * `tabbycat/run_tabbycat.py`; CrabbyTab produces it in `crabbytab.ts`. Ids are the DebateXML ids
 * (T1, S1, A1, D1_1, BC1) and metric names are Tabbycat's, so outputs compare without mapping.
 */

export interface FixtureConfig {
  name: string;
  title: string;
  description: string;
  style: "bp" | "australs";
  format: "bp" | "two_team";
  seed: number;
  rounds: { played: number; total: number };
  drawRounds: number[];
  standingsAfterRounds: number[];
  allocationRound: number;
  /** Round seq (as a string) -> XML team ids unavailable in that round. */
  unavailableTeams: Record<string, string[]>;
  breakCategories: {
    id: string;
    name: string;
    general: boolean;
    breakSize: number;
    reserveSize: number;
    priority: number;
    rule: "standard";
  }[];
  tabbycatPreferences: Record<string, unknown>;
}

export interface StandingsTable<K extends "team" | "speaker"> {
  precedence: string[];
  minimumForRank?: number | null;
  rows: (Record<K, string> & { rank: number | null; metrics: Record<string, number | null> })[];
}

export interface StandingsSnapshot {
  afterRound: number;
  teams: StandingsTable<"team">;
  speakers: StandingsTable<"speaker">;
  replies?: StandingsTable<"speaker">;
}

export interface DrawDebate {
  bracket: number | null;
  roomRank: number;
  /** Side index: BP 0-3 = OG, OO, CG, CO; two-team 0 = affirmative, 1 = negative. */
  teams: { team: string; side: number; flags: string[] }[];
  flags: string[];
}

export interface DrawSample {
  error?: string;
  drawType?: string;
  debates?: DrawDebate[];
  byes?: string[];
}

export interface DrawResult extends DrawSample {
  round: number;
  /** The same round drawn with other seeds, to separate seed-to-seed variation from rule differences. */
  samples?: DrawSample[];
}

export interface BreakResult {
  category: string;
  rule: string;
  breakSize: number;
  reserveSize: number;
  error?: string;
  breaking?: { team: string; rank: number | null; breakRank: number | null }[];
  reserves?: { team: string; rank: number | null }[];
  /** Tabbycat remark codes: D = different break, C = capped, I = ineligible, ... */
  excluded?: { team: string; rank: number | null; remark: string }[];
}

export interface AllocationResult {
  round: number;
  allocator?: string;
  error?: string;
  warnings?: string[];
  debates?: { debate: string; chair: string | null; panellists: string[]; trainees: string[] }[];
}

export interface EngineOutput {
  fixture: string;
  engine: "tabbycat" | "crabbytab";
  engineVersion: string;
  /** Tabbycat: the effective preferences after the preset and fixture overrides. */
  preferences?: Record<string, unknown>;
  standings: StandingsSnapshot[];
  draws: DrawResult[];
  breaks: BreakResult[];
  allocation: AllocationResult;
}
