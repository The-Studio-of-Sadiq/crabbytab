import type { ImportedTournament } from "@/features/tournament/application/debateXmlImport";
import { createSeededRng, randomInt, shuffle, type Rng } from "@/lib/draw/rng";
import { buildBreakCategories, buildRounds, defaultPreferences } from "@/lib/setup/presets";
import type { Adjudicator, Institution, Motion, Team, TournamentPreferences, Venue } from "@/types";

/**
 * A demo tournament for rehearsals and training (Tabbycat ships loadable demo tournaments):
 * institutions, teams with speakers, adjudicators with scores and conflicts, venues, preliminary
 * and elimination rounds, motions and break categories, all generated from a seed so the same seed
 * always gives the same tournament. It has no draws or results; use the rehearsal tools to
 * simulate them.
 *
 * Demo tournaments are recognisable by their slug prefix and name prefix (`isDemoTournament`).
 */

export const DEMO_SLUG_PREFIX = "demo-";
export const DEMO_NAME_PREFIX = "Demo — ";

export type DemoFormat = "bp" | "wsdc";

export interface DemoTournamentOptions {
  format: DemoFormat;
  /** Must start with "demo-". */
  slug: string;
  ownerId: string;
  seed?: number;
  /** Fixed time for every timestamp (default: now). */
  now?: Date;
}

export function isDemoTournament(tournament: { slug?: string; name?: string } | null | undefined): boolean {
  return Boolean(tournament?.slug?.startsWith(DEMO_SLUG_PREFIX));
}

const INSTITUTIONS = [
  ["Northgate University", "NGU", "North"],
  ["Riverside College", "RVC", "North"],
  ["St Brendan's", "STB", "West"],
  ["Lakeshore Institute", "LKI", "West"],
  ["Eastfield University", "EFU", "East"],
  ["Harbour City College", "HCC", "East"],
  ["Summit Academy", "SMA", "South"],
  ["Meadowbank School", "MBS", "South"],
] as const;

const FIRST_NAMES = [
  "Amara", "Bilal", "Chen", "Dalia", "Emeka", "Farah", "Gustavo", "Hana", "Ibrahim", "Jun", "Kiran", "Lena",
  "Mateo", "Nadia", "Oluwa", "Priya", "Quinn", "Rafael", "Sana", "Tomás", "Uma", "Viktor", "Wen", "Yara", "Zain",
];
const LAST_NAMES = [
  "Adeyemi", "Bose", "Castillo", "Dubois", "Eriksen", "Fernandes", "Gupta", "Haddad", "Ito", "Jensen", "Kowalski",
  "Lindqvist", "Mensah", "Nakamura", "Okafor", "Petrov", "Quraishi", "Rossi", "Silva", "Tanaka", "Usman", "Varga",
];

const MOTIONS = [
  ["This House would ban private cars from city centres", "Urban policy"],
  ["This House believes that social media has done more harm than good to democracy", "Technology"],
  ["This House would make voting compulsory", "Politics"],
  ["This House regrets the rise of influencer culture", "Culture"],
  ["This House would abolish standardised testing in schools", "Education"],
  ["This House supports a universal basic income", "Economics"],
  ["This House would allow the sale of human organs", "Ethics"],
  ["This House believes that space exploration should be left to private companies", "Science"],
] as const;

