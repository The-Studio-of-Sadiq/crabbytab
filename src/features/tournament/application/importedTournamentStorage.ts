import type { ImportedTournament } from "@/features/tournament/application/debateXmlImport";
import type { LocalStore } from "@/lib/offline/localStore";

type TournamentStore = Pick<LocalStore, "read" | "writeAll">;

/** The device keys TournamentContext reads for a tournament, by suffix. */
const LOCAL_KEYS = {
  meta: "meta",
  rounds: "rounds",
  teams: "teams",
  adjudicators: "adjudicators",
  venues: "venues",
  motions: "motions",
  breakCategories: "breaks",
  debates: "debates",
  ballots: "ballots",
  feedback: "feedback",
  institutions: "institutions",
  auditEvents: "auditEvents",
} as const;

export function localTournamentPrefix(slug: string): string {
  return `crabbytab_t_${slug}`;
}

export async function isSlugUsedOnDevice(store: TournamentStore, slug: string): Promise<boolean> {
  return (await store.read(`${localTournamentPrefix(slug)}_meta`)) !== null;
}

/**
 * Saves an imported tournament as a new tournament on this device. Never overwrites an existing
 * tournament, and writes all collections in one transaction, so a failure (e.g. quota exceeded)
 * leaves nothing behind.
 */
export async function saveImportedTournamentLocally(store: TournamentStore, imported: ImportedTournament): Promise<void> {
  const prefix = localTournamentPrefix(imported.tournament.slug);
  if (await isSlugUsedOnDevice(store, imported.tournament.slug)) {
    throw new Error(`A tournament with the URL "${imported.tournament.slug}" already exists on this device.`);
  }
  const { collections } = imported;
  const values: Array<[string, unknown]> = [
    [LOCAL_KEYS.rounds, collections.rounds],
    [LOCAL_KEYS.teams, collections.teams],
    [LOCAL_KEYS.adjudicators, collections.adjudicators],
    [LOCAL_KEYS.venues, collections.venues],
    [LOCAL_KEYS.motions, collections.motions],
    [LOCAL_KEYS.breakCategories, collections.breakCategories],
    [LOCAL_KEYS.debates, collections.debates],
    [LOCAL_KEYS.ballots, collections.ballots],
    [LOCAL_KEYS.feedback, collections.feedback],
    [LOCAL_KEYS.institutions, collections.institutions],
    [LOCAL_KEYS.auditEvents, []],
    [LOCAL_KEYS.meta, imported.tournament],
  ];
  try {
    await store.writeAll(values.map(([suffix, value]) => [`${prefix}_${suffix}`, JSON.stringify(value)]));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`The tournament could not be saved on this device (${detail}). Nothing was imported.`);
  }
}
