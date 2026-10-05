import {
  Tournament,
  Team,
  BallotSubmission,
  TeamStandingRow,
  SpeakerStandingRow,
  Debate,
  Round,
  DebateSide,
  TeamMetricId,
} from "@/types";
import { TeamRoundAccum, computeSpeakerMetrics, computeTeamMetrics } from "./metrics";
import { assignSharedRanks, compareByPrecedence, resolveSpeakerPrecedence, resolveTeamPrecedence } from "./precedence";
import { TEAM_METRIC_DIRECTION, SPEAKER_METRIC_DIRECTION } from "./metrics";

export interface StandingsCalculationResult {
  teams: TeamStandingRow[];
  speakers: SpeakerStandingRow[];
  replies: SpeakerStandingRow[];
}

/** BP places a team's points onto a 1st-4th finish; two-team formats have no such notion. */
function bpRankInRoom(points: number): number {
  return points === 3 ? 1 : points === 2 ? 2 : points === 1 ? 3 : 4;
}

/**
 * Computes standings for teams, speakers, and reply speakers. Ranking uses
 * the tournament's configured metric precedence (`teamStandingsPrecedence` /
 * `speakerStandingsPrecedence`), falling back to the format's traditional
 * default chain when none is set. See `src/lib/standings/metrics.ts` for the
 * metric definitions and `precedence.ts` for how the chain is applied.
 */
