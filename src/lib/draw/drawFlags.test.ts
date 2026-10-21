import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, DebateSide, Round, Team, TeamStandingRow } from "@/types";
import { makeRound, makeTeams, makeTournament } from "@/test/tournamentFixtures";
import { buildDrawDetails, computeDrawFlags, type TeamFlag } from "./drawFlags";
import { moveTeam } from "./drawEditing";
import { MANUAL_SIDES_FLAG } from "./manualSides";

const tournament = makeTournament("custom_2team");
const teams: Team[] = makeTeams(4, { tournamentId: tournament.id }).map((team, index) => ({
  ...team,
  // Teams 2 and 4 share an institution.
  ...(index === 1 || index === 3 ? { institutionId: "inst-x", institutionName: "X University" } : {}),
}));
const [t1, t2, t3, t4] = teams;
const rounds: Round[] = [1, 2, 3, 4].map((seq) => makeRound(tournament.id, seq));

function room(round: Round, aff: Team, neg: Team, extra: Partial<Debate> = {}): Debate {
  return {
    id: `${round.id}-${aff.id}`,
    tournamentId: tournament.id,
    roundId: round.id,
    roundSeq: round.seq,
    venueName: `Room ${aff.id}`,
    bracket: 1,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: {
      AFF: { teamId: aff.id, teamName: aff.name, side: "AFF" },
      NEG: { teamId: neg.id, teamName: neg.name, side: "NEG" },
    } as Debate["teams"],
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...extra,
  };
}

// Team 1 was AFF in R1-R3; it met Team 3 in R1 and R3. R2's sides were chosen on the ballot.
const history: Debate[] = [
  room(rounds[0], t1, t3),
  room(rounds[0], t2, t4),
  room(rounds[1], t1, t4, { flags: [MANUAL_SIDES_FLAG], sidesConfirmed: false, id: "r2-pending" }),
  room(rounds[1], t2, t3),
  room(rounds[2], t1, t3, { teams: {
    AFF: { teamId: t1.id, teamName: t1.name, side: "AFF", pulledUp: true },
    NEG: { teamId: t3.id, teamName: t3.name, side: "NEG" },
  } as Debate["teams"] }),
  room(rounds[2], t4, t2),
];
const r2Ballot: BallotSubmission = {
  id: "b-r2", tournamentId: tournament.id, roundId: rounds[1].id, debateId: "r2-pending", version: 1,
  confirmed: true, discarded: false, submitterType: "tabroom", timestamp: "",
  speakerScores: {} as BallotSubmission["speakerScores"],
  teamScores: {
    AFF: { side: "AFF", teamId: t1.id, points: 1, totalSpeakerScore: 1 },
    NEG: { side: "NEG", teamId: t4.id, points: 0, totalSpeakerScore: 0 },
  } as BallotSubmission["teamScores"],
};

const current = [
  room(rounds[3], t1, t3, { id: "now-1", bracket: 2, roomRank: 1, teams: {
    AFF: { teamId: t1.id, teamName: t1.name, side: "AFF", pulledUp: true },
    NEG: { teamId: t3.id, teamName: t3.name, side: "NEG" },
  } as Debate["teams"] }),
  room(rounds[3], t2, t4, { id: "now-2", bracket: 1, roomRank: 2 }),
];
const input = {
  tournament,
  round: rounds[3],
  rounds,
  debates: [...history, ...current],
  ballots: [r2Ballot],
  teams,
  adjudicators: [],
  venues: [],
};

const kinds = (flags: TeamFlag[] | undefined) => (flags ?? []).map((flag) => flag.kind);

