/**
 * The CrabbyTab side of the differential test: imports a fixture's DebateXML with the app's own
 * importer, applies the same configuration Tabbycat ran with, and computes standings, draws,
 * breaks and an allocation through the real libraries. Output matches `EngineOutput`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";

import { computeAutoAllocation } from "@/features/tournament/application/allocation";
import {
  importDebateXmlArchive,
  type ImportedTournamentCollections,
  type XmlElementLike,
  type XmlParser,
} from "@/features/tournament/application/debateXmlImport";
import { aggregateVotingSheets, consensusTeamScores, type BallotRules, type SideRecord } from "@/lib/ballots/result";
import { calculateBreaks } from "@/lib/breakqual/calculator";
import { generateRoundDraw } from "@/lib/draw/generator";
import { calculateStandings } from "@/lib/standings/calculator";
import type {
  BallotSubmission,
  BreakCategory,
  Debate,
  DebateSide,
  Round,
  SpeakerMetricId,
  SpeakerStandingRow,
  Team,
  TeamMetricId,
  Tournament,
  TournamentPreferences,
} from "@/types";
import type {
  AllocationResult,
  BreakResult,
  DrawResult,
  DrawSample,
  EngineOutput,
  FixtureConfig,
  StandingsSnapshot,
  StandingsTable,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Vocabulary: Tabbycat names <-> CrabbyTab names                             */
/* -------------------------------------------------------------------------- */

/** Tabbycat team metric -> CrabbyTab metric. Tabbycat metrics missing here have no CrabbyTab equivalent. */
export const TEAM_METRIC_MAP: Record<string, TeamMetricId> = {
  points: "points",
  wins: "wins",
  speaks_sum: "speaks_sum",
  speaks_avg: "speaks_avg",
  speaks_ind_avg: "speaks_ind_avg",
  speaks_stddev: "speaks_stddev",
  margin_sum: "margin_sum",
  margin_avg: "margin_avg",
  draw_strength: "draw_strength_wins",
  draw_strength_speaks: "draw_strength_speaks",
  firsts: "firsts",
  seconds: "seconds",
  thirds: "thirds",
  npullups: "pullups",
  num_adjs: "num_adjs",
  num_iron: "num_iron",
};

export const SPEAKER_METRIC_MAP: Record<string, SpeakerMetricId> = {
  total: "speaks_sum",
  average: "speaks_avg",
  stdev: "speaks_stddev",
  count: "speeches_count",
  trimmed_mean: "speaks_trimmed_mean",
};

/** Reply standings reuse the speaker metric ids, computed over reply scores. */
export const REPLY_METRIC_MAP: Record<string, SpeakerMetricId> = {
  replies_sum: "speaks_sum",
  replies_avg: "speaks_avg",
  replies_count: "speeches_count",
};

const invert = (map: Record<string, string>) => Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key]));
const TEAM_METRIC_NAMES = invert(TEAM_METRIC_MAP);
const SPEAKER_METRIC_NAMES = invert(SPEAKER_METRIC_MAP);

/** Draws per round: the primary one plus this many minus one with other seeds (as on the Tabbycat side). */
export const DRAW_SAMPLES = 8;

const BP_SIDES: DebateSide[] = ["OG", "OO", "CG", "CO"];
const TWO_TEAM_SIDES: DebateSide[] = ["AFF", "NEG"];

/**
 * Translates Tabbycat's effective preferences into CrabbyTab preferences. Every Tabbycat setting
 * the harness relies on is listed; a value CrabbyTab cannot express is reported in `unmapped`
 * (a configuration difference) instead of being silently dropped.
 */
