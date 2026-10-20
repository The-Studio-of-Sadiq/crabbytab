import { getPublicRelease, type PublicListReleaseKind } from "@/lib/publicRelease";
import type { Debate, Round, Team } from "@/types";
import { ApiError, notFound } from "../errors";
import type { RouteContext } from "../router";
import { s } from "../schema";
import { asType } from "../serializers";

export type AnyContext = RouteContext<unknown, unknown, unknown>;

/** Path segments arrive as strings; round sequence numbers are converted here. */
export const roundSeqSchema = s.string({ min: 1, max: 4, pattern: /^[1-9][0-9]{0,3}$/, description: "Round sequence number (1 = first round)." });

export function parseSeq(value: string): number {
  return Number(value);
}

/** The round with this sequence number (cancelled rounds included), or 404. */
export async function roundBySeq(context: AnyContext, seqText: string): Promise<Round> {
  const seq = parseSeq(seqText);
  const rounds = await context.data.all("rounds", [{ field: "seq", op: "==", value: seq }]);
  const round = rounds.map((record) => asType<Round>(record)).sort((left, right) => left.id.localeCompare(right.id))[0];
  if (!round) throw notFound("Round");
  return round;
}

export async function debateInRound(context: AnyContext, round: Round, debateId: string): Promise<Debate> {
  const record = await context.data.get("debates", debateId);
  const debate = record ? asType<Debate>(record) : null;
  if (!debate || debate.roundId !== round.id) throw notFound("Pairing");
  return debate;
}

/**
 * Public-view requests for a list the public site only shows once released (participants,
 * institutions, a tab) are refused until the tab director releases it.
 */
export function requirePublicRelease(context: AnyContext, kind: PublicListReleaseKind, what: string): void {
  if (context.data.view !== "public") return;
  if (!getPublicRelease(context.tournament.preferences)[kind]) {
    throw new ApiError(403, "forbidden", `${what} ${what.endsWith("s") ? "have" : "has"} not been released to the public.`);
  }
}

export async function findSpeaker(context: AnyContext, speakerId: string): Promise<{ team: Team; index: number }> {
  // Speakers are stored inside their team; the lookup reads the teams (bounded by the tournament's size).
  const teams = (await context.data.all("teams")).map((record) => asType<Team>(record));
  for (const team of teams) {
    const index = (team.speakers ?? []).findIndex((speaker) => speaker.id === speakerId);
    if (index >= 0) return { team, index };
  }
  throw notFound("Speaker");
}

export function idSchema(description: string) {
  return s.string({ min: 1, max: 128, pattern: /^[A-Za-z0-9_.:-]+$/, description });
}
