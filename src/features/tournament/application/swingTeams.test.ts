import { describe, expect, it } from "vitest";
import { makeRound, makeTeams, makeTournament } from "@/test/tournamentFixtures";
import { buildSwingTeam, roundFieldSize, swingTeamsNeeded, validateSwingTeam, withoutSwingRound, withSwingRound } from "./swingTeams";

const tournament = makeTournament("bp");
const teams = makeTeams(6, { tournamentId: tournament.id, speakersPerTeam: 2 });
const round = makeRound(tournament.id, 1);

describe("swing teams", () => {
  it("counts the swing teams a BP room needs", () => {
    const field = roundFieldSize(tournament, round, teams);
    expect(field).toEqual({ available: 6, teamsPerDebate: 4, excess: 2 });
    expect(swingTeamsNeeded(field)).toBe(2);
    expect(swingTeamsNeeded(roundFieldSize(tournament, round, teams.slice(0, 4)))).toBe(0);
  });

  it("builds a swing team available only in its round, with fresh speaker ids", () => {
    const team = buildSwingTeam({
      name: " Swing ",
      speakers: [{ name: "Reserve", sourceSpeakerId: undefined }, { name: teams[0].speakers[1].name, sourceSpeakerId: teams[0].speakers[1].id }],
      round,
      teams,
      tournament,
    }, (index) => `sw-${index}`);
    expect(team).toMatchObject({
      name: "Swing",
      isSwing: true,
      swingRoundIds: [round.id],
      roundAvailability: { [round.id]: true },
      breakCategories: [],
    });
    expect(team.speakers).toEqual([
      { id: "sw-0", name: "Reserve" },
      { id: "sw-1", name: teams[0].speakers[1].name, swingSourceSpeakerId: teams[0].speakers[1].id },
    ]);
  });

  it("explains every invalid request", () => {
    const problems = validateSwingTeam({
      name: teams[0].name,
      speakers: [{ name: "Same" }, { name: "same" }, { name: "Ghost", sourceSpeakerId: "nobody" }],
      round: { ...round, stage: "elimination" },
      teams,
      tournament,
    });
    expect(problems).toEqual([
      `A team called ${teams[0].name} already exists.`,
      "Swing teams can only debate in preliminary rounds.",
      "A swing team needs 2 speakers; 3 given.",
      "Each swing speaker must be a different person.",
      "Ghost is not a registered speaker.",
    ]);
    expect(() => buildSwingTeam({ name: "", speakers: [], round, teams, tournament }, String)).toThrow(/name/);
  });

  it("adds and removes rounds", () => {
    const team = { id: "s", tournamentId: tournament.id, ...buildSwingTeam({
      name: "Swing", speakers: [{ name: "One" }, { name: "Two" }], round, teams, tournament,
    }, String) };
    const round2 = makeRound(tournament.id, 2);
    const twice = withSwingRound(team, round2);
    expect(twice.swingRoundIds).toEqual([round.id, round2.id]);
    expect(withSwingRound(twice, round2)).toBe(twice);
    const once = withoutSwingRound(twice, round);
    expect(once.swingRoundIds).toEqual([round2.id]);
    expect(once.roundAvailability?.[round.id]).toBe(false);
    expect(() => withSwingRound(teams[0], round2)).toThrow(/not a swing team/);
  });
});