export function translatePreferences(
  tabbycat: Record<string, unknown>,
  format: FixtureConfig["format"]
): { preferences: Partial<TournamentPreferences>; unmapped: string[] } {
  const unmapped: string[] = [];
  const preferences: Partial<TournamentPreferences> = {};
  const value = (key: string) => tabbycat[key];
  const pick = <T extends string>(key: string, table: Record<string, T>): T | undefined => {
    const raw = value(key);
    if (raw === undefined) return undefined;
    const mapped = table[String(raw)];
    if (mapped === undefined) unmapped.push(`${key}=${JSON.stringify(raw)}`);
    return mapped;
  };

  const teamPrecedence = (value("standings__team_standings_precedence") as string[] | undefined) ?? [];
  preferences.teamStandingsPrecedence = teamPrecedence.flatMap((metric) => {
    const mapped = TEAM_METRIC_MAP[metric];
    if (!mapped) unmapped.push(`team precedence metric ${metric}`);
    return mapped ? [mapped] : [];
  });
  const speakerPrecedence = (value("standings__speaker_standings_precedence") as string[] | undefined) ?? [];
  preferences.speakerStandingsPrecedence = speakerPrecedence.flatMap((metric) => {
    const mapped = SPEAKER_METRIC_MAP[metric];
    if (!mapped) unmapped.push(`speaker precedence metric ${metric}`);
    return mapped ? [mapped] : [];
  });
  const missed = Number(value("standings__standings_missed_debates"));
  if (Number.isFinite(missed) && missed >= 0) preferences.standingsMissedDebates = missed;
  const missedReplies = Number(value("standings__standings_missed_replies"));
  if (Number.isFinite(missedReplies) && missedReplies >= 0) preferences.standingsMissedReplies = missedReplies;

  preferences.byeTeamSelectionMethod = pick("draw_rules__bye_team_selection", {
    off: "none",
    lowest: "lowest_ranked",
    random: "random",
  } as const);
  preferences.byeTeamResults = pick("draw_rules__bye_team_results", { none: "absent", points: "win" } as const);
  preferences.avoidSameInstitution = Boolean(value("draw_rules__avoid_same_institution"));
  preferences.avoidTeamHistory = Boolean(value("draw_rules__avoid_team_history"));
  preferences.teamHistoryPenalty = Number(value("draw_rules__team_history_penalty"));
  preferences.teamInstitutionPenalty = Number(value("draw_rules__team_institution_penalty"));
  preferences.sideAllocationRule = pick("draw_rules__draw_side_allocations", {
    balance: "balanced",
    random: "random",
    preallocated: "preallocated",
    "manual-ballot": "manual_ballot",
  } as const);

  if (format === "bp") {
    preferences.bpPullupDistribution = pick("draw_rules__bp_pullup_distribution", {
      anywhere: "anywhere",
      one_room: "top",
    } as const);
    preferences.bpPositionCost = pick("draw_rules__bp_position_cost", {
      entropy: "renyi_entropy",
      variance: "sum_squared_deviations",
    } as const);
    preferences.bpAssignmentMethod = pick("draw_rules__bp_assignment_method", {
      hungarian: "hungarian",
      hungarian_preshuffled: "hungarian",
      random: "random",
    } as const);
    preferences.renyiOrder = Number(value("draw_rules__bp_renyi_order"));
    preferences.bpPositionCostExponent = Number(value("draw_rules__bp_position_cost_exponent"));
    preferences.pullupPenalty = Number(value("draw_rules__draw_pullup_penalty"));
  } else {
    preferences.oddBracketMethod = pick("draw_rules__draw_odd_bracket", {
      pullup_top: "pullup_top",
      pullup_bottom: "pullup_bottom",
      pullup_middle: "pullup_middle",
      pullup_random: "pullup_random",
      intermediate: "intermediate",
      intermediate_bubble_up_down: "intermediate_bubble",
      intermediate1: "intermediate1",
      intermediate2: "intermediate2",
    } as const);
    preferences.pairingMethod = pick("draw_rules__draw_pairing_method", {
      slide: "slide",
      fold: "fold",
      adjacent: "adjacent",
      random: "random",
      fold_top_adjacent_rest: "fold_top_adjacent_rest",
    } as const);
    preferences.conflictAvoidance = pick("draw_rules__draw_avoid_conflicts", {
      off: "off",
      one_up_one_down: "one_up_one_down",
      graph: "min_cost",
    } as const);
    preferences.pullupRestriction = pick("draw_rules__draw_pullup_restriction", {
      none: "none",
      least_to_date: "least_pulled",
      lowest_ds_speaks: "lowest_draw_strength_speaks",
      lowest_ds_wins: "lowest_draw_strength_wins",
    } as const);
    const maxTimes = Number(value("draw_rules__max_times_per_side"));
    if (Number.isFinite(maxTimes) && maxTimes > 0) preferences.maxTimesPerSide = maxTimes;
    preferences.pullupPenalty = Number(value("draw_rules__draw_pullup_penalty"));
  }

  if (value("debate_rules__ballots_per_debate_prelim") === "per-adj" && format !== "bp") preferences.ballotMode = "voting";
  const conflictPenalty = Number(value("draw_rules__adj_conflict_penalty"));
  if (Number.isFinite(conflictPenalty)) preferences.adjConflictPenalty = conflictPenalty;
  const minVotingScore = Number(value("draw_rules__adj_min_voting_score"));
  if (Number.isFinite(minVotingScore)) preferences.minAdjScoreToVote = minVotingScore;
  const historyPenalty = Number(value("draw_rules__adj_history_penalty"));
  if (Number.isFinite(historyPenalty)) preferences.adjHistoryPenalty = historyPenalty;
  preferences.marginIncludesDissenters = Boolean(value("scoring__margin_includes_dissenters"));
  preferences.teamScoreIncludesGhosts = Boolean(value("scoring__teamscore_includes_ghosts"));
  return { preferences, unmapped };
}

