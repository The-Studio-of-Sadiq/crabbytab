/**
 * Seeded generator for the differential-testing fixtures.
 *
 *   node tools/tabbycat-diff/fixtures/generate.ts
 *
 * Writes `<fixture>/tournament.xml` (DebateXML, in the dialect Tabbycat's own exporter writes) and
 * `<fixture>/config.json` (everything DebateXML cannot carry: draw rules, break sizes,
 * availability, the rounds to compare). The same seed always produces byte-identical files.
 *
 * The draws inside the archive are history only: a simple points-then-speaks fold with byes for
 * the lowest-ranked teams. They are not meant to be good draws; both engines are asked to draw
 * the *next* round from that history, and those generated draws are what gets compared.
 *
 * Self-contained on purpose (no app imports) so it runs with Node's TypeScript type stripping.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Style = "bp" | "australs";

interface BreakCategorySpec {
  id: string;
  name: string;
  general: boolean;
  breakSize: number;
  reserveSize: number;
  priority: number;
  rule: "standard";
  /** Team indexes (0-based) eligible for a non-general category. */
  eligible?: number[];
}

interface FixtureSpec {
  name: string;
  title: string;
  description: string;
  style: Style;
  seed: number;
  /** Teams per institution, in institution order. */
  institutionSizes: number[];
  adjudicatorCount: number;
  /** Adjudicator base scores are drawn uniformly from this range (Tabbycat's default scale is 0-5). */
  adjudicatorScoreRange: [number, number];
  /** Adjudicators per panel in the archived rounds: one entry per room, repeating the last. */
  panelSizes: number[];
  playedRounds: number;
  /** Rounds that are in the archive but have no draw: the "next round" both engines draw. */
  emptyRounds: number;
  /** round seq -> team indexes unavailable in that round. */
  unavailableTeams: Record<number, number[]>;
  /** round seq -> team indexes whose last substantive speech is given by their first speaker. */
  ironPerson: Record<number, number[]>;
  /** [adjudicator index, team index] personal conflicts. */
  adjudicatorTeamConflicts: [number, number][];
  /** [adjudicator index, adjudicator index] conflicts. */
  adjudicatorConflicts: [number, number][];
  breakCategories: BreakCategorySpec[];
  /** Tabbycat preference overrides applied on top of the style's preset. */
  tabbycatPreferences: Record<string, unknown>;
  allocationRound: number;
}

