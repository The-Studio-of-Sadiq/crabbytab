/**
 * Rule-based comparison of a Tabbycat run and a CrabbyTab run of the same fixture.
 *
 * Draws and allocations often have several equally valid answers, so they are compared by the
 * properties the rules care about (bracket composition, pull-ups, side balance, clashes, repeats,
 * hard conflicts), not byte for byte. Standings and breaks are deterministic given the same
 * rules, so they are compared value for value.
 *
 * Each finding is a `Discrepancy` with a stable id. `classify()` attaches the human verdict from
 * `known-differences.json`; anything without a verdict is "unclassified" and fails the test.
 */
import type { AllocationResult, DrawDebate, DrawSample, EngineOutput, StandingsTable } from "./types";

export type Classification =
  | "rule difference"
  | "CrabbyTab defect"
  | "configuration difference"
  | "valid alternative"
  | "unclassified";

export type Area = "config" | "standings" | "draw" | "break" | "allocation";

export interface Discrepancy {
  id: string;
  fixture: string;
  area: Area;
  summary: string;
  tabbycat?: unknown;
  crabbytab?: unknown;
  /** Set when the comparison itself can tell (e.g. a different but equally good draw). */
  autoClassification?: Classification;
  classification: Classification;
  note?: string;
  /** Other PRs/issues the verdict depends on. */
  dependsOn?: string[];
}

/** One line of evidence: what was compared and how much of it agreed. */
export interface Check {
  fixture: string;
  area: Area;
  subject: string;
  compared: number;
  agreed: number;
}

/** Facts about the fixture the comparison needs, read from the imported archive. */
export interface FixtureFacts {
  format: "bp" | "two_team";
  teamInstitution: Map<string, string | undefined>;
  adjudicatorInstitution: Map<string, string | undefined>;
  adjudicatorScore: Map<string, number>;
  /** Adjudicator -> teams they are personally conflicted with. */
  adjudicatorTeamConflicts: Map<string, Set<string>>;
  /** Unordered adjudicator pairs ("A1|A2") that conflict. */
  adjudicatorConflicts: Set<string>;
  /** round seq -> archived debates: team ids by side index, and adjudicators. */
  history: Map<number, { id: string; teams: string[]; adjudicators: string[] }[]>;
}

export interface ComparisonResult {
  discrepancies: Discrepancy[];
  checks: Check[];
}

const EPSILON = 1e-4;

/**
 * Tabbycat reports a metric as null when a team or speaker has no results yet (a bye, a missed
 * round); CrabbyTab reports 0. Both rank such rows last, so null and 0 compare equal.
 */
