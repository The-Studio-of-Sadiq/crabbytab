import { createApiToken, hashApiToken, type ApiTokenScope } from "@/lib/apiTokens";
import { handleApiRequest, type ApiResult, type ApiServices } from "@/lib/api/v1/http";
import { createMemoryApiStore, type MemoryApiStore } from "@/lib/api/v1/memoryStore";
import { MemoryRateLimiter } from "@/lib/api/v1/rateLimit";
import { API_ROUTES } from "@/lib/api/v1/routes";
import type { StoredRecord } from "@/lib/api/v1/store";
import { createSeededRng } from "@/lib/draw/rng";
import type { PublicSourceData, SourceRecord } from "@/lib/publicView/projection";
import { buildPublicViewSections, roundSectionName, sectionRoundIds, type PublicRoundContent } from "@/lib/publicView/snapshot";
import type { PublicViewReader } from "@/lib/publicView/store";
import type { Institution, Motion, Round, Tournament } from "@/types";
import { TournamentHarness } from "./lifecycleHarness";
import { FIXED_TIME, makeAdjudicators, makeTeams, makeTournament, makeVenues, simulateBallot } from "./tournamentFixtures";

/**
 * A small WSDC tournament for API tests, built with the same application commands as the tab room:
 * round 1 drawn, allocated, released and resulted (confirmed ballots); round 2 drawn as a draft.
 */
export async function buildApiTournament(): Promise<TournamentHarness> {
  const tournament: Tournament = makeTournament("wsdc", {
    byeTeamResults: "win",
    pairingMethod: "fold",
    feedbackEnabled: true,
    feedbackQuestions: [{ id: "q-clarity", label: "Clear reasons?", type: "yes_no", required: false }],
    speakerCategories: [
      { id: "spkcat-esl", name: "ESL", slug: "esl", seq: 1, public: true },
      { id: "spkcat-novice", name: "Novice", slug: "novice", seq: 2, public: false },
    ],
  }, "t-api");
  tournament.slug = "api-open";
  const harness = new TournamentHarness(tournament, (round: Round) => 700 + round.seq);
  const id = tournament.id;
  harness.institutions = [1, 2, 3].map((index): Institution => ({
    id: `inst-${index}`,
    tournamentId: id,
    name: `Institution ${index}`,
    code: `I${index}`,
  }));
  harness.teams = makeTeams(8, { tournamentId: id, institutionCount: 3 }).map((team, index) => ({
    ...team,
    privateUrlKey: `team_key${index}`,
    privatePasscode: `pass${index}`,
    breakCategories: index < 6 ? ["bc-open"] : [],
    speakers: team.speakers.map((speaker, speakerIndex) => ({
      ...speaker,
      email: `${speaker.id}@example.test`,
      ...(index === 0 && speakerIndex === 0 ? { categories: ["spkcat-esl", "spkcat-novice"] } : {}),
    })),
  }));
  harness.adjudicators = makeAdjudicators(6, { tournamentId: id, institutionCount: 3 }).map((adjudicator, index) => ({
    ...adjudicator,
    email: `adj${index}@example.test`,
    privateUrlKey: `adj_key${index}`,
    privatePasscode: `adjpass${index}`,
  }));
  harness.venues = makeVenues(5, id);
  harness.breakCategories = [{
    id: "bc-open", tournamentId: id, name: "Open", slug: "open", seq: 1, breakSize: 4, reserveSize: 1,
    isGeneral: true, priority: 1,
  }];
  const r1 = await harness.createRound({ roundSeq: 1, name: "Round 1", abbr: "R1", stage: "preliminary" });
  const r2 = await harness.createRound({ roundSeq: 2, name: "Round 2", abbr: "R2", stage: "preliminary" });
  harness.motions = [
    { id: "motion-1", tournamentId: id, text: "THW released motion", rounds: [r1.id], seq: 1, released: true } satisfies Motion,
    { id: "motion-2", tournamentId: id, text: "THW secret motion", rounds: [r2.id], seq: 2, released: false } satisfies Motion,
  ];
  await harness.generateDraw(r1.id);
  await harness.allocate(r1.id, 1);
  await harness.patchRound(r1.id, { drawStatus: "confirmed", adjudicatorsRevealed: true, motionsReleased: true });
  const rng = createSeededRng(99);
  for (const debate of harness.roundDebates(r1.id)) {
    if (debate.byeTeamId) continue;
    await harness.submitBallot(simulateBallot(debate, harness.teams, harness.tournament, rng));
  }
  await harness.patchRound(r1.id, { resultsReleased: true });
  await harness.completeRound(r1.id);
  await harness.generateDraw(r2.id);
  const firstDebate = harness.roundDebates(r1.id).find((debate) => !debate.byeTeamId)!;
  harness.feedback = [{
    id: "fb-1", tournamentId: id, roundId: r1.id, debateId: firstDebate.id, targetType: "adjudicator",
    targetAdjudicatorId: firstDebate.adjudicators.chairId, sourceType: "team",
    sourceId: firstDebate.teams.AFF.teamId, sourceName: firstDebate.teams.AFF.teamName, score: 4,
    confirmed: true, timestamp: FIXED_TIME,
  }];
  return harness;
}

