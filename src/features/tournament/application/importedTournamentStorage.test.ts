import { describe, expect, it } from "vitest";
import { LocalStore, createMemoryBackend } from "@/lib/offline/localStore";
import type { ImportedTournament } from "./debateXmlImport";
import { isSlugUsedOnDevice, saveImportedTournamentLocally } from "./importedTournamentStorage";

function memoryStore(initial: Record<string, string> = {}) {
  const backend = createMemoryBackend(initial);
  return { backend, store: new LocalStore(Promise.resolve(backend)) };
}

function imported(slug = "spring"): ImportedTournament {
  return {
    tournament: { id: `tourn-${slug}`, slug, name: "Spring" } as ImportedTournament["tournament"],
    collections: {
      rounds: [{ id: "round-1" }] as ImportedTournament["collections"]["rounds"],
      teams: [],
      adjudicators: [],
      venues: [],
      motions: [],
      breakCategories: [{ id: "open" }] as ImportedTournament["collections"]["breakCategories"],
      debates: [],
      ballots: [],
      feedback: [],
      institutions: [],
    },
  };
}

describe("saving an imported tournament on the device", () => {
  it("writes every collection under the tournament's keys", async () => {
    const { backend, store } = memoryStore();
    await saveImportedTournamentLocally(store, imported());
    expect(await isSlugUsedOnDevice(store, "spring")).toBe(true);
    expect(JSON.parse(backend.data.get("crabbytab_t_spring_breaks")!)).toEqual([{ id: "open" }]);
    expect(JSON.parse(backend.data.get("crabbytab_t_spring_rounds")!)).toEqual([{ id: "round-1" }]);
    expect(backend.data.get("crabbytab_t_spring_auditEvents")).toBe("[]");
    expect(backend.data.size).toBe(12);
  });

  it("never overwrites an existing tournament", async () => {
    const { backend, store } = memoryStore({ crabbytab_t_spring_meta: "{}" });
    await expect(saveImportedTournamentLocally(store, imported())).rejects.toThrow("already exists");
    expect(backend.data.size).toBe(1);
  });

  it("leaves nothing behind when storage fails", async () => {
    const { backend, store } = memoryStore();
    backend.failWrites = new Error("QuotaExceededError");
    await expect(saveImportedTournamentLocally(store, imported())).rejects.toThrow("Nothing was imported");
    expect(backend.data.size).toBe(0);
    expect(await isSlugUsedOnDevice(store, "spring")).toBe(false);
  });
});