function equalNumbers(a: number | null | undefined, b: number | null | undefined): boolean {
  const left = a ?? 0;
  const right = b ?? 0;
  return Math.abs(left - right) <= EPSILON * Math.max(1, Math.abs(left));
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/* -------------------------------------------------------------------------- */
/* Standings                                                                  */
/* -------------------------------------------------------------------------- */

type Keyed = "team" | "speaker";

function compareTable<K extends Keyed>(
  fixture: string,
  label: string,
  key: K,
  snapshots: { afterRound: number; tabbycat: StandingsTable<K>; crabbytab?: StandingsTable<K> }[],
  out: ComparisonResult
) {
  const metricMismatches = new Map<string, { count: number; firstRound: number; examples: unknown[] }>();
  const unsupported = new Set<string>();
  const rankMismatches: { round: number; id: string; tabbycat: number | null; crabbytab: number | null }[] = [];
  const missingRows: { round: number; id: string }[] = [];
  let comparedValues = 0;
  let agreedValues = 0;
  let comparedRanks = 0;
  let agreedRanks = 0;

  for (const snapshot of snapshots) {
    const crabbyRows = new Map((snapshot.crabbytab?.rows ?? []).map((row) => [row[key], row]));
    for (const row of snapshot.tabbycat.rows) {
      const id = row[key];
      const other = crabbyRows.get(id);
      if (!other) {
        // Tabbycat lists every speaker in the reply tab, with empty metrics for those who never replied.
        if (Object.values(row.metrics).every((value) => !value)) continue;
        missingRows.push({ round: snapshot.afterRound, id });
        continue;
      }
      for (const [metric, value] of Object.entries(row.metrics)) {
        if (!(metric in other.metrics)) {
          unsupported.add(metric);
          continue;
        }
        comparedValues++;
        if (equalNumbers(value, other.metrics[metric])) {
          agreedValues++;
          continue;
        }
        const entry = metricMismatches.get(metric) ?? { count: 0, firstRound: snapshot.afterRound, examples: [] };
        entry.count++;
        if (entry.examples.length < 3) {
          entry.examples.push({ afterRound: snapshot.afterRound, [key]: id, tabbycat: value, crabbytab: other.metrics[metric] });
        }
        metricMismatches.set(metric, entry);
      }
      comparedRanks++;
      // Tabbycat leaves speakers below the missed-debates threshold unranked (null).
      if (row.rank === other.rank) agreedRanks++;
      else rankMismatches.push({ round: snapshot.afterRound, id, tabbycat: row.rank, crabbytab: other.rank });
    }
  }

  out.checks.push({ fixture, area: "standings", subject: `${label}: metric values`, compared: comparedValues, agreed: agreedValues });
  out.checks.push({ fixture, area: "standings", subject: `${label}: ranks`, compared: comparedRanks, agreed: agreedRanks });

  for (const metric of [...unsupported].sort()) {
    out.discrepancies.push(discrepancy(fixture, "standings", `standings/${label}/unsupported/${metric}`,
      `${label}: Tabbycat metric "${metric}" has no CrabbyTab equivalent`));
  }
  for (const [metric, entry] of [...metricMismatches].sort(([a], [b]) => a.localeCompare(b))) {
    out.discrepancies.push(discrepancy(fixture, "standings", `standings/${label}/metric/${metric}`,
      `${label}: "${metric}" differs for ${entry.count} row(s), first after round ${entry.firstRound}`,
      { examples: entry.examples }));
  }
  if (missingRows.length > 0) {
    out.discrepancies.push(discrepancy(fixture, "standings", `standings/${label}/missing-rows`,
      `${label}: ${missingRows.length} Tabbycat row(s) have no CrabbyTab row`, { examples: missingRows.slice(0, 5) }));
  }
  if (rankMismatches.length > 0) {
    const nullRanks = rankMismatches.filter((entry) => entry.tabbycat === null).length;
    out.discrepancies.push(discrepancy(fixture, "standings", `standings/${label}/rank`,
      `${label}: rank differs for ${rankMismatches.length} row(s)` +
        (nullRanks ? ` (${nullRanks} unranked by Tabbycat)` : ""),
      { examples: rankMismatches.slice(0, 5) }));
  }
}

function compareStandings(fixture: string, tabbycat: EngineOutput, crabbytab: EngineOutput, out: ComparisonResult) {
  const byRound = new Map(crabbytab.standings.map((snapshot) => [snapshot.afterRound, snapshot]));
  const first = tabbycat.standings[0];
  const crabbyFirst = crabbytab.standings[0];
  if (first && crabbyFirst && JSON.stringify(first.teams.precedence) !== JSON.stringify(crabbyFirst.teams.precedence)) {
    out.discrepancies.push(discrepancy(fixture, "config", "config/team-precedence",
      "Team standings precedence differs after translation",
      undefined, first.teams.precedence, crabbyFirst.teams.precedence));
  }
  compareTable(fixture, "teams", "team", tabbycat.standings.map((snapshot) => ({
    afterRound: snapshot.afterRound, tabbycat: snapshot.teams, crabbytab: byRound.get(snapshot.afterRound)?.teams,
  })), out);
  compareTable(fixture, "speakers", "speaker", tabbycat.standings.map((snapshot) => ({
    afterRound: snapshot.afterRound, tabbycat: snapshot.speakers, crabbytab: byRound.get(snapshot.afterRound)?.speakers,
  })), out);
  const withReplies = tabbycat.standings.filter((snapshot) => snapshot.replies);
  if (withReplies.length > 0) {
    compareTable(fixture, "replies", "speaker", withReplies.map((snapshot) => ({
      afterRound: snapshot.afterRound, tabbycat: snapshot.replies!, crabbytab: byRound.get(snapshot.afterRound)?.replies,
    })), out);
  }
}

/* -------------------------------------------------------------------------- */
/* Draws                                                                      */
/* -------------------------------------------------------------------------- */

/** The draw rules in force, read from Tabbycat's effective preferences. */
export interface DrawRules {
  avoidInstitution: boolean;
  avoidHistory: boolean;
  maxTimesPerSide?: number;
  /** BP only: Tabbycat's position cost, C = n[2 - H_α(p)] raised to `exponent`. */
  positionCost?: { renyiOrder: number; exponent: number };
}

export function drawRulesFrom(preferences: Record<string, unknown>, format: FixtureFacts["format"]): DrawRules {
  const maxTimes = Number(preferences["draw_rules__max_times_per_side"]);
  return {
    avoidInstitution: Boolean(preferences["draw_rules__avoid_same_institution"]),
    avoidHistory: Boolean(preferences["draw_rules__avoid_team_history"]),
    ...(format === "two_team" && Number.isFinite(maxTimes) && maxTimes > 0 ? { maxTimesPerSide: maxTimes } : {}),
    ...(format === "bp"
      ? {
          positionCost: {
            renyiOrder: Number(preferences["draw_rules__bp_renyi_order"] ?? 1),
            exponent: Number(preferences["draw_rules__bp_position_cost_exponent"] ?? 4),
          },
        }
      : {}),
  };
}

export interface DrawProperties {
  rooms: number;
  byes: string[];
  /** Sorted multiset of each room's sorted team points: equal => same bracket composition. */
  bracketSignature: string;
  /** Teams debating below their room's top points (Tabbycat's bracket level). */
  pullups: number;
  /** Pairs of teams from the same institution sharing a room. */
  institutionClashes: number;
  /** Pairs of teams that already met. */
  repeatPairings: number;
  /** Two-team: teams more than one debate off balance. BP: sum over teams of (most - least used position). */
  sideImbalance: number;
  /** Two-team only: teams over the configured maximum on one side. */
  sideCapViolations: number;
  /** BP only: Tabbycat's assignment objective for this draw (lower is better). */
  positionCost: number;
  /** Teams missing from the draw, or appearing twice. */
  coverageErrors: number;
}

/** Tabbycat's BP position cost for a team with `history` (times in each position) placed in `position`. */
export function bpPositionCost(position: number, history: number[], renyiOrder: number): number {
  const updated = history.map((count, index) => count + (index === position ? 1 : 0));
  const n = updated.reduce((sum, count) => sum + count, 0);
  const probabilities = updated.map((count) => count / n);
  let entropy: number;
  if (renyiOrder === 1) {
    entropy = -probabilities.reduce((sum, p) => sum + (p > 0 ? p * Math.log2(p) : 0), 0);
  } else if (renyiOrder === 0) {
    entropy = Math.log2(probabilities.filter((p) => p > 0).length);
  } else {
    entropy = Math.log2(probabilities.reduce((sum, p) => sum + p ** renyiOrder, 0)) / (1 - renyiOrder);
  }
  return (2 - entropy) * n;
}

export function drawProperties(
  draw: DrawSample,
  round: number,
  facts: FixtureFacts,
  rules: DrawRules,
  points: Map<string, number>,
  teamIds: string[],
  unavailable: Set<string>
): DrawProperties {
  const debates = draw.debates ?? [];
  const sidesPerDebate = facts.format === "bp" ? 4 : 2;
  const met = new Set<string>();
  const before = new Map<string, number[]>();
  for (const [seq, debatesInRound] of facts.history) {
    if (seq >= round) continue;
    for (const debate of debatesInRound) {
      debate.teams.forEach((team, side) => {
        const counts = before.get(team) ?? Array(sidesPerDebate).fill(0);
        counts[side]++;
        before.set(team, counts);
        for (const other of debate.teams) if (other !== team) met.add(pairKey(team, other));
      });
    }
  }
  const history = (team: string): number[] => before.get(team) ?? Array(sidesPerDebate).fill(0);
  const signature: string[] = [];
  let pullups = 0;
  let clashes = 0;
  let repeats = 0;
  let positionCost = 0;
  let sideImbalance = 0;
  let sideCapViolations = 0;
  const seen = new Map<string, number>();
  for (const debate of debates) {
    const roomPoints = debate.teams.map((slot) => points.get(slot.team) ?? 0);
    signature.push(JSON.stringify([...roomPoints].sort((x, y) => y - x)));
    const top = Math.max(...roomPoints);
    pullups += roomPoints.filter((value) => value < top).length;
    for (let i = 0; i < debate.teams.length; i++) {
      const { team, side } = debate.teams[i];
      seen.set(team, (seen.get(team) ?? 0) + 1);
      const after = history(team).map((count, index) => count + (index === side ? 1 : 0));
      if (facts.format === "bp") {
        sideImbalance += Math.max(...after) - Math.min(...after);
        if (rules.positionCost) {
          positionCost += bpPositionCost(side, history(team), rules.positionCost.renyiOrder) ** rules.positionCost.exponent;
        }
      } else {
        if (Math.abs(after[0] - after[1]) > 1) sideImbalance++;
        if (rules.maxTimesPerSide && Math.max(...after) > rules.maxTimesPerSide) sideCapViolations++;
      }
      for (let j = i + 1; j < debate.teams.length; j++) {
        const other = debate.teams[j].team;
        const institution = facts.teamInstitution.get(team);
        if (institution && institution === facts.teamInstitution.get(other)) clashes++;
        if (met.has(pairKey(team, other))) repeats++;
      }
    }
  }
  for (const bye of draw.byes ?? []) seen.set(bye, (seen.get(bye) ?? 0) + 1);
  let coverageErrors = 0;
  for (const team of teamIds) {
    const count = seen.get(team) ?? 0;
    if (unavailable.has(team) ? count !== 0 : count !== 1) coverageErrors++;
  }
  return {
    rooms: debates.length,
    byes: [...(draw.byes ?? [])].sort(),
    bracketSignature: signature.sort().join(" "),
    pullups,
    institutionClashes: clashes,
    repeatPairings: repeats,
    sideImbalance,
    sideCapViolations,
    positionCost: Math.round(positionCost * 1000) / 1000,
    coverageErrors,
  };
}

function roomKey(debate: DrawDebate, withSides: boolean): string {
  return debate.teams
    .map((slot) => (withSides ? `${slot.side}:${slot.team}` : slot.team))
    .sort()
    .join(",");
}

/** min..max for numbers; the distinct values otherwise. */
function spread(values: unknown[]): unknown {
  if (values.every((value) => typeof value === "number")) {
    const numbers = values as number[];
    return { min: Math.min(...numbers), max: Math.max(...numbers) };
  }
  return [...new Set(values.map((value) => JSON.stringify(value)))].map((value) => JSON.parse(value) as unknown);
}

function overlaps(left: unknown[], right: unknown[]): boolean {
  if (left.every((value) => typeof value === "number") && right.every((value) => typeof value === "number")) {
    const [a, b] = [left as number[], right as number[]];
    return Math.min(...a) <= Math.max(...b) + EPSILON && Math.min(...b) <= Math.max(...a) + EPSILON;
  }
  const keys = new Set(left.map((value) => JSON.stringify(value)));
  return right.some((value) => keys.has(JSON.stringify(value)));
}

function compareDraws(
  fixture: string,
  tabbycat: EngineOutput,
  crabbytab: EngineOutput,
  facts: FixtureFacts,
  unavailableByRound: Record<string, string[]>,
  out: ComparisonResult
) {
  const rules = drawRulesFrom(tabbycat.preferences ?? {}, facts.format);
  const teamIds = [...facts.teamInstitution.keys()];
  const crabbyDraws = new Map(crabbytab.draws.map((draw) => [draw.round, draw]));
  const pointsKey = facts.format === "bp" ? "points" : "wins";
  for (const draw of tabbycat.draws) {
    const other = crabbyDraws.get(draw.round);
    const base = `draw/r${draw.round}`;
    if (!other) continue;
    const tabbycatSamples: DrawSample[] = [draw, ...(draw.samples ?? [])];
    const crabbySamples: DrawSample[] = [other, ...(other.samples ?? [])];
    if (draw.error || other.error) {
      if (Boolean(draw.error) !== Boolean(other.error)) {
        const refusals = (samples: DrawSample[]) => `${samples.filter((sample) => sample.error).length}/${samples.length} seeds refused`;
        out.discrepancies.push(discrepancy(fixture, "draw", `${base}/error`,
          `Round ${draw.round}: only ${draw.error ? "Tabbycat" : "CrabbyTab"} refused to draw`, undefined,
          { error: draw.error, seeds: refusals(tabbycatSamples) }, { error: other.error, seeds: refusals(crabbySamples) }));
      }
      out.checks.push({
        fixture,
        area: "draw",
        subject: `round ${draw.round}: both engines draw (or both refuse)`,
        compared: 1,
        agreed: Boolean(draw.error) === Boolean(other.error) ? 1 : 0,
      });
      continue;
    }
    // Brackets are judged on the standings both engines drew from (Tabbycat's, after the previous round).
    const previous = tabbycat.standings.find((snapshot) => snapshot.afterRound === draw.round - 1);
    const points = new Map((previous?.teams.rows ?? []).map((row) => [row.team, row.metrics[pointsKey] ?? 0]));
    const unavailable = new Set(unavailableByRound[String(draw.round)] ?? []);
    const propsOf = (sample: DrawSample) => drawProperties(sample, draw.round, facts, rules, points, teamIds, unavailable);
    const a = propsOf(draw);
    const b = propsOf(other);
    const tabbycatProps = tabbycatSamples.filter((sample) => !sample.error).map(propsOf);
    const crabbyProps = crabbySamples.filter((sample) => !sample.error).map(propsOf);

    // Only properties a rule in force constrains can be wrong; the rest are reported as information.
    const constrained: (keyof DrawProperties)[] = ["rooms", "coverageErrors"];
    if (draw.round > 1) constrained.push("bracketSignature", "pullups", "sideImbalance");
    if (rules.avoidInstitution) constrained.push("institutionClashes");
    if (rules.avoidHistory && draw.round > 1) constrained.push("repeatPairings");
    if (rules.maxTimesPerSide && draw.round > 1) constrained.push("sideCapViolations");
    if (rules.positionCost && draw.round > 1) constrained.push("positionCost");
    constrained.push("byes");

    let agreed = 0;
    for (const property of constrained) {
      if (JSON.stringify(a[property]) === JSON.stringify(b[property])) {
        agreed++;
        continue;
      }
      const left = tabbycatProps.map((props) => props[property]);
      const right = crabbyProps.map((props) => props[property]);
      // A difference that also shows up between seeds of the same engine is seed variation, not a rule difference.
      const seedVariation = overlaps(left, right);
      let auto: Classification | undefined = seedVariation ? "valid alternative" : undefined;
      // Byes for the lowest-ranked teams may go to any of the teams tied on the lowest points.
      if (property === "byes" && draw.round > 1) {
        const byePoints = (byes: string[]) => byes.map((team) => points.get(team) ?? 0).sort();
        if (JSON.stringify(byePoints(a.byes)) === JSON.stringify(byePoints(b.byes))) auto = "valid alternative";
      }
      out.discrepancies.push(discrepancy(fixture, "draw", `${base}/${property}`,
        `Round ${draw.round}: ${property} differs` + (seedVariation ? " (within seed-to-seed variation)" : ""),
        undefined,
        { primary: a[property], seeds: spread(left) },
        { primary: b[property], seeds: spread(right) },
        auto));
    }
    out.checks.push({
      fixture,
      area: "draw",
      subject: `round ${draw.round}: ${constrained.join(", ")} (${tabbycatSamples.length} seeds each)`,
      compared: constrained.length,
      agreed,
    });

    const informational = (["institutionClashes", "repeatPairings", "positionCost"] as (keyof DrawProperties)[])
      .filter((property) => !constrained.includes(property) && (property !== "positionCost" || rules.positionCost));
    for (const property of informational) {
      out.checks.push({
        fixture,
        area: "draw",
        subject: `round ${draw.round}: ${property}, not constrained by the rules in force (Tabbycat ${JSON.stringify(spread(tabbycatProps.map((props) => props[property])))}, CrabbyTab ${JSON.stringify(spread(crabbyProps.map((props) => props[property])))})`,
        compared: 1,
        agreed: JSON.stringify(a[property]) === JSON.stringify(b[property]) ? 1 : 0,
      });
    }

    const sameRooms = (withSides: boolean) => {
      const left = new Set((draw.debates ?? []).map((debate) => roomKey(debate, withSides)));
      return (other.debates ?? []).filter((debate) => left.has(roomKey(debate, withSides))).length;
    };
    out.checks.push({
      fixture,
      area: "draw",
      subject: `round ${draw.round}: identical rooms, primary seed (same teams; ${sameRooms(true)} also on the same sides)`,
      compared: a.rooms,
      agreed: sameRooms(false),
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Breaks                                                                     */
/* -------------------------------------------------------------------------- */

function compareBreaks(fixture: string, tabbycat: EngineOutput, crabbytab: EngineOutput, out: ComparisonResult) {
  const crabbyBreaks = new Map(crabbytab.breaks.map((entry) => [entry.category, entry]));
  const crabbyError = crabbytab.breaks.find((entry) => entry.category === "*")?.error;
  for (const entry of tabbycat.breaks) {
    const other = crabbyBreaks.get(entry.category);
    const base = `break/${entry.category}`;
    if (entry.error || crabbyError || !other) {
      out.discrepancies.push(discrepancy(fixture, "break", `${base}/error`,
        `Break ${entry.category}: ${entry.error ? "Tabbycat" : "CrabbyTab"} could not compute it`, undefined, entry.error, crabbyError));
      continue;
    }
    const sets: [string, string[], string[]][] = [
      ["breaking", (entry.breaking ?? []).map((row) => row.team), (other.breaking ?? []).map((row) => row.team)],
      ["reserves", (entry.reserves ?? []).map((row) => row.team), (other.reserves ?? []).map((row) => row.team)],
      ["different-break", (entry.excluded ?? []).filter((row) => row.remark === "D").map((row) => row.team),
        (other.excluded ?? []).filter((row) => row.remark === "D").map((row) => row.team)],
    ];
    let agreed = 0;
    for (const [name, left, right] of sets) {
      const leftSorted = [...left].sort();
      const rightSorted = [...right].sort();
      if (JSON.stringify(leftSorted) === JSON.stringify(rightSorted)) {
        agreed++;
        continue;
      }
      out.discrepancies.push(discrepancy(fixture, "break", `${base}/${name}`,
        `Break ${entry.category}: ${name} teams differ`,
        { onlyTabbycat: leftSorted.filter((team) => !right.includes(team)), onlyCrabbyTab: rightSorted.filter((team) => !left.includes(team)) },
        leftSorted, rightSorted));
    }
    // Seeding order inside the break, for the teams both engines break.
    const common = (entry.breaking ?? []).map((row) => row.team).filter((team) => (other.breaking ?? []).some((row) => row.team === team));
    const order = (rows: { team: string; breakRank: number | null }[]) =>
      [...rows].filter((row) => common.includes(row.team)).sort((x, y) => (x.breakRank ?? 0) - (y.breakRank ?? 0) || x.team.localeCompare(y.team)).map((row) => `${row.team}@${row.breakRank}`);
    const seedsAgree = JSON.stringify(order(entry.breaking ?? [])) === JSON.stringify(order(other.breaking ?? []));
    if (!seedsAgree) {
      out.discrepancies.push(discrepancy(fixture, "break", `${base}/seeds`,
        `Break ${entry.category}: break ranks (seeds) differ for teams both engines break`, undefined,
        order(entry.breaking ?? []), order(other.breaking ?? [])));
    }
    out.checks.push({ fixture, area: "break", subject: `${entry.category}: breaking, reserve and different-break sets, seeds`, compared: sets.length + 1, agreed: agreed + (seedsAgree ? 1 : 0) });
  }
}

/* -------------------------------------------------------------------------- */
/* Allocation                                                                 */
/* -------------------------------------------------------------------------- */

export interface AllocationProperties {
  debatesWithoutChair: number;
  /** Sorted voting-panel sizes (chair + panellists). */
  panelSizes: number[];
  adjudicatorsUsed: number;
  personalConflicts: number;
  institutionConflicts: number;
  adjudicatorConflicts: number;
  /** Adjudicator-team pairs that already met in an earlier round (soft). */
  historyRepeats: number;
  /** Sum of chairs' base scores, a coarse quality band. */
  chairScoreSum: number;
}

export function allocationProperties(allocation: AllocationResult, facts: FixtureFacts): AllocationProperties {
  const debates = allocation.debates ?? [];
  const roundDebates = new Map((facts.history.get(allocation.round) ?? []).map((debate) => [debate.id, debate]));
  const seenTeams = new Map<string, Set<string>>();
  for (const [seq, debatesInRound] of facts.history) {
    if (seq >= allocation.round) continue;
    for (const debate of debatesInRound) {
      for (const adj of debate.adjudicators) {
        const set = seenTeams.get(adj) ?? new Set();
        debate.teams.forEach((team) => set.add(team));
        seenTeams.set(adj, set);
      }
    }
  }
  const props: AllocationProperties = {
    debatesWithoutChair: 0,
    panelSizes: [],
    adjudicatorsUsed: 0,
    personalConflicts: 0,
    institutionConflicts: 0,
    adjudicatorConflicts: 0,
    historyRepeats: 0,
    chairScoreSum: 0,
  };
  const used = new Set<string>();
  for (const debate of debates) {
    const teams = roundDebates.get(debate.debate)?.teams ?? [];
    const voting = [debate.chair, ...debate.panellists].filter((adj): adj is string => Boolean(adj));
    const everyone = [...voting, ...debate.trainees];
    if (!debate.chair) props.debatesWithoutChair++;
    else props.chairScoreSum += facts.adjudicatorScore.get(debate.chair) ?? 0;
    props.panelSizes.push(voting.length);
    for (const adj of everyone) {
      used.add(adj);
      const institution = facts.adjudicatorInstitution.get(adj);
      for (const team of teams) {
        if (facts.adjudicatorTeamConflicts.get(adj)?.has(team)) props.personalConflicts++;
        if (institution && institution === facts.teamInstitution.get(team)) props.institutionConflicts++;
        if (seenTeams.get(adj)?.has(team)) props.historyRepeats++;
      }
    }
    for (let i = 0; i < everyone.length; i++) {
      for (let j = i + 1; j < everyone.length; j++) {
        if (facts.adjudicatorConflicts.has(pairKey(everyone[i], everyone[j]))) props.adjudicatorConflicts++;
      }
    }
  }
  props.adjudicatorsUsed = used.size;
  props.panelSizes.sort((x, y) => x - y);
  props.chairScoreSum = Math.round(props.chairScoreSum * 10) / 10;
  return props;
}

function compareAllocation(fixture: string, tabbycat: EngineOutput, crabbytab: EngineOutput, facts: FixtureFacts, out: ComparisonResult) {
  const base = `allocation/r${tabbycat.allocation.round}`;
  if (tabbycat.allocation.error || crabbytab.allocation.error) {
    out.discrepancies.push(discrepancy(fixture, "allocation", `${base}/error`, "Allocation failed in one engine",
      undefined, tabbycat.allocation.error, crabbytab.allocation.error));
    return;
  }
  const a = allocationProperties(tabbycat.allocation, facts);
  const b = allocationProperties(crabbytab.allocation, facts);
  // Hard constraints must match exactly; quality (chair scores) is compared as a 10% band.
  const hard: (keyof AllocationProperties)[] = ["debatesWithoutChair", "personalConflicts", "institutionConflicts", "adjudicatorConflicts"];
  const shape: (keyof AllocationProperties)[] = ["panelSizes", "adjudicatorsUsed", "historyRepeats"];
  let agreed = 0;
  for (const property of [...hard, ...shape]) {
    if (JSON.stringify(a[property]) === JSON.stringify(b[property])) {
      agreed++;
      continue;
    }
    out.discrepancies.push(discrepancy(fixture, "allocation", `${base}/${property}`,
      `Round ${tabbycat.allocation.round} allocation: ${property} differs` + (hard.includes(property) ? " (hard constraint)" : ""),
      undefined, a[property], b[property]));
  }
  const band = Math.abs(a.chairScoreSum - b.chairScoreSum) <= 0.1 * Math.max(1, a.chairScoreSum);
  if (band) agreed++;
  else {
    out.discrepancies.push(discrepancy(fixture, "allocation", `${base}/chairScoreSum`,
      `Round ${tabbycat.allocation.round} allocation: chair quality outside a 10% band`, undefined, a.chairScoreSum, b.chairScoreSum));
  }
  out.checks.push({ fixture, area: "allocation", subject: `round ${tabbycat.allocation.round}: ${[...hard, ...shape, "chairScoreSum"].join(", ")}`, compared: hard.length + shape.length + 1, agreed });
}

/* -------------------------------------------------------------------------- */
/* Entry points                                                               */
/* -------------------------------------------------------------------------- */

function discrepancy(
  fixture: string,
  area: Area,
  id: string,
  summary: string,
  details?: Record<string, unknown>,
  tabbycat?: unknown,
  crabbytab?: unknown,
  autoClassification?: Classification
): Discrepancy {
  return {
    id: `${fixture}/${id}`,
    fixture,
    area,
    summary,
    ...(details ? { tabbycat: details } : {}),
    ...(tabbycat !== undefined ? { tabbycat } : {}),
    ...(crabbytab !== undefined ? { crabbytab } : {}),
    ...(autoClassification ? { autoClassification } : {}),
    classification: autoClassification ?? "unclassified",
  };
}

export function compareRuns(
  tabbycat: EngineOutput,
  crabbytab: EngineOutput & { unmapped?: string[] },
  facts: FixtureFacts,
  unavailableByRound: Record<string, string[]>
): ComparisonResult {
  const out: ComparisonResult = { discrepancies: [], checks: [] };
  const fixture = tabbycat.fixture;
  for (const setting of crabbytab.unmapped ?? []) {
    const name = setting.split(/[= ]/)[0];
    out.discrepancies.push(discrepancy(fixture, "config", `config/unmapped/${name}`,
      `Tabbycat setting has no CrabbyTab equivalent: ${setting}`));
  }
  compareStandings(fixture, tabbycat, crabbytab, out);
  compareDraws(fixture, tabbycat, crabbytab, facts, unavailableByRound, out);
  compareBreaks(fixture, tabbycat, crabbytab, out);
  compareAllocation(fixture, tabbycat, crabbytab, facts, out);
  return out;
}

export interface KnownDifference {
  /** Exact discrepancy id, or a pattern where `*` matches any run of characters. */
  id: string;
  classification: Exclude<Classification, "unclassified">;
  note: string;
  dependsOn?: string[];
}

export function classify(discrepancies: Discrepancy[], known: KnownDifference[]): Discrepancy[] {
  const matchers = known.map((entry) => ({
    entry,
    pattern: new RegExp(`^${entry.id.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`),
  }));
  return discrepancies.map((item) => {
    const match = matchers.find(({ pattern }) => pattern.test(item.id));
    if (!match) return item;
    return {
      ...item,
      classification: match.entry.classification,
      note: match.entry.note,
      ...(match.entry.dependsOn ? { dependsOn: match.entry.dependsOn } : {}),
    };
  });
}
