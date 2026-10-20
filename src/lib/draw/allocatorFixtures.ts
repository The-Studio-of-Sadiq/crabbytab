/**
 * Seeded allocation fixtures (test-only). The golden file `allocator.golden.json` holds the output
 * of `autoAllocateAdjudicators` for these cases as computed before the wave 4 performance work;
 * `allocator.golden.test.ts` proves the optimised allocator still returns exactly the same panels.
 */
import type {
  Adjudicator,
  BPSide,
  Debate,
  DebateSide,
  DebateTeamSlot,
  PreformedPanel,
  Team,
  TwoTeamSide,
} from "@/types";
import { createSeededRng, randomInt, type Rng } from "./rng";
import type { AdjudicatorAllocationResult, AllocationOptions, IntelligentAllocationContext } from "./allocator";

export interface AllocationFixture {
  name: string;
  debates: Debate[];
  teamsMap: Map<string, Team>;
  adjudicators: Adjudicator[];
  pastAdjudicatorTeams: Map<string, Set<string>>;
  options: AllocationOptions;
  context: IntelligentAllocationContext;
}

interface FixtureSpec {
  name: string;
  seed: number;
  teamsPerDebate: 2 | 4;
  debates: number;
  adjudicators: number;
  institutions: number;
  traineeEvery?: number;
  /** Fraction of adjudicators with a declared team / adjudicator conflict. */
  conflictRate?: number;
  pastRounds?: number;
  preformedPanels?: number;
  options: Partial<AllocationOptions>;
}

const TWO_SIDES: TwoTeamSide[] = ["AFF", "NEG"];
const BP_SIDES: BPSide[] = ["OG", "OO", "CG", "CO"];

function makeDebate(
  id: string,
  roundId: string,
  teams: Team[],
  sides: DebateSide[],
  extra: Partial<Debate>
): Debate {
  const slots = Object.fromEntries(
    teams.map((team, index) => [sides[index], { teamId: team.id, teamName: team.name, side: sides[index] }])
  ) as Record<DebateSide, DebateTeamSlot>;
  return {
    id,
    tournamentId: "t-fixture",
    roundId,
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: slots,
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...extra,
  };
}

function shuffled<T>(items: T[], rng: Rng): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function buildAllocationFixture(spec: FixtureSpec): AllocationFixture {
  const rng = createSeededRng(spec.seed);
  const sides = spec.teamsPerDebate === 4 ? BP_SIDES : TWO_SIDES;
  const teamCount = spec.debates * spec.teamsPerDebate;
  const teams: Team[] = Array.from({ length: teamCount }, (_, index) => {
    const institution = index % spec.institutions;
    return {
      id: `team-${index + 1}`,
      tournamentId: "t-fixture",
      name: `Team ${index + 1}`,
      institutionId: `inst-${institution + 1}`,
      institutionName: `Institution ${institution + 1}`,
      speakers: [],
      breakCategories: [],
      speakerCategories: [],
      ...(rng() < 0.05 ? { institutionConflictIds: [`inst-${randomInt(rng, spec.institutions) + 1}`] } : {}),
    };
  });
  const adjudicators: Adjudicator[] = Array.from({ length: spec.adjudicators }, (_, index) => {
    const hasInstitution = rng() < 0.7;
    const institution = randomInt(rng, spec.institutions);
    return {
      id: `adj-${index + 1}`,
      tournamentId: "t-fixture",
      name: `Adjudicator ${index + 1}`,
      // Quarter-point scores make exact ties common, as in real tournaments.
      baseScore: 1 + randomInt(rng, 37) / 4,
      trainee: Boolean(spec.traineeEvery) && (index + 1) % spec.traineeEvery! === 0,
      independent: !hasInstitution,
      checkedIn: true,
      conflicts: [],
      ...(hasInstitution
        ? { institutionId: `inst-${institution + 1}`, institutionName: `Institution ${institution + 1}` }
        : {}),
    };
  });
  const conflictRate = spec.conflictRate ?? 0;
  for (const adjudicator of adjudicators) {
    if (rng() < conflictRate) adjudicator.conflicts.push({ type: "personal", teamId: teams[randomInt(rng, teamCount)].id });
    if (rng() < conflictRate) {
      adjudicator.conflicts.push({ type: "personal", adjudicatorId: adjudicators[randomInt(rng, adjudicators.length)].id });
    }
    if (rng() < conflictRate / 2) {
      adjudicator.conflicts.push({ type: "institution", institutionId: `inst-${randomInt(rng, spec.institutions) + 1}` });
    }
  }

  const pastDebates: Debate[] = [];
  for (let round = 1; round <= (spec.pastRounds ?? 0); round++) {
    const order = shuffled(teams, rng);
    const judges = shuffled(adjudicators, rng);
    for (let index = 0; index < spec.debates; index++) {
      const debateTeams = order.slice(index * spec.teamsPerDebate, (index + 1) * spec.teamsPerDebate);
      const panel = judges.slice(index * 2, index * 2 + 2);
      const past = makeDebate(`past-${round}-${index + 1}`, `past-${round}`, debateTeams, sides, {});
      past.adjudicators = {
        chairId: panel[0]?.id,
        panellistIds: panel.slice(1).map((judge) => judge.id),
        panellistNames: [],
        traineeIds: [],
        traineeNames: [],
      };
      pastDebates.push(past);
    }
  }

  const order = shuffled(teams, rng);
  const debates = Array.from({ length: spec.debates }, (_, index) =>
    makeDebate(
      `debate-${index + 1}`,
      "round-now",
      order.slice(index * spec.teamsPerDebate, (index + 1) * spec.teamsPerDebate),
      sides,
      {
        bracket: Math.floor((spec.debates - index) / Math.max(1, Math.floor(spec.debates / 5))),
        roomRank: index + 1,
        importance: rng() < 0.1 ? randomInt(rng, 11) : 0,
        venueId: `venue-${randomInt(rng, 20) + 1}`,
      }
    )
  );

  const preformedPanels: PreformedPanel[] = [];
  const voters = adjudicators.filter((adjudicator) => !adjudicator.trainee);
  for (let index = 0; index < (spec.preformedPanels ?? 0); index++) {
    const members = voters.slice(index * 3, index * 3 + 3);
    preformedPanels.push({
      id: `panel-${index + 1}`,
      chairId: members[0]?.id,
      panellistIds: members.slice(1).map((member) => member.id),
      traineeIds: [],
      importance: randomInt(rng, 11),
    });
  }

  const standings = teams.map((team, index) => ({
    teamId: team.id,
    rank: index + 1,
    points: Math.max(0, 6 - Math.floor(index / Math.max(1, Math.floor(teamCount / 6)))),
  }));

  return {
    name: spec.name,
    debates,
    teamsMap: new Map(teams.map((team) => [team.id, team])),
    adjudicators,
    pastAdjudicatorTeams: new Map(),
    options: {
      panelSize: 3,
      balancePanels: true,
      respectInstitutionConflicts: true,
      respectPersonalConflicts: true,
      respectHistoryConflicts: true,
      ...spec.options,
    },
    context: {
      allPastDebates: pastDebates,
      standings: standings as IntelligentAllocationContext["standings"],
      breakCategories: [{ id: "open", isGeneral: true, breakSize: Math.max(2, Math.floor(teamCount / 8)) }] as IntelligentAllocationContext["breakCategories"],
      totalPrelimRounds: 6,
      completedRounds: spec.pastRounds ?? 0,
      isBP: spec.teamsPerDebate === 4,
      venuePriorities: new Map(Array.from({ length: 20 }, (_, index) => [`venue-${index + 1}`, 20 - (index % 7)])),
      preformedPanels: preformedPanels.length > 0 ? preformedPanels : undefined,
    },
  };
}