const FIXTURES: FixtureSpec[] = [
  {
    name: "bp-uneven",
    title: "BP Uneven Open",
    description:
      "British Parliamentary, 26 teams (two byes a round, one bye in round 3 when a team is unavailable), " +
      "three break categories with different priorities, an iron-person speech, adjudicator conflicts.",
    style: "bp",
    seed: 20261019,
    institutionSizes: [4, 4, 3, 3, 3, 2, 2, 2, 2, 1],
    adjudicatorCount: 9,
    adjudicatorScoreRange: [2, 5],
    panelSizes: [2, 2, 1],
    playedRounds: 4,
    emptyRounds: 1,
    unavailableTeams: { 3: [25], 5: [7] },
    ironPerson: { 2: [4], 4: [11] },
    adjudicatorTeamConflicts: [[0, 2], [3, 10]],
    adjudicatorConflicts: [[1, 2]],
    breakCategories: [
      { id: "BC1", name: "Open", general: true, breakSize: 8, reserveSize: 2, priority: 3, rule: "standard" },
      { id: "BC2", name: "ESL", general: false, breakSize: 4, reserveSize: 1, priority: 2, rule: "standard", eligible: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25] },
      { id: "BC3", name: "EFL", general: false, breakSize: 2, reserveSize: 0, priority: 1, rule: "standard", eligible: [20, 21, 22, 23, 24, 25] },
    ],
    tabbycatPreferences: {
      draw_rules__bye_team_selection: "lowest",
      draw_rules__bye_team_results: "none",
    },
    allocationRound: 4,
  },
  {
    name: "australs-voting",
    title: "Australs Voting Cup",
    description:
      "Two-team Australs rules, 20 teams from unevenly sized institutions (forces institution swaps), " +
      "3-adjudicator voting panels with split decisions, reply speeches, an iron-person speech.",
    style: "australs",
    seed: 4242,
    institutionSizes: [5, 4, 3, 2, 2, 2, 1, 1],
    adjudicatorCount: 18,
    adjudicatorScoreRange: [1.5, 5],
    panelSizes: [3, 3, 3, 3, 1],
    playedRounds: 4,
    emptyRounds: 1,
    unavailableTeams: {},
    ironPerson: { 3: [6] },
    adjudicatorTeamConflicts: [[0, 0], [5, 9]],
    adjudicatorConflicts: [[2, 3]],
    breakCategories: [
      { id: "BC1", name: "Open", general: true, breakSize: 4, reserveSize: 2, priority: 2, rule: "standard" },
      { id: "BC2", name: "Novice", general: false, breakSize: 2, reserveSize: 1, priority: 1, rule: "standard", eligible: [1, 5, 9, 13, 17] },
    ],
    tabbycatPreferences: {},
    allocationRound: 4,
  },
  {
    name: "twoteam-odd-ties",
    title: "Odd Ties Invitational",
    description:
      "Two-team, 19 teams (a bye every round), ranked on wins only so standings and the break are " +
      "full of ties, fold pairing with pull-up-from-top, a cap of three debates on one side.",
    style: "australs",
    seed: 1919,
    institutionSizes: [3, 3, 3, 2, 2, 2, 2, 1, 1],
    adjudicatorCount: 10,
    adjudicatorScoreRange: [2, 5],
    panelSizes: [1],
    playedRounds: 4,
    emptyRounds: 1,
    unavailableTeams: {},
    ironPerson: {},
    adjudicatorTeamConflicts: [[1, 4]],
    adjudicatorConflicts: [],
    breakCategories: [
      { id: "BC1", name: "Open", general: true, breakSize: 6, reserveSize: 2, priority: 1, rule: "standard" },
    ],
    tabbycatPreferences: {
      standings__team_standings_precedence: ["wins"],
      draw_rules__draw_odd_bracket: "pullup_top",
      draw_rules__draw_pairing_method: "fold",
      draw_rules__max_times_per_side: 3,
      draw_rules__bye_team_selection: "lowest",
      draw_rules__bye_team_results: "none",
    },
    allocationRound: 4,
  },
];

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                   */
/* -------------------------------------------------------------------------- */

type Rng = () => number;

/** mulberry32, the same generator src/lib/draw/rng.ts uses. */
function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng: Rng, low: number, high: number) => low + Math.floor(rng() * (high - low + 1));

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* -------------------------------------------------------------------------- */
/* Tournament model                                                           */
/* -------------------------------------------------------------------------- */

interface Team {
  id: string;
  name: string;
  institution: string;
  speakers: string[];
  strength: number;
  points: number;
  speaks: number;
}

interface Adjudicator {
  id: string;
  name: string;
  institution: string;
  score: number;
}

interface Speech {
  speaker: string;
  reply: boolean;
  ghost: boolean;
  /** One score per ballot, in ballot order. */
  scores: number[];
}

interface Side {
  team: string;
  /** One [rank, total] per ballot. */
  ballots: { adjudicators: string; rank: number; total: number; minority?: boolean }[];
  speeches: Speech[];
}

interface Debate {
  id: string;
  venue: string;
  adjudicators: string[];
  sides: Side[];
}

interface Round {
  seq: number;
  debates: Debate[];
  byes: string[];
}

const SIDE_COUNT: Record<Style, number> = { bp: 4, australs: 2 };
const SUBSTANTIVE: Record<Style, number> = { bp: 2, australs: 3 };

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildTeams(spec: FixtureSpec, rng: Rng): { teams: Team[]; institutions: { id: string; code: string; name: string }[] } {
  const institutions = spec.institutionSizes.map((_, index) => ({
    id: `I${index + 1}`,
    code: `U${String.fromCharCode(65 + index)}`,
    name: `University ${String.fromCharCode(65 + index)}`,
  }));
  const teams: Team[] = [];
  let speakerSeq = 1;
  spec.institutionSizes.forEach((size, institutionIndex) => {
    for (let n = 0; n < size; n++) {
      const index = teams.length + 1;
      const institution = institutions[institutionIndex];
      const speakers = Array.from({ length: SUBSTANTIVE[spec.style] }, () => `S${speakerSeq++}`);
      teams.push({
        id: `T${index}`,
        name: `${institution.name} ${String.fromCharCode(65 + n)}`,
        institution: institution.id,
        speakers,
        // Latent quality: results correlate with it so brackets form realistically.
        strength: round1((rng() - 0.5) * 6),
        points: 0,
        speaks: 0,
      });
    }
  });
  return { teams, institutions };
}