export function calculateStandings(
  tournament: Tournament,
  rounds: Round[],
  teams: Team[],
  debates: Debate[],
  ballots: BallotSubmission[]
): StandingsCalculationResult {
  const isBP = tournament.format === "bp";

  const validBallots = ballots.filter((b) => b.confirmed && !b.discarded);
  const ballotMap = new Map<string, BallotSubmission>();
  validBallots.forEach((b) => ballotMap.set(b.debateId, b));

  const isReplyPosition = tournament.preferences?.replyScoresEnabled && !isBP;
  const substantiveSpeakersPerTeam = tournament.preferences?.substantiveSpeakers ?? (isBP ? 2 : 3);

  /* ---------------------------------------------------------------------- */
  /* 1. Accumulate raw per-round data for every team                        */
  /* ---------------------------------------------------------------------- */

  const teamRowsMap = new Map<string, TeamStandingRow>();
  const teamRoundAccum = new Map<string, TeamRoundAccum[]>();

  for (const team of teams) {
    teamRowsMap.set(team.id, {
      rank: 0,
      teamId: team.id,
      teamName: team.name,
      institutionCode: team.institutionName || "",
      breakCategories: team.breakCategories || [],
      points: 0,
      totalSpeakerScore: 0,
      averageSpeakerScore: 0,
      margins: 0,
      firstPlaces: 0,
      secondPlaces: 0,
      thirdPlaces: 0,
      fourthPlaces: 0,
      wins: 0,
      losses: 0,
      roundResults: [],
      metrics: {} as Record<TeamMetricId, number>,
    });
    teamRoundAccum.set(team.id, []);
  }

  const byeSpeakerScores = new Map<string, Map<string, number>>();

  for (const debate of debates) {
    if (debate.byeTeamId) {
      if (debate.byeResult !== "win") continue;

      const team = teams.find((candidate) => candidate.id === debate.byeTeamId);
      const teamRow = teamRowsMap.get(debate.byeTeamId);
      if (!team || !teamRow) continue;

      const priorScoresBySpeaker = new Map<string, number[]>();
      const priorTeamScores: number[] = [];
      const priorTournamentScores: number[] = [];
      for (const priorDebate of debates) {
        if (priorDebate.roundSeq >= debate.roundSeq || priorDebate.byeTeamId) continue;
        const priorBallot = ballotMap.get(priorDebate.id);
        if (!priorBallot) continue;

        for (const scores of Object.values(priorBallot.speakerScores || {})) {
          for (const entry of scores) {
            if (!Number.isFinite(entry.score) || entry.score <= 0 || (isReplyPosition && entry.position === 4)) continue;
            priorTournamentScores.push(entry.score);
            if (team.speakers?.slice(0, substantiveSpeakersPerTeam).some((speaker) => speaker.id === entry.speakerId)) {
              priorTeamScores.push(entry.score);
              if (entry.speakerId) {
                const speakerScores = priorScoresBySpeaker.get(entry.speakerId) ?? [];
                speakerScores.push(entry.score);
                priorScoresBySpeaker.set(entry.speakerId, speakerScores);
              }
            }
          }
        }
      }

      const average = (scores: number[]) =>
        scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : undefined;
      const fallbackScore = average(priorTeamScores)
        ?? average(priorTournamentScores)
        // Use the configured scale midpoint when the bye occurs before any scored round.
        ?? ((tournament.preferences?.minSpeakerScore ?? 0) + (tournament.preferences?.maxSpeakerScore ?? 0)) / 2;
      const speakerScores = new Map<string, number>();
      for (const speaker of (team.speakers || []).slice(0, substantiveSpeakersPerTeam)) {
        speakerScores.set(speaker.id, average(priorScoresBySpeaker.get(speaker.id) ?? []) ?? fallbackScore);
      }
      byeSpeakerScores.set(debate.id, speakerScores);

      const speakerScoreTotal = Array.from(speakerScores.values()).reduce((sum, score) => sum + score, 0);
      const byePoints = isBP ? 3 : 1;
      const side = (Object.entries(debate.teams).find(([, slot]) => slot?.teamId === team.id)?.[0]
        ?? (isBP ? "OG" : "AFF")) as DebateSide;
      teamRow.points += byePoints;
      teamRow.totalSpeakerScore += speakerScoreTotal;
      if (isBP) {
        teamRow.firstPlaces!++;
      } else {
        teamRow.wins!++;
      }
      teamRoundAccum.get(team.id)!.push({
        points: byePoints,
        win: true,
        speaksSum: speakerScoreTotal,
        individualScores: Array.from(speakerScores.values()),
        margin: 0,
        opponentTeamIds: [],
        pulledUp: false,
        rankInRoom: isBP ? 1 : undefined,
      });
      teamRow.roundResults.push({
        roundSeq: debate.roundSeq,
        side,
        points: byePoints,
        speakerScore: speakerScoreTotal,
        rank: isBP ? 1 : undefined,
        win: true,
        opponentTeamIds: [],
      });
      continue;
    }

    const ballot = ballotMap.get(debate.id);
    if (!ballot) continue;

    const slotsInDebate = Object.values(debate.teams).filter((slot) => slot?.teamId);

    for (const [sideKey, teamSlot] of Object.entries(debate.teams)) {
      if (!teamSlot || !teamSlot.teamId) continue;
      const teamRow = teamRowsMap.get(teamSlot.teamId);
      if (!teamRow) continue;

      const side = sideKey as DebateSide;
      const teamScore = ballot.teamScores[side];
      const speakerScores = ballot.speakerScores[side] || [];
      const includeGhosts = tournament.preferences?.teamScoreIncludesGhosts ?? false;
      let substantiveList = speakerScores.filter((sc) => !(isReplyPosition && sc.position === 4));
      if (!includeGhosts) {
        const seenSpeakerIds = new Set<string>();
        substantiveList = substantiveList.filter((sc) => {
          if (!sc.speakerId) return true;
          if (seenSpeakerIds.has(sc.speakerId)) return false;
          seenSpeakerIds.add(sc.speakerId);
          return true;
        });
      }
      const substantiveScores = substantiveList.map((sc) => sc.score || 0);
      const totalSpeakersScore = teamScore?.totalSpeakerScore !== undefined
        ? teamScore.totalSpeakerScore
        : substantiveScores.reduce((sum, sc) => sum + sc, 0);

      const pts = teamScore ? teamScore.points || 0 : 0;
      const win = isBP ? pts >= 2 : Boolean(teamScore?.win) || pts === 1;
      const margin = isBP ? 0 : teamScore?.margin || 0;

      teamRow.points += pts;
      teamRow.totalSpeakerScore += totalSpeakersScore;

      if (isBP) {
        if (pts === 3) teamRow.firstPlaces!++;
        else if (pts === 2) teamRow.secondPlaces!++;
        else if (pts === 1) teamRow.thirdPlaces!++;
        else teamRow.fourthPlaces!++;
      } else {
        if (win) teamRow.wins!++;
        else teamRow.losses!++;
        teamRow.margins! += margin;
      }

      const opponentTeamIds = slotsInDebate
        .filter((slot) => slot!.teamId !== teamSlot.teamId)
        .map((slot) => slot!.teamId);

      teamRoundAccum.get(teamSlot.teamId)!.push({
        points: pts,
        win,
        speaksSum: totalSpeakersScore,
        individualScores: substantiveScores,
        margin,
        opponentTeamIds,
        pulledUp: Boolean(teamSlot.pulledUp),
        rankInRoom: isBP ? bpRankInRoom(pts) : undefined,
      });

      teamRow.roundResults.push({
        roundSeq: debate.roundSeq,
        side,
        points: pts,
        speakerScore: totalSpeakersScore,
        rank: teamScore?.rank,
        win: teamScore?.win,
        opponentTeamIds,
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 2. Base sums (for draw strength) and legacy averageSpeakerScore         */
  /* ---------------------------------------------------------------------- */

  const speakersPerTeam = tournament.preferences?.substantiveSpeakers || (isBP ? 2 : 3);
  const opponentWins = new Map<string, number>();
  const opponentSpeaksSum = new Map<string, number>();

  for (const team of teams) {
    const rows = teamRoundAccum.get(team.id)!;
    opponentWins.set(team.id, rows.filter((r) => r.win).length);
    opponentSpeaksSum.set(team.id, rows.reduce((s, r) => s + (r.speaksSum ?? 0), 0));

    const row = teamRowsMap.get(team.id)!;
    const roundsCount = rows.length;
    const totalSpeeches = roundsCount * speakersPerTeam;
    row.averageSpeakerScore = totalSpeeches > 0 ? Number((row.totalSpeakerScore / totalSpeeches).toFixed(2)) : 0;
  }

  /* ---------------------------------------------------------------------- */
  /* 3. Full metrics, sort by the resolved precedence, rank with shared ties */
  /* ---------------------------------------------------------------------- */

  const teamPrecedence = resolveTeamPrecedence(tournament.format, tournament.preferences);
  const ctx = { opponentWins, opponentSpeaksSum };

  const teamList = Array.from(teamRowsMap.values());
  for (const row of teamList) {
    row.metrics = computeTeamMetrics(teamRoundAccum.get(row.teamId)!, ctx);
  }

  teamList.sort((a, b) => {
    const byMetric = compareByPrecedence(a.metrics, b.metrics, teamPrecedence, TEAM_METRIC_DIRECTION);
    return byMetric !== 0 ? byMetric : a.teamName.localeCompare(b.teamName);
  });
  assignSharedRanks(teamList, (row) => row.metrics, teamPrecedence, (row, rank) => (row.rank = rank));

  /* ---------------------------------------------------------------------- */
  /* 4. Speaker and reply standings                                          */
  /* ---------------------------------------------------------------------- */

  const speakerRowsMap = new Map<string, SpeakerStandingRow>();
  const replyRowsMap = new Map<string, SpeakerStandingRow>();
  const speakerScoresByRound = new Map<string, { substantive: number[]; reply: number[] }>();

  for (const team of teams) {
    for (const spk of team.speakers || []) {
      speakerRowsMap.set(spk.id, {
        rank: 0,
        speakerId: spk.id,
        speakerName: spk.name,
        teamId: team.id,
        teamName: team.name,
        institutionCode: team.institutionName || "",
        categories: spk.categories || team.speakerCategories || [],
        totalScore: 0,
        averageScore: 0,
        speechesCount: 0,
        scoresByRound: [],
        metrics: {} as any,
      });
      speakerScoresByRound.set(spk.id, { substantive: [], reply: [] });
    }
  }

  for (const debate of debates) {
    const speakerScores = byeSpeakerScores.get(debate.id);
    if (!speakerScores) continue;
    for (const [speakerId, score] of speakerScores) {
      const row = speakerRowsMap.get(speakerId);
      if (!row) continue;
      const position = row.speechesCount + 1;
      row.totalScore += score;
      row.speechesCount++;
      row.scoresByRound.push({ roundSeq: debate.roundSeq, score, position });
      speakerScoresByRound.get(speakerId)!.substantive.push(score);
    }
  }

  for (const debate of debates) {
    const ballot = ballotMap.get(debate.id);
    if (!ballot) continue;

    for (const [, scoresList] of Object.entries(ballot.speakerScores || {})) {
      for (const entry of scoresList) {
        if (!entry.speakerId || !entry.score) continue;

        if (isReplyPosition && entry.position === 4) {
          if (!replyRowsMap.has(entry.speakerId)) {
            const team = teams.find((t) => t.speakers?.some((s) => s.id === entry.speakerId));
            replyRowsMap.set(entry.speakerId, {
              rank: 0,
              speakerId: entry.speakerId,
              speakerName: entry.speakerName,
              teamId: team?.id || "",
              teamName: team?.name || "",
              institutionCode: team?.institutionName || "",
              categories: [],
              totalScore: 0,
              averageScore: 0,
              speechesCount: 0,
              scoresByRound: [],
              metrics: {} as any,
            });
            speakerScoresByRound.set(entry.speakerId, { substantive: [], reply: [] });
          }
          const repRow = replyRowsMap.get(entry.speakerId)!;
          repRow.totalScore += entry.score;
          repRow.speechesCount++;
          repRow.scoresByRound.push({ roundSeq: debate.roundSeq, score: entry.score, position: entry.position });
          speakerScoresByRound.get(entry.speakerId)!.reply.push(entry.score);
        } else {
          let spkRow = speakerRowsMap.get(entry.speakerId);
          if (!spkRow) {
            const team = teams.find((t) => t.speakers?.some((s) => s.id === entry.speakerId));
            spkRow = {
              rank: 0,
              speakerId: entry.speakerId,
              speakerName: entry.speakerName,
              teamId: team?.id || "",
              teamName: team?.name || "",
              institutionCode: team?.institutionName || "",
              categories: [],
              totalScore: 0,
              averageScore: 0,
              speechesCount: 0,
              scoresByRound: [],
              metrics: {} as any,
            };
            speakerRowsMap.set(entry.speakerId, spkRow);
            speakerScoresByRound.set(entry.speakerId, { substantive: [], reply: [] });
          }
          spkRow.totalScore += entry.score;
          spkRow.speechesCount++;
          spkRow.scoresByRound.push({ roundSeq: debate.roundSeq, score: entry.score, position: entry.position });
          speakerScoresByRound.get(entry.speakerId)!.substantive.push(entry.score);
        }
      }
    }
  }

  const trim = Math.max(0, tournament.preferences?.speakerTrim ?? 0);
  const speakerPrecedence = resolveSpeakerPrecedence(tournament.preferences);

  const finalizeSpeakerList = (rowsMap: Map<string, SpeakerStandingRow>, isReplyList: boolean) => {
    const list = Array.from(rowsMap.values());
    for (const row of list) {
      const scores = speakerScoresByRound.get(row.speakerId) ?? { substantive: [], reply: [] };
      row.averageScore = row.speechesCount > 0 ? Number((row.totalScore / row.speechesCount).toFixed(2)) : 0;
      row.metrics = isReplyList
        ? computeSpeakerMetrics(scores.reply, [], trim)
        : computeSpeakerMetrics(scores.substantive, scores.reply, trim);
    }
    list.sort((a, b) => {
      const byMetric = compareByPrecedence(a.metrics, b.metrics, speakerPrecedence, SPEAKER_METRIC_DIRECTION);
      return byMetric !== 0 ? byMetric : a.speakerName.localeCompare(b.speakerName);
    });
    assignSharedRanks(list, (row) => row.metrics, speakerPrecedence, (row, rank) => (row.rank = rank));
    return list;
  };

  const speakerList = finalizeSpeakerList(speakerRowsMap, false);
  const replyList = finalizeSpeakerList(replyRowsMap, true);

  return {
    teams: teamList,
    speakers: speakerList,
    replies: replyList,
  };
}
