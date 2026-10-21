import { motionsVisible } from "@/features/tournament/application/motionRelease";
import type { Adjudicator, BallotSubmission, Debate, DebateAdjudicatorSlot, Round, Team, Tournament } from "@/types";
import { isDrawPubliclyReleased, isDrawReleasedToTeams } from "@/lib/draw/drawStatus";
import { getPublicSiteSettings, publicUsesTeamCodeNames } from "@/lib/publicFeatures";
import { hasCodeName } from "@/lib/codeNames";

const HIDDEN_PANEL: DebateAdjudicatorSlot = {
  panellistIds: [],
  panellistNames: [],
  traineeIds: [],
  traineeNames: [],
};

/**
 * Whether a round's draw may be shown to teams on their private portal: a teams-only release
 * (Tabbycat "release draw (teams only)") or the full release. See src/lib/draw/drawStatus.ts.
 */
export function isDrawVisibleToTeams(round: Round | undefined): round is Round {
  return round !== undefined && round.cancelled !== true && isDrawReleasedToTeams(round);
}

/** Adjudicators see their allocation (and may submit ballots) only once the draw is fully released. */
export function isDrawVisibleToAdjudicators(round: Round | undefined): round is Round {
  return round !== undefined && round.cancelled !== true && isDrawPubliclyReleased(round);
}

/** Drops debates whose round draw has not been released to teams. */
export function filterTeamVisibleDebates<T extends Pick<Debate, "roundId">>(
  debates: Iterable<T>,
  roundsById: ReadonlyMap<string, Round>
): T[] {
  return [...debates].filter((debate) => isDrawVisibleToTeams(roundsById.get(debate.roundId)));
}

/** Drops debates whose round draw this kind of participant may not see yet. */
export function filterParticipantVisibleDebates<T extends Pick<Debate, "roundId">>(
  debates: Iterable<T>,
  roundsById: ReadonlyMap<string, Round>,
  actorType: "adjudicator" | "team"
): T[] {
  const visible = actorType === "team" ? isDrawVisibleToTeams : isDrawVisibleToAdjudicators;
  return [...debates].filter((debate) => visible(roundsById.get(debate.roundId)));
}

export function sanitizeTeamPrivateDebate(
  debate: Debate,
  round: Round | undefined,
  resultsEnabled = true
): Debate {
  const showResults =
    resultsEnabled && round?.resultsReleased === true && round.silent !== true;
  const showSpeakerScores = showResults && round?.teamSpeaksReleased === true;
  // A teams-only release never shows the panel (Tabbycat hides adjudicators until the full release).
  const showAdjudicators = isDrawVisibleToAdjudicators(round) && round.adjudicatorsRevealed === true;
  const showMotion = round?.motionsReleased === true;
  const { byeResult, motionId, motionText, adjudicators, ...safeDebate } = debate;

  return {
    ...safeDebate,
    ...(showResults && byeResult !== undefined ? { byeResult } : {}),
    ...(showMotion && motionId !== undefined ? { motionId } : {}),
    ...(showMotion && motionText !== undefined ? { motionText } : {}),
    adjudicators: showAdjudicators && adjudicators ? adjudicators : { ...HIDDEN_PANEL },
    resultStatus: showResults ? debate.resultStatus : "none",
    teams: Object.fromEntries(
      Object.entries(debate.teams || {}).map(([side, slot]) => {
        if (!slot) return [side, slot];
        const { points, speakerScoreTotal, ...safeSlot } = slot;
        return [side, {
          ...safeSlot,
          ...(showResults && points !== undefined ? { points } : {}),
          ...(showSpeakerScores && speakerScoreTotal !== undefined ? { speakerScoreTotal } : {}),
        }];
      })
    ) as Debate["teams"],
  };
}