function buildAdjudicators(spec: FixtureSpec, institutionCount: number, rng: Rng): Adjudicator[] {
  const [low, high] = spec.adjudicatorScoreRange;
  return Array.from({ length: spec.adjudicatorCount }, (_, index) => ({
    id: `A${index + 1}`,
    name: `Adjudicator ${index + 1}`,
    // Every third adjudicator is independent (no institution).
    institution: index % 3 === 2 ? "" : `I${(index % institutionCount) + 1}`,
    score: round1(low + rng() * (high - low)),
  }));
}

/** Points-then-speaks order, used by the history draws and their byes. */
function historyRanking(teams: Team[]): Team[] {
  return [...teams].sort((a, b) => b.points - a.points || b.speaks - a.speaks || a.id.localeCompare(b.id));
}

function scoreSpeech(style: Style, strength: number, rng: Rng, reply: boolean): number {
  if (style === "bp") return Math.max(60, Math.min(90, Math.round(75 + strength + (rng() - 0.5) * 8)));
  if (reply) return Math.max(35, Math.min(40, Math.round((37.5 + strength / 2 + (rng() - 0.5) * 3) * 2) / 2));
  return Math.max(70, Math.min(80, Math.round(75 + strength + (rng() - 0.5) * 5)));
}

/** One scoresheet: speeches per side plus totals; re-rolled until no two sides tie. */
function scoresheet(spec: FixtureSpec, teams: Team[], ironTeams: Set<string>, rng: Rng): { speeches: Speech[][]; totals: number[] } {
  for (;;) {
    const speeches = teams.map((team) => {
      const substantive = SUBSTANTIVE[spec.style];
      const list: Speech[] = Array.from({ length: substantive }, (_, position) => {
        const iron = ironTeams.has(team.id) && position === substantive - 1;
        return {
          speaker: iron ? team.speakers[0] : team.speakers[position],
          reply: false,
          ghost: iron,
          scores: [scoreSpeech(spec.style, team.strength, rng, false)],
        };
      });
      if (spec.style !== "bp") {
        list.push({ speaker: team.speakers[0], reply: true, ghost: false, scores: [scoreSpeech(spec.style, team.strength, rng, true)] });
      }
      return list;
    });
    const totals = speeches.map((list) => list.reduce((sum, speech) => sum + speech.scores[0], 0));
    if (new Set(totals).size === totals.length) return { speeches, totals };
  }
}

