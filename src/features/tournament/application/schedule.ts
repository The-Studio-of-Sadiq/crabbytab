import type { BreakCategory, Debate, Round, TournamentPreferences } from "@/types";

/**
 * Schedule groups (Tabbycat's Round.schedule_group): rounds in the same group run at the same time,
 * e.g. parallel preliminary panels "Round 1 (A)" and "Round 1 (B)". A round without a group is in
 * its own slot, numbered by its sequence, so tournaments saved before groups existed behave as
 * before: exactly one current preliminary round.
 *
 * Rounds in one slot are concurrent: no team, adjudicator or venue may be in two of them, and none
 * of them waits for, or is drawn from, the others' results. Earlier slots are "previous rounds".
 */

export function scheduleGroupOf(round: Pick<Round, "seq" | "scheduleGroup">): number {
  const group = round.scheduleGroup;
  return typeof group === "number" && Number.isInteger(group) && group > 0 ? group : round.seq;
}

function bySeq(left: Round, right: Round): number {
  return left.seq - right.seq;
}

/** True when `earlier` takes place in a schedule slot before `round`'s. */
export function isEarlierScheduleSlot(earlier: Round, round: Round): boolean {
  return scheduleGroupOf(earlier) < scheduleGroupOf(round);
}

/** Other non-cancelled rounds in the same schedule slot and stage as `round`. */
export function concurrentRounds(round: Round, rounds: Round[]): Round[] {
  const group = scheduleGroupOf(round);
  return rounds
    .filter((item) => item.id !== round.id && !item.cancelled && item.stage === round.stage && scheduleGroupOf(item) === group)
    .sort(bySeq);
}

/**
 * The current rounds, as Tabbycat's Tournament.current_rounds: while any preliminary round is
 * incomplete, every incomplete preliminary round in the earliest such round's slot; otherwise the
 * earliest incomplete elimination round that has a draw in each break category (in category
 * order). With no current round (before the first elimination draw, or after the final), the
 * result is empty.
 *
 * CrabbyTab completes elimination rounds by advancing teams, so an elimination round counts as
 * incomplete until `eliminationAdvanced` (or `completed`) is set.
 */
