import { describe, expect, it } from "vitest";
import { tournamentFormatLabel } from "./roundStatus";

describe("tournamentFormatLabel", () => {
  it("names each format, not UADC for every two-team format", () => {
    expect(tournamentFormatLabel("wsdc")).toBe("WSDC");
    expect(tournamentFormatLabel("australs")).toBe("Australs");
    expect(tournamentFormatLabel("uadc")).toBe("UADC (2-Team)");
    expect(tournamentFormatLabel("bp")).toBe("BP (4-Team)");
    expect(tournamentFormatLabel("poly")).toBe("N teams per room");
  });
});
