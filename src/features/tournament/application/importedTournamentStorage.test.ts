import { describe, expect, it } from "vitest";
import type { ImportedTournament } from "./debateXmlImport";
import { isSlugUsedOnDevice, saveImportedTournamentLocally } from "./importedTournamentStorage";

class MemoryStorage {
  readonly data = new Map<string, string>();
  failOn?: string;

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failOn && key.endsWith(this.failOn)) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }

  removeItem(key: string) {
    this.data.delete(key);
  }
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
  it("writes every collection under the tournament's keys", () => {
    const storage = new MemoryStorage();
    saveImportedTournamentLocally(storage, imported());
    expect(isSlugUsedOnDevice(storage, "spring")).toBe(true);
    expect(JSON.parse(storage.getItem("crabbytab_t_spring_breaks")!)).toEqual([{ id: "open" }]);
    expect(JSON.parse(storage.getItem("crabbytab_t_spring_rounds")!)).toEqual([{ id: "round-1" }]);
    expect(storage.getItem("crabbytab_t_spring_auditEvents")).toBe("[]");
    expect(storage.data.size).toBe(12);
  });

  it("never overwrites an existing tournament", () => {
    const storage = new MemoryStorage();
    storage.setItem("crabbytab_t_spring_meta", "{}");
    expect(() => saveImportedTournamentLocally(storage, imported())).toThrow("already exists");
    expect(storage.data.size).toBe(1);
  });

  it("removes partial writes when storage fails", () => {
    const storage = new MemoryStorage();
    storage.failOn = "_ballots";
    expect(() => saveImportedTournamentLocally(storage, imported())).toThrow("Nothing was imported");
    expect(storage.data.size).toBe(0);
  });
});
