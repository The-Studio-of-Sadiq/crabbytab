import type { ImportedTournament } from "@/features/tournament/application/debateXmlImport";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

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

export function isSlugUsedOnDevice(storage: KeyValueStorage, slug: string): boolean {
  return storage.getItem(`${localTournamentPrefix(slug)}_meta`) !== null;
}

/**
 * Saves an imported tournament as a new tournament on this device. Never overwrites an existing
 * tournament, and removes everything it wrote if storage fails part-way (e.g. quota exceeded).
 */
export function saveImportedTournamentLocally(storage: KeyValueStorage, imported: ImportedTournament): void {
  const prefix = localTournamentPrefix(imported.tournament.slug);
  if (isSlugUsedOnDevice(storage, imported.tournament.slug)) {
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
    // Written last: a tournament only "exists" on the device once every collection is saved.
    [LOCAL_KEYS.meta, imported.tournament],
  ];
  const written: string[] = [];
  try {
    for (const [suffix, value] of values) {
      const key = `${prefix}_${suffix}`;
      storage.setItem(key, JSON.stringify(value));
      written.push(key);
    }
  } catch (error) {
    for (const key of written) storage.removeItem(key);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`The tournament could not be saved on this device (${detail}). Nothing was imported.`);
  }
}