export function getPrivatePortalBallots(
  ballots: BallotSubmission[],
  rounds: Round[],
  actorType: "adjudicator" | "team",
  resultsEnabled = true,
  /**
   * Tabbycat private_ballots_released: a team sees the full scoresheets (every adjudicator's
   * sheet and speaker scores) of its own debates once the round's results are released, even
   * before team speaks are.
   */
  privateBallotsReleased = false
): Array<Record<string, unknown>> {
  const roundsById = new Map(rounds.map((round) => [round.id, round]));
  const visibleBallots: Array<Record<string, unknown>> = [];

  for (const ballot of ballots) {
    if (actorType === "adjudicator") {
      visibleBallots.push({ ...ballot });
      continue;
    }

    const round = roundsById.get(ballot.roundId);
    if (
      !round ||
      !resultsEnabled ||
      round.resultsReleased !== true ||
      round.silent === true ||
      ballot.confirmed !== true ||
      ballot.discarded === true
    ) {
      continue;
    }

    const showSpeakerScores = round.teamSpeaksReleased === true || privateBallotsReleased;
    const teamScores = Object.fromEntries(
      Object.entries(ballot.teamScores || {}).map(([side, score]) => [
        side,
        showSpeakerScores
          ? score
          : {
              side: score.side,
              teamId: score.teamId,
              points: score.points,
              win: score.win,
              rank: score.rank,
            },
      ])
    );

    visibleBallots.push({
      id: ballot.id,
      tournamentId: ballot.tournamentId,
      roundId: ballot.roundId,
      debateId: ballot.debateId,
      version: ballot.version,
      confirmed: ballot.confirmed,
      discarded: ballot.discarded,
      timestamp: ballot.timestamp,
      ...(showSpeakerScores ? { speakerScores: ballot.speakerScores } : { speakerScores: {} }),
      teamScores,
      // Sheets name their adjudicators, so they need the panel to be public too.
      ...(privateBallotsReleased && round.adjudicatorsRevealed === true && Array.isArray(ballot.sheets) ? { sheets: ballot.sheets } : {}),
    });
  }
  return visibleBallots;
}

/* -------------------------------------------------------------------------- */
/* Code names on the private portals                                          */
/* -------------------------------------------------------------------------- */

/**
 * Names shown on a private-URL portal. Private URLs are participant (non-admin) pages, so they
 * follow Tabbycat's `use_team_code_names(admin=False)`: under every team code-name mode except
 * "off" and "all-tooltips", other teams appear under their code names (a team without one shows
 * an empty name, as on the public site). Under participant code names "everywhere", other teams'
 * speakers and other adjudicators appear under their code names. The viewer's own team, speakers
 * and name stay real. Ids the namer does not know keep their stored names.
 *
 * Adjudicator portals keep real speaker names: the ballot is entered by speaker, as the speakers
 * introduce themselves in the room.
 */
export interface PortalNamer {
  /** Whether anything is renamed at all (callers may skip loading records when not). */
  active: boolean;
  team(teamId: string | undefined, storedName?: string): string;
  speaker(speakerId: string | undefined, storedName?: string): string;
  adjudicator(adjudicatorId: string | undefined, storedName?: string): string;
}

/** Whether a portal renames adjudicators (and so needs their code names loaded). */
export function portalUsesParticipantCodeNames(preferences: Tournament["preferences"] | undefined): boolean {
  return getPublicSiteSettings(preferences).participantCodeNames === "everywhere";
}

export function createPortalNamer(input: {
  preferences: Tournament["preferences"] | undefined;
  viewer: { type: "adjudicator" | "team"; id: string };
  teams: Iterable<Pick<Team, "id" | "name" | "codeName" | "speakers">>;
  adjudicators?: Iterable<Pick<Adjudicator, "id" | "name" | "codeName">>;
}): PortalNamer {
  const settings = getPublicSiteSettings(input.preferences);
  const teamCodes = publicUsesTeamCodeNames(settings.teamCodeNames);
  const participantCodes = settings.participantCodeNames === "everywhere";
  const teamNames = new Map<string, string>();
  const speakerNames = new Map<string, string>();
  for (const team of input.teams) {
    const own = input.viewer.type === "team" && team.id === input.viewer.id;
    if (teamCodes && !own) teamNames.set(team.id, hasCodeName(team) ? team.codeName!.trim() : "");
    if (participantCodes && !own && input.viewer.type === "team") {
      for (const speaker of Array.isArray(team.speakers) ? team.speakers : []) {
        if (speaker?.id) speakerNames.set(speaker.id, speaker.codeName?.trim() || "");
      }
    }
  }
  const adjudicatorNames = new Map<string, string>();
  if (participantCodes) {
    for (const adjudicator of input.adjudicators ?? []) {
      if (input.viewer.type === "adjudicator" && adjudicator.id === input.viewer.id) continue;
      adjudicatorNames.set(adjudicator.id, adjudicator.codeName?.trim() || "");
    }
  }
  const lookup = (names: Map<string, string>) => (id: string | undefined, stored = "") =>
    id !== undefined && names.has(id) ? names.get(id)! : stored;
  return {
    active: teamNames.size > 0 || speakerNames.size > 0 || adjudicatorNames.size > 0,
    team: lookup(teamNames),
    speaker: lookup(speakerNames),
    adjudicator: lookup(adjudicatorNames),
  };
}