/* -------------------------------------------------------------------------- */
/* Fixture loading                                                            */
/* -------------------------------------------------------------------------- */

const parseXml: XmlParser = (text) => {
  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") throw new Error(message);
    },
  }).parseFromString(text, "application/xml");
  return document.documentElement as unknown as XmlElementLike;
};

export function loadFixtureConfig(fixtureDir: string): FixtureConfig {
  return JSON.parse(readFileSync(join(fixtureDir, "config.json"), "utf8")) as FixtureConfig;
}

interface LoadedFixture {
  config: FixtureConfig;
  tournament: Tournament;
  data: ImportedTournamentCollections;
  unmapped: string[];
}

export function loadFixture(fixtureDir: string, tabbycatPreferences: Record<string, unknown>): LoadedFixture {
  const config = loadFixtureConfig(fixtureDir);
  const xml = readFileSync(join(fixtureDir, "tournament.xml"), "utf8");
  const result = importDebateXmlArchive(xml, {
    parseXml,
    identity: { id: `diff-${config.name}`, slug: config.name, ownerId: "tabbycat-diff" },
    now: "2026-01-01T00:00:00.000Z",
  });
  const errors = result.issues.filter((issue) => issue.severity === "error");
  if (!result.data || errors.length > 0) {
    throw new Error(`${config.name}: DebateXML import failed: ${errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
  const { preferences, unmapped } = translatePreferences(tabbycatPreferences, config.format);
  const tournament: Tournament = {
    ...result.data.tournament,
    preferences: { ...result.data.tournament.preferences, ...withoutUndefined(preferences) },
  };
  const data = result.data.collections;
  const byId = new Map(config.breakCategories.map((category) => [category.id, category]));
  data.breakCategories = data.breakCategories.map((category): BreakCategory => {
    const spec = byId.get(category.id);
    return spec
      ? {
          ...category,
          breakSize: spec.breakSize,
          reserveSize: spec.reserveSize,
          priority: spec.priority,
          isGeneral: spec.general,
          qualificationRule: spec.rule,
        }
      : category;
  });
  // The importer totals each ballot with CrabbyTab's default rules (it runs before the user can
  // configure anything). Recompute the totals with the translated rules, as Tabbycat's importer
  // does with the style preset, so every later comparison starts from the same team scores.
  const rules: BallotRules = { format: tournament.format, preferences: tournament.preferences };
  const debatesById = new Map(data.debates.map((debate) => [debate.id, debate]));
  data.ballots = data.ballots.map((ballot): BallotSubmission => {
    const debate = debatesById.get(ballot.debateId);
    if (!debate) return ballot;
    const teamIds: SideRecord<string> = Object.fromEntries(
      Object.entries(debate.teams).map(([side, slot]) => [side, slot?.teamId])
    );
    if (ballot.sheets?.length) {
      const voting = aggregateVotingSheets(ballot.sheets, ballot.chairId, teamIds, rules);
      return { ...ballot, speakerScores: voting.speakerScores, teamScores: voting.teamScores };
    }
    const ranks: SideRecord<number> = Object.fromEntries(
      Object.entries(ballot.teamScores).map(([side, score]) => [side, score?.rank])
    );
    return { ...ballot, teamScores: consensusTeamScores(ballot.speakerScores, ranks, teamIds, rules) as BallotSubmission["teamScores"] };
  });
  const importerGhosts = result.data.tournament.preferences?.teamScoreIncludesGhosts ?? false;
  const hasGhosts = data.ballots.some((ballot) =>
    Object.values(ballot.speakerScores).some((entries) => entries?.some((entry) => entry.ghost))
  );
  if (hasGhosts && importerGhosts !== Boolean(tabbycatPreferences["scoring__teamscore_includes_ghosts"])) {
    unmapped.push(
      `scoring__teamscore_includes_ghosts (the DebateXML importer totals ballots with CrabbyTab's default, ${importerGhosts}; ` +
        `Tabbycat's default is ${tabbycatPreferences["scoring__teamscore_includes_ghosts"]}; the harness recomputes the totals)`
    );
  }
  data.teams = data.teams.map((team): Team => {
    const unavailableIn = Object.entries(config.unavailableTeams)
      .filter(([, teamIds]) => teamIds.includes(team.id))
      .map(([seq]) => `round-${seq}`);
    return unavailableIn.length > 0
      ? { ...team, roundAvailability: Object.fromEntries(unavailableIn.map((roundId) => [roundId, false])) }
      : team;
  });
  return { config, tournament, data, unmapped };
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

/* -------------------------------------------------------------------------- */
/* Computations                                                               */
/* -------------------------------------------------------------------------- */

const roundSeqOf = (rounds: Round[]) => new Map(rounds.map((round) => [round.id, round.seq]));

function historyBefore(data: ImportedTournamentCollections, seq: number): { debates: Debate[]; ballots: BallotSubmission[]; rounds: Round[] } {
  const seqs = roundSeqOf(data.rounds);
  const debates = data.debates.filter((debate) => (seqs.get(debate.roundId) ?? Infinity) < seq);
  const debateIds = new Set(debates.map((debate) => debate.id));
  return {
    debates,
    ballots: data.ballots.filter((ballot) => debateIds.has(ballot.debateId)),
    rounds: data.rounds.filter((round) => round.seq < seq),
  };
}

function standingsUpTo(fixture: LoadedFixture, seq: number) {
  const { debates, ballots, rounds } = historyBefore(fixture.data, seq + 1);
  return calculateStandings(fixture.tournament, rounds, fixture.data.teams, debates, ballots);
}

function metricsOut(metrics: Record<string, number>, map: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [tabbycatKey, crabbyKey] of Object.entries(map)) {
    if (metrics[crabbyKey] !== undefined) out[tabbycatKey] = metrics[crabbyKey];
  }
  return out;
}

function speakerTable(rows: SpeakerStandingRow[], map: Record<string, SpeakerMetricId>, precedence: string[]): StandingsTable<"speaker"> {
  return {
    precedence,
    rows: rows
      // Ineligible speakers (too many missed speeches) are unranked, as Tabbycat's null rank.
      .map((row) => ({ speaker: row.speakerId, rank: row.ineligible ? null : row.rank, metrics: metricsOut(row.metrics, map) }))
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.speaker.localeCompare(b.speaker)),
  };
}