function playRound(
  spec: FixtureSpec,
  seq: number,
  teams: Team[],
  adjudicators: Adjudicator[],
  venues: string[],
  rng: Rng
): Round {
  const sideCount = SIDE_COUNT[spec.style];
  const unavailable = new Set((spec.unavailableTeams[seq] ?? []).map((index) => teams[index].id));
  const available = teams.filter((team) => !unavailable.has(team.id));
  const ordered = seq === 1 ? shuffled(available, rng) : historyRanking(available);
  const byeCount = available.length % sideCount;
  const byes = byeCount ? ordered.slice(ordered.length - byeCount) : [];
  const playing = byeCount ? ordered.slice(0, ordered.length - byeCount) : ordered;
  const ironTeams = new Set((spec.ironPerson[seq] ?? []).map((index) => teams[index].id));
  const rooms = playing.length / sideCount;
  const adjOrder = shuffled(adjudicators, rng);
  const debates: Debate[] = [];
  let nextAdj = 0;
  for (let room = 0; room < rooms; room++) {
    const roomTeams = shuffled(playing.slice(room * sideCount, (room + 1) * sideCount), rng);
    const panelSize = spec.panelSizes[Math.min(room, spec.panelSizes.length - 1)];
    const panel = adjOrder.slice(nextAdj, nextAdj + panelSize).map((adj) => adj.id);
    nextAdj += panelSize;
    const voting = spec.style !== "bp" && panel.length > 1;
    const sheets = (voting ? panel : [panel.join(" ")]).map(() => scoresheet(spec, roomTeams, ironTeams, rng));
    // The speakers are fixed per debate; only the scores vary between ballots.
    const reference = sheets[0].speeches;
    const sides: Side[] = roomTeams.map((team, sideIndex) => ({
      team: team.id,
      ballots: [],
      speeches: reference[sideIndex].map((speech, speechIndex) => ({
        ...speech,
        scores: sheets.map((sheet) => sheet.speeches[sideIndex][speechIndex].scores[0]),
      })),
    }));
    const sheetRanks = sheets.map((sheet) => {
      const order = sheet.totals.map((total, index) => ({ total, index })).sort((a, b) => b.total - a.total);
      const ranks: number[] = [];
      order.forEach(({ index }, place) => { ranks[index] = place + 1; });
      return ranks;
    });
    // Majority decision for two-team voting panels.
    const firstVotes = roomTeams.map((_, sideIndex) => sheetRanks.filter((ranks) => ranks[sideIndex] === 1).length);
    const winnerSide = firstVotes.indexOf(Math.max(...firstVotes));
    sheets.forEach((sheet, sheetIndex) => {
      const adjudicatorsAttr = voting ? panel[sheetIndex] : panel.join(" ");
      const minority = voting ? sheetRanks[sheetIndex][winnerSide] !== 1 : undefined;
      sides.forEach((side, sideIndex) => {
        side.ballots.push({
          adjudicators: adjudicatorsAttr,
          rank: sheetRanks[sheetIndex][sideIndex],
          total: sheet.totals[sideIndex],
          ...(minority !== undefined ? { minority } : {}),
        });
      });
    });
    // Running totals for the history ranking.
    roomTeams.forEach((team, sideIndex) => {
      if (spec.style === "bp") team.points += 4 - sheetRanks[0][sideIndex];
      else team.points += sideIndex === winnerSide ? 1 : 0;
      team.speaks += sheets[0].totals[sideIndex];
    });
    debates.push({ id: `D${seq}_${room + 1}`, venue: venues[room], adjudicators: panel, sides });
  }
  return { seq, debates, byes: byes.map((team) => team.id) };
}

/* -------------------------------------------------------------------------- */
/* DebateXML                                                                  */
/* -------------------------------------------------------------------------- */

function esc(value: string | number): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attrs(values: Record<string, string | number | undefined>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => ` ${key}="${esc(value!)}"`)
    .join("");
}