/** A portal debate with its team slots and panel renamed. */
export function renamePortalDebate(debate: Debate, namer: PortalNamer): Debate {
  if (!namer.active) return debate;
  const panel = debate.adjudicators;
  const names = (ids: string[] | undefined, stored: string[] | undefined) =>
    (ids ?? []).map((id, index) => namer.adjudicator(id, stored?.[index] ?? ""));
  return {
    ...debate,
    teams: Object.fromEntries(
      Object.entries(debate.teams || {}).map(([side, slot]) => [
        side,
        slot ? { ...slot, teamName: namer.team(slot.teamId, slot.teamName) } : slot,
      ])
    ) as Debate["teams"],
    ...(panel
      ? {
          adjudicators: {
            ...panel,
            ...(panel.chairId !== undefined ? { chairName: namer.adjudicator(panel.chairId, panel.chairName ?? "") } : {}),
            panellistNames: names(panel.panellistIds, panel.panellistNames),
            traineeNames: names(panel.traineeIds, panel.traineeNames),
          },
        }
      : {}),
  };
}

/** A portal team (name and speakers) renamed. */
export function renamePortalTeam<T extends { id: string; name: string; speakers: Array<{ id: string; name: string }> }>(
  team: T,
  namer: PortalNamer
): T {
  if (!namer.active) return team;
  return {
    ...team,
    name: namer.team(team.id, team.name),
    speakers: team.speakers.map((speaker) => ({ ...speaker, name: namer.speaker(speaker.id, speaker.name) })),
  };
}

/** Speaker and adjudicator names on a ballot as a portal shows it. */
export function renamePortalBallot(ballot: Record<string, unknown>, namer: PortalNamer): Record<string, unknown> {
  if (!namer.active) return ballot;
  const renameEntries = (scores: unknown) =>
    scores && typeof scores === "object"
      ? Object.fromEntries(
          Object.entries(scores as Record<string, unknown>).map(([side, entries]) => [
            side,
            Array.isArray(entries)
              ? entries.map((entry) =>
                  entry && typeof entry === "object" && "speakerId" in entry
                    ? {
                        ...entry,
                        speakerName: namer.speaker(
                          (entry as { speakerId?: string }).speakerId,
                          (entry as { speakerName?: string }).speakerName ?? ""
                        ),
                      }
                    : entry
                )
              : entries,
          ])
        )
      : scores;
  return {
    ...ballot,
    ...(ballot.speakerScores !== undefined ? { speakerScores: renameEntries(ballot.speakerScores) } : {}),
    ...(Array.isArray(ballot.sheets)
      ? {
          sheets: ballot.sheets.map((sheet: Record<string, unknown>) => ({
            ...sheet,
            adjudicatorName: namer.adjudicator(sheet.adjudicatorId as string | undefined, (sheet.adjudicatorName as string | undefined) ?? ""),
            speakerScores: renameEntries(sheet.speakerScores),
          })),
        }
      : {}),
  };
}

/** An adjudicator's debate without its motion until the round's motions are released (as Tabbycat). */
export function withoutUnreleasedMotion(debate: Debate, round: Round | undefined): Debate {
  if (motionsVisible(round)) return debate;
  const { motionId: _motionId, motionText: _motionText, ...rest } = debate;
  void _motionId;
  void _motionText;
  return rest;
}