function standingsSnapshots(fixture: LoadedFixture): StandingsSnapshot[] {
  const prefs = fixture.tournament.preferences;
  const speakerPrecedence = (prefs?.speakerStandingsPrecedence ?? []).map((metric) => SPEAKER_METRIC_NAMES[metric] ?? metric);
  return fixture.config.standingsAfterRounds.map((seq) => {
    const result = standingsUpTo(fixture, seq);
    const snapshot: StandingsSnapshot = {
      afterRound: seq,
      teams: {
        precedence: (prefs?.teamStandingsPrecedence ?? []).map((metric) => TEAM_METRIC_NAMES[metric] ?? metric),
        rows: result.teams
          .map((row) => ({ team: row.teamId, rank: row.rank, metrics: metricsOut(row.metrics, TEAM_METRIC_MAP) }))
          .sort((a, b) => a.rank - b.rank || a.team.localeCompare(b.team)),
      },
      speakers: speakerTable(result.speakers, SPEAKER_METRIC_MAP, speakerPrecedence),
    };
    if (prefs?.replyScoresEnabled) {
      snapshot.replies = speakerTable(result.replies, REPLY_METRIC_MAP, speakerPrecedence);
    }
    return snapshot;
  });
}

function drawOnce(fixture: LoadedFixture, seq: number, seed: number): DrawSample {
  const { tournament, data } = fixture;
  const round = data.rounds.find((candidate) => candidate.seq === seq);
  if (!round) return { error: `Round ${seq} is not in the fixture.` };
  const history = historyBefore(data, seq);
  const standings = calculateStandings(tournament, history.rounds, data.teams, history.debates, history.ballots).teams;
  const drawType = seq === 1 ? "random" : "power_paired";
  const sides = tournament.format === "bp" ? BP_SIDES : TWO_TEAM_SIDES;
  try {
    const debates = generateRoundDraw({
      tournament,
      round: { ...round, drawType, drawStatus: "none", completed: false },
      teams: data.teams,
      institutions: data.institutions,
      venues: data.venues,
      pastDebates: history.debates,
      standings,
      seed,
    });
    return {
      drawType,
      debates: debates
        .filter((debate) => !debate.byeTeamId)
        .map((debate) => ({
          bracket: debate.bracket,
          roomRank: debate.roomRank,
          teams: Object.values(debate.teams)
            .filter((slot) => slot?.teamId)
            .map((slot) => ({ team: slot.teamId, side: sides.indexOf(slot.side), flags: slot.pulledUp ? ["pullup"] : [] }))
            .sort((a, b) => a.side - b.side),
          flags: debate.flags ?? [],
        })),
      byes: debates.flatMap((debate) => (debate.byeTeamId ? [debate.byeTeamId] : [])).sort(),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function drawFor(fixture: LoadedFixture, seq: number): DrawResult {
  const base = fixture.config.seed * 1000 + seq;
  return {
    round: seq,
    ...drawOnce(fixture, seq, base),
    samples: Array.from({ length: DRAW_SAMPLES - 1 }, (_, index) => drawOnce(fixture, seq, base + 7919 * (index + 1))),
  };
}

const EXCLUSION_REMARKS: Record<string, string> = {
  different_break: "D",
  capped: "C",
  ineligible: "I",
  disqualified: "d",
  withdrawn: "w",
  lost_coin_toss: "t",
};

function breaksFor(fixture: LoadedFixture): BreakResult[] {
  const { tournament, data, config } = fixture;
  const standings = standingsUpTo(fixture, config.rounds.played).teams;
  try {
    const results = calculateBreaks(data.breakCategories, data.teams, standings, tournament.format);
    return results.map((result) => ({
      category: result.category.id,
      rule: result.category.qualificationRule ?? "standard",
      breakSize: result.category.breakSize,
      reserveSize: result.category.reserveSize ?? 0,
      breaking: result.breakingTeams.map((entry) => ({ team: entry.team.id, rank: entry.rank, breakRank: entry.seed })),
      reserves: result.reserveTeams.map((entry) => ({ team: entry.team.id, rank: entry.rank })),
      cutoffTies: result.cutoffTies.map((tie) => ({
        cutoff: tie.cutoff,
        places: tie.places,
        teams: tie.teams.map((entry) => entry.team.id),
      })),
      excluded: result.excludedTeams.map((entry) => ({
        team: entry.team.id,
        rank: entry.rank,
        remark: EXCLUSION_REMARKS[entry.reason] ?? entry.reason,
      })),
    }));
  } catch (error) {
    return [{ category: "*", rule: "standard", breakSize: 0, reserveSize: 0, error: error instanceof Error ? error.message : String(error) }];
  }
}

/**
 * Re-allocates the fixture's draw for `allocationRound` with the debates' panels cleared. Tabbycat
 * uses every available adjudicator (panels of three for voting, extra panellists for consensus);
 * CrabbyTab takes a fixed panel size, so the harness asks for the size Tabbycat's allocator aims for.
 */
function allocationFor(fixture: LoadedFixture): AllocationResult {
  const { tournament, data, config } = fixture;
  const seq = config.allocationRound;
  const round = data.rounds.find((candidate) => candidate.seq === seq);
  if (!round) return { round: seq, error: `Round ${seq} is not in the fixture.` };
  const history = historyBefore(data, seq + 1);
  const debates = history.debates.map((debate) =>
    debate.roundId === round.id
      ? { ...debate, adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] } }
      : debate
  );
  const roundDebateCount = debates.filter((debate) => debate.roundId === round.id && !debate.byeTeamId).length;
  // Tabbycat's voting allocator makes solos and trios only (CrabbyTab's "by_priority" sizing); its
  // consensus allocator spreads every adjudicator over the panels (CrabbyTab's "fixed" sizing).
  const voting = tournament.preferences?.ballotMode === "voting";
  const panelSize = voting ? 3 : Math.ceil(data.adjudicators.length / Math.max(1, roundDebateCount));
  const panelSizing = voting ? "by_priority" : "fixed";
  const standings = standingsUpTo(fixture, seq - 1).teams;
  try {
    const result = computeAutoAllocation({
      tournament,
      rounds: data.rounds.map((item) => (item.seq > seq ? { ...item, completed: false } : item)),
      teams: data.teams,
      debates,
      adjudicators: data.adjudicators,
      standings,
      breakCategories: data.breakCategories,
      feedback: [],
      venues: data.venues,
      roundId: round.id,
      panelSize,
      settings: { panelSizing },
    });
    return {
      round: seq,
      allocator: `crabbytab ${panelSizing} panelSize=${panelSize}`,
      debates: (result?.panelledDebates ?? [])
        .filter((debate) => !debate.byeTeamId)
        .map((debate) => ({
          debate: debate.id,
          chair: debate.adjudicators.chairId ?? null,
          panellists: [...(debate.adjudicators.panellistIds ?? [])].sort(),
          trainees: [...(debate.adjudicators.traineeIds ?? [])].sort(),
        }))
        .sort((a, b) => a.debate.localeCompare(b.debate)),
    };
  } catch (error) {
    return { round: seq, error: error instanceof Error ? error.message : String(error) };
  }
}

export function runCrabbyTab(fixtureDir: string, tabbycatPreferences: Record<string, unknown>): EngineOutput & { unmapped: string[] } {
  const fixture = loadFixture(fixtureDir, tabbycatPreferences);
  return {
    fixture: fixture.config.name,
    engine: "crabbytab",
    engineVersion: "workspace",
    unmapped: fixture.unmapped,
    standings: standingsSnapshots(fixture),
    draws: fixture.config.drawRounds.map((seq) => drawFor(fixture, seq)),
    breaks: breaksFor(fixture),
    allocation: allocationFor(fixture),
  };
}