function personName(rng: Rng, used: Set<string>): string {
  for (;;) {
    const name = `${FIRST_NAMES[randomInt(rng, FIRST_NAMES.length)]} ${LAST_NAMES[randomInt(rng, LAST_NAMES.length)]}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
}

export function buildDemoTournament(options: DemoTournamentOptions): ImportedTournament {
  if (!options.slug.startsWith(DEMO_SLUG_PREFIX)) throw new Error(`A demo tournament's URL must start with "${DEMO_SLUG_PREFIX}".`);
  const rng = createSeededRng(options.seed ?? 20261020);
  const now = (options.now ?? new Date()).toISOString();
  const isBP = options.format === "bp";
  const tournamentId = `tourn-${options.slug}`;
  const teamCount = isBP ? 24 : 16;
  const speakersPerTeam = isBP ? 2 : 3;
  const adjudicatorCount = isBP ? 16 : 14;
  const venueCount = isBP ? 8 : 10;
  const prelimRounds = isBP ? 5 : 4;
  const openBreak = isBP ? 8 : 4;
  const eslBreak = isBP ? 4 : 2;

  const preferences: TournamentPreferences = {
    ...defaultPreferences(options.format),
    feedbackQuestions: [
      { id: "demo-clarity", label: "Was the decision explained clearly?", type: "yes_no", required: true },
      { id: "demo-rating", label: "Overall adjudication quality", type: "integer_scale", required: false, min: 1, max: 5 },
      { id: "demo-comments", label: "Comments", type: "textarea", required: false },
    ],
    speakerCategories: [
      { id: "spkcat-esl", name: "ESL", slug: "esl", seq: 1, public: true },
      { id: "spkcat-novice", name: "Novice", slug: "novice", seq: 2, public: true },
    ],
  };

  const institutions: Institution[] = INSTITUTIONS.map(([name, code, region], index) => ({
    id: `inst-demo-${index + 1}`,
    tournamentId,
    name,
    code,
    region,
  }));

  const usedNames = new Set<string>();
  const breakCategories = buildBreakCategories(tournamentId, [
    { key: "open", name: "Open", breakSize: openBreak, reserveSize: 2, isGeneral: true },
    { key: "esl", name: "ESL", breakSize: eslBreak, reserveSize: 1, isGeneral: false },
  ]);
  const [openCategory, eslCategory] = breakCategories;
  eslCategory.speakerCategoryRule = { speakerCategoryId: "spkcat-esl" };

  const teamsPerInstitution = new Map<string, number>();
  const teams: Team[] = Array.from({ length: teamCount }, (_, index) => {
    const institution = institutions[index % institutions.length];
    const letter = String.fromCharCode(65 + (teamsPerInstitution.get(institution.id) ?? 0));
    teamsPerInstitution.set(institution.id, (teamsPerInstitution.get(institution.id) ?? 0) + 1);
    const esl = rng() < 0.25;
    const speakers = Array.from({ length: speakersPerTeam }, (_, speakerIndex) => ({
      id: `spk-demo-${index + 1}-${speakerIndex + 1}`,
      name: personName(rng, usedNames),
      categories: [...(esl ? ["spkcat-esl"] : []), ...(rng() < 0.2 ? ["spkcat-novice"] : [])],
    }));
    return {
      id: `team-demo-${index + 1}`,
      tournamentId,
      name: `${institution.code} ${letter}`,
      institutionId: institution.id,
      institutionName: institution.name,
      speakers,
      breakCategories: [openCategory.id, ...(esl ? [eslCategory.id] : [])],
      speakerCategories: [],
      checkedIn: true,
    };
  });

  const adjudicators: Adjudicator[] = Array.from({ length: adjudicatorCount }, (_, index) => {
    // Every third adjudicator is independent; the rest belong to an institution (always a conflict).
    const independent = index % 3 === 0;
    const institution = independent ? undefined : institutions[index % institutions.length];
    return {
      id: `adj-demo-${index + 1}`,
      tournamentId,
      name: personName(rng, usedNames),
      ...(institution ? { institutionId: institution.id, institutionName: institution.name } : {}),
      baseScore: Math.round((2 + rng() * 7) * 10) / 10,
      trainee: index >= adjudicatorCount - 2,
      independent,
      adjCore: index < 2,
      checkedIn: true,
      conflicts: [],
    };
  });
  // A few personal conflicts, as real tournaments have.
  for (const adjudicator of shuffle(adjudicators, rng).slice(0, 3)) {
    const team = teams[randomInt(rng, teams.length)];
    if (team.institutionId !== adjudicator.institutionId) adjudicator.conflicts.push({ teamId: team.id, type: "personal" });
  }

  const venues: Venue[] = Array.from({ length: venueCount }, (_, index) => ({
    id: `venue-demo-${index + 1}`,
    tournamentId,
    name: `Room ${101 + index}`,
    priority: venueCount - index,
    capacity: 30,
    available: true,
    ...(index === 0 ? { accessible: true, nearTabRoom: true } : {}),
  }));

  const rounds = buildRounds({
    tournamentId,
    prelimRounds,
    maxBreakSize: openBreak,
    teamsInDebate: isBP ? 4 : 2,
    drawRule: "power_paired",
  }).map((round) => ({ ...round, createdAt: now }));
  for (const round of rounds.filter((item) => item.stage === "elimination")) {
    round.breakCategoryIds = [openCategory.id];
  }

  const motionOrder = shuffle(MOTIONS, rng);
  const motions: Motion[] = rounds.map((round, index) => {
    const [text, reference] = motionOrder[index % motionOrder.length];
    return {
      id: `motion-demo-${round.seq}`,
      tournamentId,
      text,
      reference: `${round.name}: ${reference}`,
      rounds: [round.id],
      seq: round.seq,
      released: false,
    };
  });

  const name = `${DEMO_NAME_PREFIX}${isBP ? "BP" : "WSDC"} Open`;
  return {
    tournament: {
      id: tournamentId,
      name,
      nameLower: name.toLowerCase(),
      shortName: "Demo",
      slug: options.slug,
      format: options.format,
      active: true,
      ownerId: options.ownerId,
      admins: { [options.ownerId]: true },
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
      debates: [],
      ballots: [],
      feedback: [],
      institutions,
    },
  };
}
