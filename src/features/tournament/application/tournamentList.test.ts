import { describe, expect, it } from "vitest";

import { tournamentsToList, type TournamentSummary } from "./tournamentList";

const summary = (id: string, createdAt: string): TournamentSummary => ({
  id,
  slug: id,
  name: id.toUpperCase(),
  format: "bp",
  createdAt,
});

describe("tournaments to list", () => {
  const deviceOnly = { ...summary("local", "2026-03-01") };
  const cloudCopy = { ...summary("cloud", "2026-02-01"), syncVersion: 4 };
  const otherCloudCopy = { ...summary("other", "2026-01-01"), syncVersion: 2 };

  it("always lists tournaments that exist only on this device, signed in or not", () => {
    expect(tournamentsToList({ server: [summary("cloud", "2026-02-01")], device: [deviceOnly, cloudCopy], isGlobalAdmin: false })
      .map((tournament) => tournament.id)).toEqual(["local", "cloud"]);
  });

  it("online, lists cloud copies on the device only if the server lists them (or for a global admin)", () => {
    expect(tournamentsToList({ server: [], device: [otherCloudCopy], isGlobalAdmin: false })).toEqual([]);
    expect(tournamentsToList({ server: [], device: [otherCloudCopy], isGlobalAdmin: true }).map((t) => t.id)).toEqual(["other"]);
  });

  it("signed out or offline, lists every tournament on the device, newest first", () => {
    expect(tournamentsToList({ server: null, device: [otherCloudCopy, deviceOnly, cloudCopy], isGlobalAdmin: false })
      .map((tournament) => tournament.id)).toEqual(["local", "cloud", "other"]);
  });

  it("skips malformed device records and keeps the server's version of a listed tournament", () => {
    const fromServer = { ...summary("cloud", "2026-02-01"), name: "Server name" };
    expect(tournamentsToList({
      server: [fromServer],
      device: [{ id: "broken" }, { ...cloudCopy, name: "Device name" }],
      isGlobalAdmin: false,
    })).toEqual([fromServer]);
  });
});
