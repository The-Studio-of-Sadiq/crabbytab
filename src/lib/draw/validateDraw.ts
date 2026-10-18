import type {
  Adjudicator,
  Debate,
  DebateSide,
  Round,
  Team,
  Tournament,
  Venue,
} from "@/types";
import { isAvailableForRound } from "@/lib/roundAvailability";
import { buildPastAdjTeams, calculateAdjDebateConflict } from "./allocator";
import { buildMatchupHistory, getEligibleTeamsForRound } from "./generator";
import { sameInstitution } from "./history";
import { BP_SIDES, TWO_TEAM_SIDES, violatesSideLimits } from "./sideAllocator";
import { getVenueIncompatibilities } from "./venueAllocator";

/**
 * Checks a round's draw (generated or hand-edited) against the rules a draw must satisfy, and
 * explains each problem in words a tab director can act on.
 *
 * "error" issues break a hard rule: the draw should not be released until they are fixed.
 * "warning" issues are preferences the draw generator and allocator try to honour but may trade
 * away (repeat matchups, institution clashes between teams, adjudicators who saw a team before,
 * missing chairs or venues). The check never changes the draw.
 */

export type DrawIssueSeverity = "error" | "warning";

export type DrawIssueCode =
  | "missing_side"
  | "unassigned_side"
  | "unknown_team"
  | "team_twice_in_debate"
  | "team_in_multiple_debates"
  | "team_not_placed"
  | "team_ineligible"
  | "team_unavailable"
  | "side_limit"
  | "preallocated_side"
  | "unknown_adjudicator"
  | "adjudicator_in_multiple_debates"
  | "adjudicator_unavailable"
  | "adjudicator_conflict"
  | "unknown_venue"
  | "venue_in_multiple_debates"
  | "venue_unavailable"
  | "venue_requirements"
  | "repeat_matchup"
  | "same_institution"
  | "adjudicator_history"
  | "no_chair"
  | "no_venue";

export interface DrawIssue {
  code: DrawIssueCode;
  severity: DrawIssueSeverity;
  message: string;
  debateIds: string[];
  teamIds?: string[];
  adjudicatorIds?: string[];
  venueIds?: string[];
}

export interface ValidateDrawInput {
  tournament: Pick<Tournament, "format" | "preferences">;
  round: Round;
  /** Debates of every round; only `round`'s are checked, earlier rounds supply the history. */
  debates: Debate[];
  /** Rounds of the tournament, used to tell which debates are earlier rounds. */
  rounds?: Round[];
  teams: Team[];
  adjudicators: Adjudicator[];
  venues: Venue[];
  /** Clock for check-in expiry; defaults to now. */
  now?: number;
}

function roomLabel(debate: Debate): string {
  return debate.byeTeamId ? "Bye" : debate.venueName || `Room ${debate.roomRank}`;
}