describe("computeDrawFlags", () => {
  const flags = computeDrawFlags(input);

  it("flags rematches with the rounds they met in", () => {
    const rematch = flags.get("now-1")!.teams[t1.id].find((flag) => flag.kind === "rematch")!;
    expect(rematch).toMatchObject({ severity: "warning", label: "Met R1, R3" });
    expect(rematch.detail).toBe("Team 01 already met Team 03 in R1 and R3.");
  });

  it("shows side history (sides recorded on ballots included) and the imbalance this round would cause", () => {
    const t1Flags = flags.get("now-1")!.teams[t1.id];
    expect(t1Flags.find((flag) => flag.kind === "side_history")!.label).toBe("AFF ×3, NEG ×0");
    expect(t1Flags.find((flag) => flag.kind === "side_imbalance")).toMatchObject({
      label: "AFF ×4",
      detail: "Team 01 would be AFF for the 4th time, 4 more than its least-used side.",
    });
    // Team 3 was NEG three times and is NEG again; Team 4 (NEG, NEG, AFF) would be NEG a third time.
    expect(kinds(flags.get("now-1")!.teams[t3.id])).toContain("side_imbalance");
    expect(flags.get("now-2")!.teams[t4.id].find((flag) => flag.kind === "side_imbalance")!.label).toBe("NEG ×3");
    // Team 2 (AFF, AFF, NEG) as AFF: AFF 3, NEG 1, also flagged; one more NEG would not be.
    const t2AsNeg = computeDrawFlags({ ...input, debates: [...history, current[0], room(rounds[3], t4, t2, { id: "now-2" })] });
    expect(kinds(t2AsNeg.get("now-2")!.teams[t2.id])).not.toContain("side_imbalance");
  });

  it("flags pull-ups now and before, institution clashes, and keeps bracket and room rank", () => {
    expect(kinds(flags.get("now-1")!.teams[t1.id])).toEqual(
      expect.arrayContaining(["pulled_up", "pullup_history"])
    );
    expect(flags.get("now-1")!.teams[t1.id].find((flag) => flag.kind === "pullup_history")!.label).toBe("Pulled up ×1 before");
    expect(kinds(flags.get("now-2")!.teams[t2.id])).toContain("institution");
    expect(flags.get("now-2")).toMatchObject({ bracket: 1, roomRank: 2, sidesPending: false });
  });

  it("carries each flag's values for translated wording", () => {
    const t1Flags = flags.get("now-1")!.teams[t1.id];
    expect(t1Flags.find((flag) => flag.kind === "rematch")!.params).toEqual({
      team: "Team 01", opponent: "Team 03", rounds: ["R1", "R3"],
    });
    expect(t1Flags.find((flag) => flag.kind === "side_history")!.params).toEqual({
      team: "Team 01", sideCounts: [{ side: "AFF", count: 3 }, { side: "NEG", count: 0 }],
    });
    expect(t1Flags.find((flag) => flag.kind === "side_imbalance")!.params).toEqual({ team: "Team 01", side: "AFF", count: 4, gap: 4 });
    expect(t1Flags.find((flag) => flag.kind === "pulled_up")!.params).toEqual({ team: "Team 01", bracket: 2 });
    expect(t1Flags.find((flag) => flag.kind === "pullup_history")!.params).toEqual({ team: "Team 01", count: 1 });
    expect(flags.get("now-2")!.teams[t2.id].find((flag) => flag.kind === "institution")!.params).toEqual({
      team: "Team 02", opponent: "Team 04", institution: "X University",
    });
  });

  it("attaches the draw check's issues to their debates", () => {
    const codes = flags.get("now-1")!.issues.map((issue) => issue.code);
    expect(codes).toContain("repeat_matchup");
    expect(flags.get("now-2")!.issues.map((issue) => issue.code)).toContain("same_institution");
  });

  it("does not flag side imbalance while the sides are still to be chosen", () => {
    const pending = current.map((debate) => ({ ...debate, flags: [MANUAL_SIDES_FLAG], sidesConfirmed: false }));
    const result = computeDrawFlags({ ...input, debates: [...history, ...pending] });
    expect(result.get("now-1")!.sidesPending).toBe(true);
    expect(kinds(result.get("now-1")!.teams[t1.id])).not.toContain("side_imbalance");
    expect(kinds(result.get("now-1")!.teams[t1.id])).toContain("side_history");
  });
});

describe("buildDrawDetails", () => {
  const standings = [
    { teamId: t1.id, points: 3 },
    { teamId: t2.id, points: 1 },
    { teamId: t3.id, points: 1 },
    { teamId: t4.id, points: 0 },
  ] as TeamStandingRow[];
  const details = buildDrawDetails({ ...input, standings });

  it("lists teams by points with sides by round, opponents and pull-ups", () => {
    expect(details.map((row) => row.teamId)).toEqual([t1.id, t2.id, t3.id, t4.id]);
    const first = details[0];
    expect(first.sidesByRound).toEqual([
      { roundLabel: "R1", side: "AFF" },
      { roundLabel: "R2", side: "AFF" },
      { roundLabel: "R3", side: "AFF" },
    ]);
    expect(first.opponents).toEqual([
      { teamId: t3.id, teamName: "Team 03", rounds: ["R1", "R3"] },
      { teamId: t4.id, teamName: "Team 04", rounds: ["R2"] },
    ]);
    expect(first).toMatchObject({ points: 3, pullups: 1, sideCounts: { AFF: 3, NEG: 0 } });
    expect(first.current).toEqual({ debateId: "now-1", room: "Room team-1", side: "AFF", opponents: ["Team 03"], pulledUp: true, drawFlags: [] });
  });

  it("shows sides not yet recorded as tbc and unplaced teams without a debate", () => {
    const withoutBallot = buildDrawDetails({ ...input, ballots: [], debates: [...history, current[0]] });
    const t4Row = withoutBallot.find((row) => row.teamId === t4.id)!;
    expect(t4Row.sidesByRound.map((entry) => entry.side)).toEqual(["NEG", "tbc", "AFF"]);
    expect(t4Row.current).toBeNull();
  });
});