export const ALLOCATION_FIXTURES: FixtureSpec[] = [
  {
    name: "two-team, 60 rooms, panels of 3, conflicts and history",
    seed: 101,
    teamsPerDebate: 2,
    debates: 60,
    adjudicators: 200,
    institutions: 25,
    traineeEvery: 9,
    conflictRate: 0.15,
    pastRounds: 3,
    options: { panelSize: 3 },
  },
  {
    name: "two-team, 60 rooms, panel-average strategy",
    seed: 102,
    teamsPerDebate: 2,
    debates: 60,
    adjudicators: 190,
    institutions: 25,
    traineeEvery: 11,
    conflictRate: 0.1,
    pastRounds: 2,
    options: { panelSize: 3, panelStrengthStrategy: "panel_average" },
  },
  {
    name: "BP, 40 rooms, panels by priority up to 5, preformed panels",
    seed: 103,
    teamsPerDebate: 4,
    debates: 40,
    adjudicators: 150,
    institutions: 30,
    traineeEvery: 7,
    conflictRate: 0.1,
    pastRounds: 2,
    preformedPanels: 6,
    options: { panelSize: 5, panelSizing: "by_priority" },
  },
  {
    name: "BP, 30 rooms, fewer adjudicators than slots, no balance",
    seed: 104,
    teamsPerDebate: 4,
    debates: 30,
    adjudicators: 55,
    institutions: 12,
    conflictRate: 0.2,
    pastRounds: 1,
    options: { panelSize: 3, balancePanels: false },
  },
  {
    name: "two-team, 300 rooms, panels of 3 (local search hits its evaluation budget)",
    seed: 105,
    teamsPerDebate: 2,
    debates: 300,
    adjudicators: 1000,
    institutions: 80,
    traineeEvery: 13,
    conflictRate: 0.05,
    pastRounds: 2,
    options: { panelSize: 3 },
  },
];

/** A compact, comparable form of one allocation. */
export function summariseAllocation(result: AdjudicatorAllocationResult): string {
  return [
    result.debateId,
    result.chairId ?? "-",
    result.panellistIds.join(","),
    result.traineeIds.join(","),
    String(result.conflicts.length),
  ].join("|");
}