function writeXml(
  spec: FixtureSpec,
  institutions: { id: string; code: string; name: string }[],
  teams: Team[],
  adjudicators: Adjudicator[],
  rounds: Round[],
  venues: string[]
): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(`<tournament${attrs({ name: spec.title, short: spec.name, style: spec.style })}>`);
  const totalRounds = spec.playedRounds + spec.emptyRounds;
  for (let seq = 1; seq <= totalRounds; seq++) {
    const round = rounds.find((candidate) => candidate.seq === seq);
    lines.push(`  <round${attrs({ name: `Round ${seq}`, abbreviation: `R${seq}`, elimination: "false", "feedback-weight": "0" })}>`);
    for (const debate of round?.debates ?? []) {
      lines.push(`    <debate${attrs({ id: debate.id, chair: debate.adjudicators[0], adjudicators: debate.adjudicators.join(" "), venue: debate.venue, motion: `M${seq}` })}>`);
      for (const side of debate.sides) {
        lines.push(`      <side${attrs({ team: side.team })}>`);
        for (const ballot of side.ballots) {
          const minority = ballot.minority === undefined ? undefined : String(ballot.minority);
          lines.push(`        <ballot${attrs({ adjudicators: ballot.adjudicators, rank: ballot.rank, minority, ignored: minority === undefined ? undefined : minority })}>${ballot.total}</ballot>`);
        }
        for (const speech of side.speeches) {
          const ballots = speech.scores
            .map((score, index) => `<ballot${attrs({ adjudicators: side.ballots[index].adjudicators })}>${score}</ballot>`)
            .join("");
          lines.push(`        <speech${attrs({ speaker: speech.speaker, reply: String(speech.reply), ghost: speech.ghost ? "true" : undefined })}>${ballots}</speech>`);
        }
        lines.push("      </side>");
      }
      lines.push("    </debate>");
    }
    for (const bye of round?.byes ?? []) lines.push(`    <bye>${bye}</bye>`);
    lines.push("  </round>");
  }
  lines.push("  <participants>");
  const eligibility = new Map<string, string[]>();
  for (const category of spec.breakCategories) {
    const members = category.general ? teams.map((_, index) => index) : category.eligible ?? [];
    for (const index of members) eligibility.set(teams[index].id, [...(eligibility.get(teams[index].id) ?? []), category.id]);
  }
  for (const team of teams) {
    lines.push(`    <team${attrs({ id: team.id, name: team.name, "break-eligibilities": (eligibility.get(team.id) ?? []).join(" ") })}>`);
    for (const speaker of team.speakers) {
      lines.push(`      <speaker${attrs({ id: speaker, institutions: team.institution })}>Speaker ${speaker.slice(1)}</speaker>`);
    }
    lines.push("    </team>");
  }
  for (const [index, adj] of adjudicators.entries()) {
    const teamConflicts = spec.adjudicatorTeamConflicts.filter(([a]) => a === index).map(([, t]) => teams[t].id);
    const adjConflicts = spec.adjudicatorConflicts.filter(([a]) => a === index).map(([, b]) => adjudicators[b].id);
    lines.push(`    <adjudicator${attrs({
      id: adj.id,
      name: adj.name,
      institutions: adj.institution,
      score: adj.score,
      "team-conflicts": teamConflicts.join(" "),
      "adjudicator-conflicts": adjConflicts.join(" "),
    })}/>`);
  }
  lines.push("  </participants>");
  for (const institution of institutions) {
    lines.push(`  <institution${attrs({ id: institution.id, reference: institution.code })}>${esc(institution.name)}</institution>`);
  }
  for (let seq = 1; seq <= totalRounds; seq++) {
    lines.push(`  <motion${attrs({ id: `M${seq}`, reference: `Motion ${seq}` })}>This House would test round ${seq}</motion>`);
  }
  venues.forEach((venue, index) => lines.push(`  <venue${attrs({ id: venue, priority: 100 - index })}>Room ${index + 1}</venue>`));
  for (const category of spec.breakCategories) {
    lines.push(`  <break-category${attrs({
      id: category.id,
      "break-size": category.breakSize,
      "reserve-size": category.reserveSize,
      priority: category.priority,
      general: category.general ? "true" : undefined,
    })}>${esc(category.name)}</break-category>`);
  }
  lines.push("</tournament>");
  return `${lines.join("\n")}\n`;
}

function generate(spec: FixtureSpec): { xml: string; config: Record<string, unknown> } {
  const rng = seededRng(spec.seed);
  const { teams, institutions } = buildTeams(spec, rng);
  const adjudicators = buildAdjudicators(spec, institutions.length, rng);
  const roomCount = Math.ceil(teams.length / SIDE_COUNT[spec.style]);
  const venues = Array.from({ length: roomCount + 1 }, (_, index) => `V${index + 1}`);
  const rounds: Round[] = [];
  for (let seq = 1; seq <= spec.playedRounds; seq++) rounds.push(playRound(spec, seq, teams, adjudicators, venues, rng));
  const totalRounds = spec.playedRounds + spec.emptyRounds;
  const unavailableTeams = Object.fromEntries(
    Object.entries(spec.unavailableTeams).map(([seq, indexes]) => [seq, indexes.map((index) => teams[index].id)])
  );
  const config = {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    style: spec.style,
    format: spec.style === "bp" ? "bp" : "two_team",
    seed: spec.seed,
    rounds: { played: spec.playedRounds, total: totalRounds },
    // Every round from 1 to the first empty round is drawn by both engines from the earlier history.
    drawRounds: Array.from({ length: spec.playedRounds + 1 }, (_, index) => index + 1),
    // Standings are compared after every played round.
    standingsAfterRounds: Array.from({ length: spec.playedRounds }, (_, index) => index + 1),
    allocationRound: spec.allocationRound,
    unavailableTeams,
    breakCategories: spec.breakCategories.map(({ eligible: _eligible, ...category }) => category),
    tabbycatPreferences: spec.tabbycatPreferences,
  };
  return { xml: writeXml(spec, institutions, teams, adjudicators, rounds, venues), config };
}

const here = dirname(fileURLToPath(import.meta.url));
for (const spec of FIXTURES) {
  const { xml, config } = generate(spec);
  const directory = join(here, spec.name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "tournament.xml"), xml);
  writeFileSync(join(directory, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  console.log(`wrote ${spec.name}`);
}