describe("moveTeam (keyboard, touch and drag placement)", () => {
  const draw = current.map((debate) => ({ ...debate }));
  const slot = (debateId: string, side: DebateSide) => ({ kind: "slot" as const, debateId, side });

  it("swaps two placed teams between rooms", () => {
    const move = moveTeam(draw, { teamId: t1.id, teamName: t1.name, from: slot("now-1", "AFF") }, slot("now-2", "NEG"));
    const [one, two] = move.debates;
    expect(one.teams.AFF).toEqual({ teamId: t4.id, teamName: t4.name, side: "AFF" });
    expect(two.teams.NEG).toEqual({ teamId: t1.id, teamName: t1.name, side: "NEG" });
    expect(move.announcement).toBe("Team 01 (now Room team-2 NEG) swapped with Team 04 (now Room team-1 AFF).");
    expect(move.event).toEqual({
      kind: "swapped",
      team: "Team 01",
      other: "Team 04",
      teamNow: { venueName: "Room team-2", roomRank: 2, side: "NEG" },
      otherNow: { venueName: "Room team-1", roomRank: 1, side: "AFF" },
    });
  });

  it("moves a team to an empty slot in another room or the other side of its room", () => {
    const emptied = draw.map((debate) =>
      debate.id === "now-2" ? { ...debate, teams: { ...debate.teams, NEG: { teamId: "", teamName: "", side: "NEG" as const } } } : debate
    );
    const across = moveTeam(emptied, { teamId: t1.id, teamName: t1.name, from: slot("now-1", "AFF") }, slot("now-2", "NEG"));
    expect(across.event).toEqual({
      kind: "moved",
      team: "Team 01",
      from: { venueName: "Room team-1", roomRank: 1, side: "AFF" },
      to: { venueName: "Room team-2", roomRank: 2, side: "NEG" },
    });
    const sameRoom = moveTeam(emptied, { teamId: t2.id, teamName: t2.name, from: slot("now-2", "AFF") }, slot("now-2", "NEG"));
    expect(sameRoom.announcement).toBe("Team 02 moved to NEG in Room team-2.");
    expect(sameRoom.event).toEqual({ kind: "moved_side", team: "Team 02", side: "NEG", room: { venueName: "Room team-2", roomRank: 2 } });
  });

  it("swaps sides within a room and keeps each team's slot details", () => {
    const move = moveTeam(draw, { teamId: t1.id, teamName: t1.name, from: slot("now-1", "AFF") }, slot("now-1", "NEG"));
    expect(move.debates[0].teams.NEG).toEqual({ teamId: t1.id, teamName: t1.name, side: "NEG", pulledUp: true });
    expect(move.debates[0].teams.AFF.teamId).toBe(t3.id);
    expect(move.announcement).toBe("Team 01 and Team 03 swapped sides in Room team-1.");
    expect(move.event).toEqual({ kind: "swapped_sides", team: "Team 01", other: "Team 03", room: { venueName: "Room team-1", roomRank: 1 } });
  });

  it("places a pool team (the occupant returns to the pool) and returns a team to the pool", () => {
    const pool = { kind: "pool" as const };
    const extra = { teamId: "spare", teamName: "Spare", from: pool };
    const placed = moveTeam(draw, extra, slot("now-2", "AFF"));
    expect(placed.debates[1].teams.AFF.teamId).toBe("spare");
    expect(placed.announcement).toBe("Spare placed in Room team-2 AFF; Team 02 returned to the unassigned pool.");
    expect(placed.event).toEqual({
      kind: "placed", team: "Spare", to: { venueName: "Room team-2", roomRank: 2, side: "AFF" }, displaced: "Team 02",
    });
    const removed = moveTeam(draw, { teamId: t2.id, teamName: t2.name, from: slot("now-2", "AFF") }, pool);
    expect(removed.debates[1].teams.AFF.teamId).toBe("");
    expect(removed.event).toEqual({ kind: "returned_to_pool", team: "Team 02", from: { venueName: "Room team-2", roomRank: 2, side: "AFF" } });
    expect(moveTeam(draw, extra, pool)).toEqual({ debates: draw, announcement: "" });
  });

  it("names rooms without sides while sides are chosen on the ballot", () => {
    const pending = draw.map((debate) => ({ ...debate, flags: [MANUAL_SIDES_FLAG], sidesConfirmed: false }));
    const move = moveTeam(pending, { teamId: t1.id, teamName: t1.name, from: slot("now-1", "AFF") }, slot("now-2", "NEG"));
    expect(move.announcement).toBe("Team 01 (now Room team-2) swapped with Team 04 (now Room team-1).");
    expect(move.event).toMatchObject({ teamNow: { venueName: "Room team-2", roomRank: 2 }, otherNow: { venueName: "Room team-1", roomRank: 1 } });
    expect(move.event && "teamNow" in move.event && move.event.teamNow.side).toBeUndefined();
  });
});