export function publicReaderFor(tournament: Tournament, collections: Record<string, StoredRecord[]>): PublicViewReader {
  const source = Object.fromEntries(
    ["rounds", "teams", "adjudicators", "debates", "ballots", "motions", "breakCategories", "institutions", "venues"]
      .map((name) => [name, collections[name] ?? []])
  ) as unknown as PublicSourceData;
  const sections = buildPublicViewSections(tournament as unknown as SourceRecord, source);
  return {
    version: "test",
    roundHashes: Object.fromEntries(sectionRoundIds(sections).map((roundId) => [roundId, roundId])),
    readBase: async (section) => sections[section],
    readRound: async (roundId) => sections[roundSectionName(roundId)] as PublicRoundContent | undefined,
  };
}

export interface ApiTestContext {
  harness: TournamentHarness;
  store: MemoryApiStore;
  services: ApiServices;
  token(scopes: ApiTokenScope[]): string;
  call(method: string, path: string, options?: { token?: string; body?: unknown; headers?: Record<string, string>; address?: string }): Promise<ApiResult>;
}

export async function createApiTestContext(harness?: TournamentHarness): Promise<ApiTestContext> {
  const built = harness ?? await buildApiTournament();
  const collections = built.collections() as unknown as Record<string, StoredRecord[]>;
  const tokens: StoredRecord[] = [];
  const store = createMemoryApiStore([{
    tournament: { ...(built.tournament as unknown as StoredRecord) },
    collections,
    apiTokens: tokens,
  }]);
  const tournamentId = built.tournament.id;
  const services: ApiServices = {
    store,
    // The published view reflects the store's current data, like a publish after every change.
    publicView: async () => {
      const entry = store.tournaments.get(tournamentId)!;
      return publicReaderFor(entry.tournament as unknown as Tournament, entry.collections as Record<string, StoredRecord[]>);
    },
    routes: API_ROUTES,
    limiter: new MemoryRateLimiter(),
    now: () => new Date("2026-10-01T12:00:00.000Z"),
  };
  let counter = 0;
  return {
    harness: built,
    store,
    services,
    token(scopes) {
      const secret = createApiToken();
      counter += 1;
      store.tournaments.get(tournamentId)!.apiTokens!.push({
        id: `token-${counter}`,
        name: `Test token ${counter}`,
        scopes,
        tokenHash: hashApiToken(secret),
        createdAt: FIXED_TIME,
      });
      return secret;
    },
    async call(method, path, options = {}) {
      const [pathname, search = ""] = path.split("?");
      const body = options.body === undefined ? "" : JSON.stringify(options.body);
      const headers = new Headers({
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      });
      return handleApiRequest({
        method,
        path: pathname,
        searchParams: new URLSearchParams(search),
        headers,
        text: async () => body,
        clientAddress: options.address ?? "203.0.113.7",
      }, services);
    },
  };
}