function panelIds(debate: Debate): Array<{ id: string; role: "chair" | "panellist" | "trainee" }> {
  const panel = debate.adjudicators;
  if (!panel) return [];
  return [
    ...(panel.chairId ? [{ id: panel.chairId, role: "chair" as const }] : []),
    ...(panel.panellistIds || []).filter(Boolean).map((id) => ({ id, role: "panellist" as const })),
    ...(panel.traineeIds || []).filter(Boolean).map((id) => ({ id, role: "trainee" as const })),
  ];
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Earlier, non-cancelled rounds' debates (all other rounds when `rounds` is not given). */
function earlierDebates(input: ValidateDrawInput): Debate[] {
  const { round, debates, rounds } = input;
  if (!rounds) return debates.filter((debate) => debate.roundId !== round.id && debate.roundSeq < round.seq);
  const earlier = new Set(rounds.filter((item) => !item.cancelled && item.seq < round.seq).map((item) => item.id));
  return debates.filter((debate) => earlier.has(debate.roundId));
}

export function validateDraw(input: ValidateDrawInput): DrawIssue[] {
  const { tournament, round, teams, adjudicators, venues } = input;
  const now = input.now ?? Date.now();
  const preferences = tournament.preferences;
  const expiry = preferences?.checkInExpiresAfterHours;
  const isBP = tournament.format === "bp";
  const sides: readonly DebateSide[] = isBP ? BP_SIDES : TWO_TEAM_SIDES;
  const roundDebates = input.debates
    .filter((debate) => debate.roundId === round.id)
    .sort((left, right) => left.roomRank - right.roomRank || left.id.localeCompare(right.id));
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const adjudicatorsById = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const venuesById = new Map(venues.map((venue) => [venue.id, venue]));
  const teamName = (teamId: string) => teamsById.get(teamId)?.name ?? teamId;
  const adjudicatorName = (id: string) => adjudicatorsById.get(id)?.name ?? id;
  const issues: DrawIssue[] = [];
  const add = (issue: DrawIssue) => issues.push(issue);

  const pastDebates = earlierDebates(input);
  const history = buildMatchupHistory(pastDebates);
  const pastAdjudicatorTeams = buildPastAdjTeams(pastDebates);
  const eligibleIds = new Set(getEligibleTeamsForRound(teams, round).map((team) => team.id));

  /* Teams ------------------------------------------------------------------ */

  const placements = new Map<string, Debate[]>();
  for (const debate of roundDebates) {
    const slots = Object.entries(debate.teams || {}) as Array<[DebateSide, Debate["teams"][DebateSide] | undefined]>;
    const seenInDebate = new Set<string>();
    if (debate.byeTeamId) {
      seenInDebate.add(debate.byeTeamId);
      placements.set(debate.byeTeamId, [...(placements.get(debate.byeTeamId) ?? []), debate]);
    } else {
      for (const side of sides) {
        if (!debate.teams?.[side]) {
          add({
            code: "missing_side",
            severity: "error",
            message: `${roomLabel(debate)} has no ${side} team.`,
            debateIds: [debate.id],
          });
        }
      }
    }
    for (const [side, slot] of slots) {
      if (!slot) continue;
      if (!slot.teamId) {
        add({
          code: "unassigned_side",
          severity: "error",
          message: `${roomLabel(debate)} has no team assigned to ${side}.`,
          debateIds: [debate.id],
        });
        continue;
      }
      if (debate.byeTeamId) continue;
      if (seenInDebate.has(slot.teamId)) {
        add({
          code: "team_twice_in_debate",
          severity: "error",
          message: `${teamName(slot.teamId)} fills more than one side in ${roomLabel(debate)}.`,
          debateIds: [debate.id],
          teamIds: [slot.teamId],
        });
        continue;
      }
      seenInDebate.add(slot.teamId);
      placements.set(slot.teamId, [...(placements.get(slot.teamId) ?? []), debate]);
    }
  }

  for (const [teamId, placedIn] of placements) {
    const team = teamsById.get(teamId);
    if (!team) {
      add({
        code: "unknown_team",
        severity: "error",
        message: `${list(placedIn.map(roomLabel))} names a team (${teamId}) that is not registered.`,
        debateIds: placedIn.map((debate) => debate.id),
        teamIds: [teamId],
      });
      continue;
    }
    if (placedIn.length > 1) {
      add({
        code: "team_in_multiple_debates",
        severity: "error",
        message: `${team.name} is placed ${placedIn.length} times: ${list(placedIn.map(roomLabel))}.`,
        debateIds: placedIn.map((debate) => debate.id),
        teamIds: [teamId],
      });
    }
    if (!eligibleIds.has(teamId)) {
      add({
        code: "team_ineligible",
        severity: "error",
        message: round.stage === "elimination"
          ? `${team.name} did not qualify for ${round.name}.`
          : `${team.name} is not in this round's division.`,
        debateIds: placedIn.map((debate) => debate.id),
        teamIds: [teamId],
      });
    } else if (!isAvailableForRound(team, round, expiry, now)) {
      add({
        code: "team_unavailable",
        severity: "error",
        message: `${team.name} is not checked in for ${round.name}.`,
        debateIds: placedIn.map((debate) => debate.id),
        teamIds: [teamId],
      });
    }
  }

  if (roundDebates.length > 0) {
    const unplaced = teams.filter(
      (team) => eligibleIds.has(team.id) && isAvailableForRound(team, round, expiry, now) && !placements.has(team.id)
    );
    for (const team of unplaced) {
      add({
        code: "team_not_placed",
        severity: "error",
        message: `${team.name} is checked in but has no debate or bye in ${round.name}.`,
        debateIds: [],
        teamIds: [team.id],
      });
    }
  }

  /* Sides ------------------------------------------------------------------ */

  const sideRule = preferences?.sideAllocationRule;
  if (round.stage === "preliminary") {
    for (const debate of roundDebates) {
      if (debate.byeTeamId) continue;
      for (const [side, slot] of Object.entries(debate.teams || {}) as Array<[DebateSide, Debate["teams"][DebateSide] | undefined]>) {
        if (!slot?.teamId || !teamsById.has(slot.teamId)) continue;
        if (!isBP && sideRule === "preallocated") {
          const expected = round.preallocatedSides?.[slot.teamId];
          if (expected && expected !== side) {
            add({
              code: "preallocated_side",
              severity: "error",
              message: `${teamName(slot.teamId)} is ${side} in ${roomLabel(debate)}, but its preallocated side is ${expected}.`,
              debateIds: [debate.id],
              teamIds: [slot.teamId],
            });
          }
          continue;
        }
        const past = history.sides.get(slot.teamId) ?? [];
        if (violatesSideLimits(past, side, sides, preferences ?? {})) {
          const times = past.filter((item) => item === side).length + 1;
          add({
            code: "side_limit",
            severity: "error",
            message: `${teamName(slot.teamId)} would be ${side} for the ${times}${ordinalSuffix(times)} time, ` +
              `which breaks the side limits (at most ${preferences?.maxTimesPerSide ?? 5} times per side${
                (preferences?.maxAllowedSideImbalance ?? 0) > 0
                  ? `, imbalance at most ${preferences?.maxAllowedSideImbalance}`
                  : ""
              }).`,
            debateIds: [debate.id],
            teamIds: [slot.teamId],
          });
        }
      }
    }
  }

  /* Matchup preferences ---------------------------------------------------- */

  for (const debate of roundDebates) {
    if (debate.byeTeamId) continue;
    const ids = [...new Set(Object.values(debate.teams || {})
      .map((slot) => slot?.teamId)
      .filter((id): id is string => Boolean(id) && teamsById.has(id as string)))];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const met = history.meetings?.get(ids[i])?.get(ids[j]) ?? 0;
        if (met > 0) {
          add({
            code: "repeat_matchup",
            severity: "warning",
            message: `${teamName(ids[i])} and ${teamName(ids[j])} have already met ${met === 1 ? "once" : `${met} times`}.`,
            debateIds: [debate.id],
            teamIds: [ids[i], ids[j]],
          });
        }
        if (sameInstitution(teamsById.get(ids[i])!, teamsById.get(ids[j])!)) {
          add({
            code: "same_institution",
            severity: "warning",
            message: `${teamName(ids[i])} and ${teamName(ids[j])} are from the same institution.`,
            debateIds: [debate.id],
            teamIds: [ids[i], ids[j]],
          });
        }
      }
    }
  }

  /* Adjudicators ----------------------------------------------------------- */

  const adjudicatorPlacements = new Map<string, Debate[]>();
  for (const debate of roundDebates) {
    for (const { id } of panelIds(debate)) {
      adjudicatorPlacements.set(id, [...(adjudicatorPlacements.get(id) ?? []), debate]);
    }
  }
  const checksAdjudicatorAvailability = !preferences?.skipAdjCheckins;
  for (const [id, placedIn] of adjudicatorPlacements) {
    const adjudicator = adjudicatorsById.get(id);
    const debateIds = [...new Set(placedIn.map((debate) => debate.id))];
    if (!adjudicator) {
      add({
        code: "unknown_adjudicator",
        severity: "error",
        message: `${list([...new Set(placedIn.map(roomLabel))])} names an adjudicator (${id}) who is not registered.`,
        debateIds,
        adjudicatorIds: [id],
      });
      continue;
    }
    if (placedIn.length > 1) {
      add({
        code: "adjudicator_in_multiple_debates",
        severity: "error",
        message: debateIds.length > 1
          ? `${adjudicator.name} is allocated to ${debateIds.length} debates: ${list(placedIn.map(roomLabel).filter((label, index, all) => all.indexOf(label) === index))}.`
          : `${adjudicator.name} holds more than one place on the panel in ${roomLabel(placedIn[0])}.`,
        debateIds,
        adjudicatorIds: [id],
      });
    }
    if (checksAdjudicatorAvailability && !isAvailableForRound(adjudicator, round, expiry, now)) {
      add({
        code: "adjudicator_unavailable",
        severity: "error",
        message: `${adjudicator.name} is not checked in for ${round.name}.`,
        debateIds,
        adjudicatorIds: [id],
      });
    }
  }

  const anyAllocation = roundDebates.some((debate) => panelIds(debate).length > 0);
  for (const debate of roundDebates) {
    if (debate.byeTeamId) continue;
    const panel = panelIds(debate);
    if (anyAllocation && !debate.adjudicators?.chairId) {
      add({
        code: "no_chair",
        severity: "warning",
        message: `${roomLabel(debate)} has no chair.`,
        debateIds: [debate.id],
      });
    }
    const debateTeams = Object.values(debate.teams || {})
      .map((slot) => (slot?.teamId ? teamsById.get(slot.teamId) : undefined))
      .filter((team): team is Team => Boolean(team));
    const panelAdjudicators = panel
      .map(({ id }) => adjudicatorsById.get(id))
      .filter((adjudicator): adjudicator is Adjudicator => Boolean(adjudicator));
    panelAdjudicators.forEach((adjudicator, index) => {
      // History is a preference, not a conflict, so it is checked separately below as a warning.
      // Panel clashes are checked against later panel members only, so each pair is reported once.
      const laterMembers = panelAdjudicators.slice(index + 1).filter((other) => other.id !== adjudicator.id);
      const conflict = calculateAdjDebateConflict(adjudicator, debateTeams, new Map(), undefined, laterMembers);
      if (conflict.reasons.length > 0) {
        add({
          code: "adjudicator_conflict",
          severity: "error",
          message: `${adjudicator.name} in ${roomLabel(debate)}: ${conflict.reasons.join("; ")}.`,
          debateIds: [debate.id],
          adjudicatorIds: [adjudicator.id],
        });
      }
      const seenTeams = debateTeams.filter((team) => pastAdjudicatorTeams.get(adjudicator.id)?.has(team.id));
      if (seenTeams.length > 0) {
        add({
          code: "adjudicator_history",
          severity: "warning",
          message: `${adjudicator.name} has already judged ${list(seenTeams.map((team) => team.name))}.`,
          debateIds: [debate.id],
          adjudicatorIds: [adjudicator.id],
          teamIds: seenTeams.map((team) => team.id),
        });
      }
    });
  }

  /* Venues ----------------------------------------------------------------- */

  const venuePlacements = new Map<string, Debate[]>();
  for (const debate of roundDebates) {
    if (debate.byeTeamId) continue;
    if (!debate.venueId) {
      if (venues.length > 0 && !debate.postponed) {
        add({
          code: "no_venue",
          severity: "warning",
          message: `${roomLabel(debate)} has no venue.`,
          debateIds: [debate.id],
        });
      }
      continue;
    }
    venuePlacements.set(debate.venueId, [...(venuePlacements.get(debate.venueId) ?? []), debate]);
  }
  for (const [venueId, placedIn] of venuePlacements) {
    const venue = venuesById.get(venueId);
    const debateIds = placedIn.map((debate) => debate.id);
    if (!venue) {
      add({
        code: "unknown_venue",
        severity: "error",
        message: `${list(placedIn.map((debate) => `Room ${debate.roomRank}`))} uses a venue (${venueId}) that does not exist.`,
        debateIds,
        venueIds: [venueId],
      });
      continue;
    }
    if (placedIn.length > 1) {
      add({
        code: "venue_in_multiple_debates",
        severity: "error",
        message: `${venue.name} hosts ${placedIn.length} debates at once.`,
        debateIds,
        venueIds: [venueId],
      });
    }
    if (venue.available === false) {
      add({
        code: "venue_unavailable",
        severity: "error",
        message: `${venue.name} is marked unavailable.`,
        debateIds,
        venueIds: [venueId],
      });
    }
    for (const debate of placedIn) {
      const reasons = getVenueIncompatibilities(debate, venue);
      if (reasons.length > 0) {
        add({
          code: "venue_requirements",
          severity: "error",
          message: `${venue.name} does not suit this debate: it ${list(reasons)}.`,
          debateIds: [debate.id],
          venueIds: [venueId],
        });
      }
    }
  }

  return issues.sort((left, right) => Number(left.severity === "warning") - Number(right.severity === "warning"));
}

function ordinalSuffix(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  return value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th";
}

export function drawErrors(issues: DrawIssue[]): DrawIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}
