import { describe, expect, it } from "vitest";
import type { BreakCategory, BreakQualificationRule, Team, TeamStandingRow } from "@/types";
import { aidaInstitutionCap, calculateBreaks } from "./calculator";

/**
 * Golden cases for AIDA 2019 Australs (open), worked by hand from Tabbycat v2.12.1
 * breakqual/aida.py: Aida2019AustralsBreakGenerator is the AIDA 2016 Australs procedure with
 * institution_cap = 3 + floor(max(0, break_size − 16) / 8).
 */

function category(rule: BreakQualificationRule, breakSize: number): BreakCategory {
  return {
    id: "open",
    tournamentId: "t1",
    name: "Open",
    slug: "open",
    seq: 1,
    breakSize,
    reserveSize: 0,
    isGeneral: true,
    priority: 1,
    qualificationRule: rule,
  };
}

/**
 * 40 teams ranked 1..40. Ranks 1-30 have 5 wins, the rest 2, so the wins cutoff keeps 30 teams.
 * Institution A holds ranks 1-5, institution B ranks 6 and 25; everyone else is alone.
 */
function field(): { teams: Team[]; standings: TeamStandingRow[] } {
  const institutionOf = (rank: number) =>
    rank <= 5 ? "inst-a" : rank === 6 || rank === 25 ? "inst-b" : `inst-${rank}`;
  const teams: Team[] = Array.from({ length: 40 }, (_, index) => ({
    id: `r${index + 1}`,
    tournamentId: "t1",
    name: `Rank ${index + 1}`,
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
    institutionId: institutionOf(index + 1),
  }));
  const standings: TeamStandingRow[] = teams.map((team, index) => ({
    rank: index + 1,
    teamId: team.id,
    teamName: team.name,
    points: index < 30 ? 5 : 2,
    wins: index < 30 ? 5 : 2,
    totalSpeakerScore: 1000 - index,
    averageSpeakerScore: 0,
    breakCategories: [],
    roundResults: [],
    metrics: { wins: index < 30 ? 5 : 2, speaks_sum: 1000 - index } as TeamStandingRow["metrics"],
  }));
  return { teams, standings };
}

const ranksOf = (ids: string[]) => ids.map((id) => Number(id.slice(1)));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("AIDA 2019 Australs (open) institution cap", () => {
  it("starts at 3 and adds one per 8 teams beyond a 16-team break", () => {
    expect([8, 16, 23, 24, 31, 32, 40].map((size) => aidaInstitutionCap("aida_2019_australs_open", size)))
      .toEqual([3, 3, 3, 4, 4, 5, 6]);
    expect(aidaInstitutionCap("aida_2016_australs", 40)).toBe(3);
  });

  it("lets a fourth team from one institution break in a 24-team break", () => {
    const { teams, standings } = field();
    const result = calculateBreaks([category("aida_2019_australs_open", 24)], teams, standings, "australs")[0];
    // Cap 4: A's fifth team (rank 5) is capped pre-cutoff; B's rank-25 team is capped post-cutoff.
    expect(ranksOf(result.breakingTeams.map((entry) => entry.team.id))).toEqual([...range(1, 4), ...range(6, 24), 26]);
    const capped = result.excludedTeams.filter((entry) => entry.reason === "capped").map((entry) => entry.team.id);
    expect(ranksOf(capped).sort((a, b) => a - b)).toEqual([5, 25]);
  });

  it("matches AIDA 2016 Australs (cap 3) for the same 24-team break", () => {
    const { teams, standings } = field();
    const result = calculateBreaks([category("aida_2016_australs", 24)], teams, standings, "australs")[0];
    expect(ranksOf(result.breakingTeams.map((entry) => entry.team.id))).toEqual([...range(1, 3), ...range(6, 24), 26, 27]);
  });

  it("keeps the cap at 3 for a 23-team break", () => {
    const { teams, standings } = field();
    const result = calculateBreaks([category("aida_2019_australs_open", 23)], teams, standings, "australs")[0];
    // Natural cutoff is rank 23, so rank 25 (B's second) is post-cutoff capped; A's 4th and 5th are capped.
    expect(ranksOf(result.breakingTeams.map((entry) => entry.team.id))).toEqual([...range(1, 3), ...range(6, 24), 26]);
  });

  it("is refused for BP, like the AIDA 2016 rules", () => {
    expect(() => calculateBreaks([category("aida_2019_australs_open", 16)], [], [], "bp"))
      .toThrow("require a two-team tournament format");
  });
});