export function currentRounds(
  rounds: Round[],
  debates: Pick<Debate, "roundId">[],
  breakCategories: Pick<BreakCategory, "id" | "seq">[] = []
): Round[] {
  const live = rounds.filter((round) => !round.cancelled).sort(bySeq);
  const prelims = live.filter((round) => round.stage === "preliminary" && !round.completed);
  if (prelims.length > 0) {
    const group = scheduleGroupOf(prelims[0]);
    return prelims.filter((round) => scheduleGroupOf(round) === group);
  }
  const drawn = new Set(debates.map((debate) => debate.roundId));
  const categoryOrder = new Map(breakCategories.map((category) => [category.id, category.seq]));
  const byCategory = new Map<string, Round>();
  for (const round of live) {
    if (round.stage !== "elimination" || round.completed || round.eliminationAdvanced || !drawn.has(round.id)) continue;
    const key = round.breakCategoryIds?.[0] ?? "";
    if (!byCategory.has(key)) byCategory.set(key, round);
  }
  return [...byCategory.entries()]
    .sort(([left, a], [right, b]) =>
      (categoryOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (categoryOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
      a.seq - b.seq
    )
    .map(([, round]) => round);
}

export function isCurrentRound(
  round: Round,
  rounds: Round[],
  debates: Pick<Debate, "roundId">[],
  breakCategories: Pick<BreakCategory, "id" | "seq">[] = []
): boolean {
  return currentRounds(rounds, debates, breakCategories).some((item) => item.id === round.id);
}

/**
 * The rounds to show beside `round` on admin pages that work on the current round (draw,
 * allocation, results, check-ins): its concurrent rounds when it has any, else nothing.
 */
export function roundsInSameSlot(round: Round | null | undefined, rounds: Round[]): Round[] {
  if (!round) return [];
  const others = concurrentRounds(round, rounds);
  return others.length === 0 ? [] : [round, ...others].sort(bySeq);
}

/**
 * 1-based round-robin index of a round: the position of its slot among the preliminary
 * round-robin slots (parallel panels share an index), as Tabbycat's get_rrseq.
 */
export function roundRobinIndex(round: Round, rounds: Round[]): number {
  const groups = [...new Set(
    rounds
      .filter((item) => !item.cancelled && item.stage === "preliminary" && item.drawType === "round_robin")
      .concat(round.drawType === "round_robin" ? [round] : [])
      .sort((left, right) => scheduleGroupOf(left) - scheduleGroupOf(right) || left.seq - right.seq)
      .map(scheduleGroupOf)
  )];
  const index = groups.indexOf(scheduleGroupOf(round));
  return index < 0 ? round.seq : index + 1;
}

export type ConcurrentBookingKind = "team" | "adjudicator" | "venue";

export interface ConcurrentBooking {
  kind: ConcurrentBookingKind;
  id: string;
  name: string;
  roundId: string;
  roundName: string;
  debateId: string;
}

function debateBookings(debate: Debate): Array<Omit<ConcurrentBooking, "roundId" | "roundName" | "debateId">> {
  const bookings: Array<Omit<ConcurrentBooking, "roundId" | "roundName" | "debateId">> = [];
  for (const slot of Object.values(debate.teams || {})) {
    if (slot?.teamId) bookings.push({ kind: "team", id: slot.teamId, name: slot.teamName || slot.teamId });
  }
  if (debate.byeTeamId) bookings.push({ kind: "team", id: debate.byeTeamId, name: debate.byeTeamId });
  const panel = debate.adjudicators;
  if (panel?.chairId) bookings.push({ kind: "adjudicator", id: panel.chairId, name: panel.chairName || panel.chairId });
  (panel?.panellistIds || []).forEach((id, index) =>
    bookings.push({ kind: "adjudicator", id, name: panel.panellistNames?.[index] || id })
  );
  (panel?.traineeIds || []).forEach((id, index) =>
    bookings.push({ kind: "adjudicator", id, name: panel.traineeNames?.[index] || id })
  );
  if (debate.venueId) bookings.push({ kind: "venue", id: debate.venueId, name: debate.venueName || debate.venueId });
  return bookings;
}

/**
 * Teams, adjudicators and venues already used by the rounds concurrent with `round`, keyed by
 * `${kind}:${id}`. Auto-allocation leaves these out; the draw check reports them.
 */
export function concurrentBookings(round: Round, rounds: Round[], debates: Debate[]): Map<string, ConcurrentBooking> {
  const others = new Map(concurrentRounds(round, rounds).map((item) => [item.id, item]));
  const bookings = new Map<string, ConcurrentBooking>();
  for (const debate of debates) {
    const other = others.get(debate.roundId);
    if (!other) continue;
    for (const booking of debateBookings(debate)) {
      const key = `${booking.kind}:${booking.id}`;
      if (!bookings.has(key)) bookings.set(key, { ...booking, roundId: other.id, roundName: other.name, debateId: debate.id });
    }
  }
  return bookings;
}

/** Everyone and everything `round`'s draw shares with a concurrent round. */
export function concurrentRoundClashes(round: Round, rounds: Round[], debates: Debate[]): ConcurrentBooking[] {
  const booked = concurrentBookings(round, rounds, debates);
  if (booked.size === 0) return [];
  const clashes: ConcurrentBooking[] = [];
  const seen = new Set<string>();
  for (const debate of debates) {
    if (debate.roundId !== round.id) continue;
    for (const booking of debateBookings(debate)) {
      const key = `${booking.kind}:${booking.id}`;
      const other = booked.get(key);
      if (other && !seen.has(key)) {
        seen.add(key);
        clashes.push(other);
      }
    }
  }
  return clashes;
}

export function describeConcurrentClashes(round: Round, clashes: ConcurrentBooking[]): string {
  const label = (kind: ConcurrentBookingKind, count: number) =>
    `${count} ${kind === "adjudicator" ? "adjudicator" : kind}${count === 1 ? "" : "s"}`;
  const counts = (["team", "adjudicator", "venue"] as const)
    .map((kind) => [kind, clashes.filter((clash) => clash.kind === kind)] as const)
    .filter(([, items]) => items.length > 0);
  const parts = counts.map(([kind, items]) =>
    `${label(kind, items.length)} (${items.slice(0, 3).map((item) => `${item.name} in ${item.roundName}`).join(", ")}${items.length > 3 ? ", ..." : ""})`
  );
  return `${round.name} runs at the same time as ${[...new Set(clashes.map((clash) => clash.roundName))].join(", ")}, ` +
    `but shares ${parts.join("; ")} with ${clashes.length === 1 ? "it" : "them"}.`;
}

/* -------------------------------------------------------------------------- */
/* Preliminary panels (Tabbycat prelim_panels)                                */
/* -------------------------------------------------------------------------- */

/** Preliminary rounds per schedule slot, reading the deprecated preference saved by older versions. */
export function preliminaryPanelsOf(
  preferences: Pick<TournamentPreferences, "preliminaryPanels" | "preliminaryPanelsPerScheduleSlot"> | undefined
): number {
  const value = preferences?.preliminaryPanels ?? preferences?.preliminaryPanelsPerScheduleSlot;
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.min(26, Math.floor(value)) : 1;
}

/**
 * Moves a stored `preliminaryPanelsPerScheduleSlot` into `preliminaryPanels` and drops the
 * deprecated key. Rounds are not regrouped: the old preference never had an effect, so existing
 * rounds stay one per slot until the tab room groups them.
 */
export function migrateSchedulePreferences<T extends Partial<TournamentPreferences>>(preferences: T): T {
  if (!("preliminaryPanelsPerScheduleSlot" in preferences)) return preferences;
  const { preliminaryPanelsPerScheduleSlot: legacy, ...rest } = preferences;
  const migrated = { ...rest } as T;
  if (migrated.preliminaryPanels === undefined && typeof legacy === "number" && legacy > 1) {
    migrated.preliminaryPanels = preliminaryPanelsOf({ preliminaryPanels: legacy });
  }
  return migrated;
}

const DEFAULT_ROUND_NAME = /^Round \d+( \([A-Z]\))?$/;
const DEFAULT_ROUND_ABBREVIATION = /^R\d+[A-Z]?$/;

/**
 * Groups the non-cancelled preliminary rounds, in sequence order, into slots of `panels` rounds
 * (as Tabbycat's auto_make_rounds with prelim_panels): slot k holds rounds (k-1)*panels+1 ..
 * k*panels. Default names become "Round k (A)" / "RkA"; custom names are kept. With panels = 1
 * every round gets its own slot and the default names "Round k" / "Rk" again.
 *
 * Returns only the rounds that change.
 */
export function groupPreliminaryRounds(rounds: Round[], panels: number): Round[] {
  const size = Math.max(1, Math.min(26, Math.floor(panels)));
  const prelims = rounds.filter((round) => round.stage === "preliminary" && !round.cancelled).sort(bySeq);
  return prelims.flatMap((round, index) => {
    const group = 1 + Math.floor(index / size);
    const letter = String.fromCharCode(65 + (index % size));
    const name = DEFAULT_ROUND_NAME.test(round.name)
      ? size > 1 ? `Round ${group} (${letter})` : `Round ${group}`
      : round.name;
    const abbreviation = DEFAULT_ROUND_ABBREVIATION.test(round.abbreviation)
      ? size > 1 ? `R${group}${letter}` : `R${group}`
      : round.abbreviation;
    // Slot numbers count from the first preliminary round's sequence number, so they stay below
    // the elimination rounds' default slots (their seq).
    const scheduleGroup = (prelims[0]?.seq ?? 1) - 1 + group;
    if (round.name === name && round.abbreviation === abbreviation && scheduleGroupOf(round) === scheduleGroup) return [];
    return [{ ...round, name, abbreviation, scheduleGroup }];
  });
}

/**
 * Schedule slots for newly created preliminary rounds (Tabbycat: round creation assigns schedule
 * groups from prelim_panels). New rounds fill the last existing preliminary slot up to `panels`
 * rounds, then open the next slot; existing rounds are never regrouped. Default names
 * ("Round 5" / "R5") follow the slot ("Round 3 (B)" / "R3B"); custom names are kept. With one panel
 * per slot nothing changes, so tournaments that never set prelim_panels create rounds as before.
 * `renameDefaults: false` keeps a name the organiser typed.
 */
export function slotNewPreliminaryRounds(
  existing: Round[],
  created: Round[],
  panels: number,
  { renameDefaults = true }: { renameDefaults?: boolean } = {}
): Round[] {
  const size = Math.max(1, Math.min(26, Math.floor(panels)));
  if (size <= 1) return created;
  const prelims = existing.filter((round) => round.stage === "preliminary" && !round.cancelled).sort(bySeq);
  const firstSeq = (prelims[0] ?? [...created].sort(bySeq)[0])?.seq ?? 1;
  const last = prelims.at(-1);
  let slot = last ? scheduleGroupOf(last) : firstSeq;
  let filled = last ? prelims.filter((round) => scheduleGroupOf(round) === slot).length : 0;
  return [...created].sort(bySeq).map((round) => {
    if (round.stage !== "preliminary" || round.cancelled) return round;
    if (filled >= size) {
      slot += 1;
      filled = 0;
    }
    const letter = String.fromCharCode(65 + filled);
    filled += 1;
    const group = slot - firstSeq + 1;
    return {
      ...round,
      scheduleGroup: slot,
      name: renameDefaults && DEFAULT_ROUND_NAME.test(round.name) ? `Round ${group} (${letter})` : round.name,
      abbreviation: renameDefaults && DEFAULT_ROUND_ABBREVIATION.test(round.abbreviation) ? `R${group}${letter}` : round.abbreviation,
    };
  });
}

/** What changing a round's slot would break; empty when the change is safe. */
export function checkScheduleGroupChange(round: Round, scheduleGroup: number, rounds: Round[], debates: Debate[]): string[] {
  if (!Number.isInteger(scheduleGroup) || scheduleGroup < 1) return ["A schedule slot is a whole number from 1."];
  const moved = { ...round, scheduleGroup };
  const problems: string[] = [];
  const clashes = concurrentRoundClashes(moved, rounds.map((item) => item.id === round.id ? moved : item), debates);
  if (clashes.length > 0) problems.push(describeConcurrentClashes(moved, clashes));
  const drawnOrDone = (item: Round) => item.completed || debates.some((debate) => debate.roundId === item.id);
  const later = rounds.filter((item) =>
    !item.cancelled && item.id !== round.id && item.seq > round.seq && scheduleGroupOf(item) < scheduleGroup && drawnOrDone(item)
  );
  if (later.length > 0) {
    problems.push(`${later.map((item) => item.name).join(", ")} would then run before ${round.name}, which comes earlier in sequence.`);
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Start times                                                                 */
/* -------------------------------------------------------------------------- */

/** Parses an ISO date-time; undefined for anything else. */
export function parseScheduleTime(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? undefined : time;
}

/** When a debate starts: its own scheduled time, else its round's start. */
export function debateStartTime(debate: Pick<Debate, "scheduledTime">, round: Pick<Round, "startsAt"> | undefined): Date | undefined {
  return parseScheduleTime(debate.scheduledTime) ?? parseScheduleTime(round?.startsAt);
}
