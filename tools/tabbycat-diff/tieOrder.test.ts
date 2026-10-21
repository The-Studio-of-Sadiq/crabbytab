/**
 * Why the twoteam-odd-ties draws differ from Tabbycat's (see known-differences.json).
 *
 * Tabbycat ranks teams tied on every standings metric in its Team model order (institution name,
 * then short reference): with an SQL-ranked precedence, `Standings.sort_from_rankings` sorts the
 * standings in the order the teams queryset returned them, so the "random" tie-break never reaches
 * the order (standings/base.py). Its bye ("lowest") and every fold then follow that fixed order,
 * which is why its eight samples are identical. CrabbyTab breaks those ties with the draw's seeded
 * RNG instead (AGENTS.md 7.2). This test pins down that the order is the only difference: given
 * Tabbycat's tie order, CrabbyTab's power-paired draw (fold, pull-up from top, one-up-one-down)
 * pairs exactly the rooms Tabbycat paired, and gives the bye to the same team.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { generateRoundDraw } from "@/lib/draw/generator";
import { calculateStandings } from "@/lib/standings/calculator";

import { loadFixture } from "./harness/crabbytab";
import type { EngineOutput } from "./harness/types";

const FIXTURE = "twoteam-odd-ties";
const dir = join(__dirname, "fixtures", FIXTURE);
const golden = JSON.parse(readFileSync(join(__dirname, "golden", `${FIXTURE}.tabbycat.json`), "utf8")) as EngineOutput;
const fixture = loadFixture(dir, golden.preferences ?? {});

const pairKey = (teams: string[]) => [...teams].sort().join("|");

describe("twoteam-odd-ties: CrabbyTab's draw with Tabbycat's tie order", () => {
  it.each([2, 3, 4, 5])("round %i pairs the same rooms and bye as Tabbycat", (seq) => {
    const seqOf = new Map(fixture.data.rounds.map((round) => [round.id, round.seq]));
    const debates = fixture.data.debates.filter((debate) => (seqOf.get(debate.roundId) ?? Infinity) < seq);
    const debateIds = new Set(debates.map((debate) => debate.id));
    const ballots = fixture.data.ballots.filter((ballot) => debateIds.has(ballot.debateId));
    const rounds = fixture.data.rounds.filter((round) => round.seq < seq);
    const { teams: standings } = calculateStandings(fixture.tournament, rounds, fixture.data.teams, debates, ballots);
    // Team names are "<institution> <reference>", so name order is Tabbycat's model order. Distinct
    // ranks stop CrabbyTab shuffling the ties; brackets still come from the wins metric.
    const tabbycatOrder = [...standings]
      .sort((a, b) => a.rank - b.rank || a.teamName.localeCompare(b.teamName))
      .map((row, index) => ({ ...row, rank: index + 1 }));

    const round = fixture.data.rounds.find((candidate) => candidate.seq === seq)!;
    const draw = generateRoundDraw({
      tournament: fixture.tournament,
      round: { ...round, drawType: "power_paired", drawStatus: "none", completed: false },
      teams: fixture.data.teams,
      institutions: fixture.data.institutions,
      venues: fixture.data.venues,
      pastDebates: debates,
      standings: tabbycatOrder,
      seed: 1,
    });

    const expected = golden.draws.find((candidate) => candidate.round === seq)!;
    const rooms = (list: { teams: { team: string }[] }[]) => list.map((debate) => pairKey(debate.teams.map((slot) => slot.team))).sort();
    const crabbyRooms = draw
      .filter((debate) => !debate.byeTeamId)
      .map((debate) => pairKey(Object.values(debate.teams).flatMap((slot) => (slot?.teamId ? [slot.teamId] : []))))
      .sort();
    expect(crabbyRooms).toEqual(rooms(expected.debates ?? []));
    expect(draw.flatMap((debate) => (debate.byeTeamId ? [debate.byeTeamId] : []))).toEqual(expected.byes);
  });
});
