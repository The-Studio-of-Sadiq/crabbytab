import { ballotMatchesDebate, ballotVotesPossible } from "@/lib/ballots/result";
import { roundWeight as configuredRoundWeight } from "@/lib/ballots/ballotRules";
import { applyBallotSides } from "@/lib/draw/manualSides";
import { isPolyFormat, tournamentSides } from "@/lib/debateSides";
import {
  Tournament,
  Team,
  BallotSubmission,
  TeamStandingRow,
  SpeakerStandingRow,
  Debate,
  Round,
  DebateSide,
  SpeakerMetricId,
  SpeakerScoreEntry,
  TeamMetricId,
} from "@/types";
import {
  NO_TEAM_RESULTS,
  TeamRoundAccum,
  computeSpeakerMetrics,
  computeTeamMetrics,
  speakerTeamResults,
  weightedPoints,
} from "./metrics";
import {
  annotateWhoBeatWhom,
  assignSharedRanks,
  compareByPrecedence,
  compareTeamsByPrecedence,
  resolveSpeakerPrecedence,
  resolveTeamPrecedence,
  teamsTiedByPrecedence,
} from "./precedence";
import { SPEAKER_METRIC_DIRECTION } from "./metrics";

export interface StandingsCalculationResult {
  teams: TeamStandingRow[];
  speakers: SpeakerStandingRow[];
  replies: SpeakerStandingRow[];
}

const LEGACY_REPLY_ID = /^reply-(AFF|NEG)$/;

/**
 * Substantive speeches that count for a speaker: ghosts are excluded, and for ballots saved before
 * ghost flags existed, any repeat speech by the same speaker is treated as the ghost.
 */
export function countedSubstantiveSpeeches(entries: SpeakerScoreEntry[], replyEnabled: boolean): SpeakerScoreEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (replyEnabled && entry.position === 4) return false;
    if (entry.ghost) return false;
    if (!entry.speakerId) return true;
    if (seen.has(entry.speakerId)) return false;
    seen.add(entry.speakerId);
    return true;
  });
}

/**
 * Tabbycat's Round.weight: points earned in the round count this many times. Read defensively,
 * since older rounds (and rounds created before weights existed) have none.
 */
function roundWeightOf(round: Round | undefined): number {
  return configuredRoundWeight(round);
}

/**
 * BP places a team's points onto a 1st-4th finish; two-team formats have no such notion. Poly
 * (N teams per room) uses the same mapping, as Tabbycat's firsts/seconds/thirds metrics count
 * debates with 3, 2 and 1 points whatever the number of teams.
 */
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
  const poly = isPolyFormat(tournament.format);

  // Standings are a preliminary-round tab: elimination and cancelled rounds never count.
  // Debates whose round is unknown are kept so partial data still produces a tab.
  const excludedRoundIds = new Set(
    rounds.filter((round) => round.stage === "elimination" || round.cancelled).map((round) => round.id)
  );
  debates = debates.filter((debate) => !excludedRoundIds.has(debate.roundId));
  const roundById = new Map(rounds.map((round) => [round.id, round]));

  const debateById = new Map(debates.map((debate) => [debate.id, debate]));
  // A ballot only counts for the debate it was recorded for: if the draw changed underneath it
  // (different teams under the same debate id), it is ignored rather than credited to new teams,
  // and a ballot whose debate no longer exists (or is excluded above) never counts.
  const validBallots = ballots.filter((b) => {
    if (!b.confirmed || b.discarded) return false;
    const debate = debateById.get(b.debateId);
    return debate !== undefined && ballotMatchesDebate(b, debate);
  });
  const ballotMap = new Map<string, BallotSubmission>();
  validBallots.forEach((b) => ballotMap.set(b.debateId, b));
  // Sides chosen on the ballot (manual-ballot side allocation) are read from the confirmed ballot.
  debates = debates.map((debate) => {
    const ballot = ballotMap.get(debate.id);
    return ballot ? applyBallotSides(debate, ballot) : debate;
  });
  // Swing teams' results count for their opponents, but the teams and their speakers are not ranked.
  const swingTeamIds = new Set(teams.filter((team) => team.isSwing).map((team) => team.id));
  const swingSpeakerIds = new Set(
    teams.filter((team) => team.isSwing).flatMap((team) => (team.speakers || []).map((speaker) => speaker.id))
  );

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

  for (const debate of debates) {
    if (debate.postponed) continue;
    if (debate.byeTeamId) {
      if (debate.byeResult !== "win") continue;

      const team = teams.find((candidate) => candidate.id === debate.byeTeamId);
      const teamRow = teamRowsMap.get(debate.byeTeamId);
      if (!team || !teamRow) continue;

      // Like Tabbycat's bye results, a bye win records the team result only:
      // no speaker scores are invented, so speaks and speaker tabs are unaffected.
      // Tabbycat (bye_team_results "points", draw/manager.py) records a bye as 1 point and a win in
      // every format: in BP that is a third-place finish that also counts as a win.
      const byePoints = 1;
      const side = (Object.entries(debate.teams).find(([, slot]) => slot?.teamId === team.id)?.[0]
        ?? tournamentSides(tournament)[0]) as DebateSide;
      teamRow.points += byePoints * roundWeightOf(roundById.get(debate.roundId));
      if (isBP) teamRow.thirdPlaces!++;
      teamRow.wins!++;
      teamRoundAccum.get(team.id)!.push({
        points: byePoints,
        win: true,
        speaksSum: null,
        individualScores: [],
        margin: 0,
        opponentTeamIds: [],
        pulledUp: false,
        bye: true,
        rankInRoom: isBP || poly ? bpRankInRoom(byePoints) : undefined,
        roundWeight: roundWeightOf(roundById.get(debate.roundId)),
      });
      teamRow.roundResults.push({
        roundSeq: debate.roundSeq,
        side,
        points: byePoints,
        speakerScore: 0,
        bye: true,
        win: true,
        opponentTeamIds: [],
      });
      continue;
    }

    const ballot = ballotMap.get(debate.id);
    const slotsInDebate = Object.values(debate.teams).filter((slot) => slot?.teamId);
    const pullupDebate = slotsInDebate.some((slot) => slot?.pulledUp);
    const roundWeight = roundWeightOf(roundById.get(debate.roundId));

    if (!ballot) {
      // No confirmed result yet: the team scores nothing, but Tabbycat still counts the debate's
      // opponents for draw strength (every preliminary debate, ballot or not) and its pull-ups
      // (npullups / pullup_debates are not limited to confirmed ballots).
      for (const teamSlot of slotsInDebate) {
        const rows = teamRoundAccum.get(teamSlot!.teamId);
        if (!rows) continue;
        rows.push({
          points: 0,
          win: false,
          speaksSum: null,
          individualScores: [],
          margin: 0,
          opponentTeamIds: slotsInDebate.filter((slot) => slot!.teamId !== teamSlot!.teamId).map((slot) => slot!.teamId),
          pulledUp: Boolean(teamSlot!.pulledUp),
          pullupDebate,
          noResult: true,
          roundWeight,
        });
      }
      continue;
    }

    for (const [sideKey, teamSlot] of Object.entries(debate.teams)) {
      if (!teamSlot || !teamSlot.teamId) continue;
      const teamRow = teamRowsMap.get(teamSlot.teamId);
      if (!teamRow) continue;

      const side = sideKey as DebateSide;
      const teamScore = ballot.teamScores[side];
      const speakerScores = ballot.speakerScores[side] || [];
      const includeGhosts = tournament.preferences?.teamScoreIncludesGhosts ?? false;
      const countedSpeeches = countedSubstantiveSpeeches(speakerScores, Boolean(isReplyPosition));
      const substantiveList = includeGhosts
        ? speakerScores.filter((sc) => !(isReplyPosition && sc.position === 4))
        : countedSpeeches;
      const substantiveScores = countedSpeeches.map((sc) => sc.score || 0);
      const totalSpeakersScore = teamScore?.totalSpeakerScore !== undefined
        ? teamScore.totalSpeakerScore
        : substantiveList.reduce((sum, sc) => sum + (sc.score || 0), 0);
      // A forfeit or results-only ballot has a result but no speaker scores: its team score is
      // absent (not zero), so it is left out of every speaks and margin metric, as in Tabbycat.
      const isForfeit = Boolean(ballot.forfeitSide) || Boolean(ballot.noSpeakerScores);
      const substantiveEntries = speakerScores.filter((sc) => !(isReplyPosition && sc.position === 4));
      // Voting ballots record each side's votes; consensus ballots record none (and carry none).
      // A self-split ballot's single sheet counts as a 2:1 panel (3 votes).
      const votesPossible = teamScore?.votes !== undefined ? ballotVotesPossible(ballot) : undefined;

      const pts = teamScore ? teamScore.points || 0 : 0;
      // Tabbycat records no wins in BP preliminary rounds (TeamScore.win is unset), so BP "wins"
      // and the draw strength built on them stay 0; BP ranks on points and draw_strength.
      // Poly teams win only when a results-only ballot declares them advancing (Tabbycat).
      const win = isBP ? false : poly ? Boolean(teamScore?.win) : Boolean(teamScore?.win) || pts === 1;
      const margin = isBP || poly ? 0 : teamScore?.margin || 0;

      teamRow.points += pts * roundWeight;
      if (!isForfeit) teamRow.totalSpeakerScore += totalSpeakersScore;

      if (isBP) {
        if (pts === 3) teamRow.firstPlaces!++;
        else if (pts === 2) teamRow.secondPlaces!++;
        else if (pts === 1) teamRow.thirdPlaces!++;
        else teamRow.fourthPlaces!++;
      } else if (poly) {
        // N-team rooms have no losses or margins; a team "wins" only by advancing.
        if (win) teamRow.wins!++;
      } else {
        if (win) teamRow.wins!++;
        else teamRow.losses!++;
        if (!isForfeit) teamRow.margins! += margin;
      }

      const opponentTeamIds = slotsInDebate
        .filter((slot) => slot!.teamId !== teamSlot.teamId)
        .map((slot) => slot!.teamId);

      teamRoundAccum.get(teamSlot.teamId)!.push({
        points: pts,
        win,
        speaksSum: isForfeit ? null : totalSpeakersScore,
        individualScores: isForfeit ? [] : substantiveScores,
        margin,
        opponentTeamIds,
        pulledUp: Boolean(teamSlot.pulledUp),
        rankInRoom: isBP || poly ? bpRankInRoom(pts) : undefined,
        ...(votesPossible ? { votesGiven: teamScore?.votes ?? 0, votesPossible } : {}),
        ironed: !isForfeit && substantiveEntries.length > countedSpeeches.length,
        pullupDebate,
        roundWeight,
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
  const opponentPoints = new Map<string, number>();
  const opponentSpeaksSum = new Map<string, number>();

  for (const team of teams) {
    const rows = teamRoundAccum.get(team.id)!;
    opponentWins.set(team.id, rows.filter((r) => r.win).length);
    opponentPoints.set(team.id, weightedPoints(rows));
    opponentSpeaksSum.set(team.id, rows.reduce((s, r) => s + (r.speaksSum ?? 0), 0));

    const row = teamRowsMap.get(team.id)!;
    const roundsCount = rows.filter((r) => r.speaksSum !== null).length;
    const totalSpeeches = roundsCount * speakersPerTeam;
    row.averageSpeakerScore = totalSpeeches > 0 ? Number((row.totalSpeakerScore / totalSpeeches).toFixed(2)) : 0;
  }

  /* ---------------------------------------------------------------------- */
  /* 3. Full metrics, sort by the resolved precedence, rank with shared ties */
  /* ---------------------------------------------------------------------- */

  const teamPrecedence = resolveTeamPrecedence(tournament.format, tournament.preferences);
  const ctx = { opponentWins, opponentPoints, opponentSpeaksSum };

  const teamList = Array.from(teamRowsMap.values()).filter((row) => !swingTeamIds.has(row.teamId));
  for (const row of teamList) {
    row.metrics = computeTeamMetrics(teamRoundAccum.get(row.teamId)!, ctx);
  }

  // Who-beat-whom needs every team's other metrics first: it compares the two teams (if exactly
  // two) tied on every metric before it, by the points each earned against the other.
  const pointsAgainst = (teamId: string, otherId: string) =>
    (teamRoundAccum.get(teamId) ?? [])
      .filter((round) => round.opponentTeamIds.includes(otherId))
      .reduce((sum, round) => sum + round.points, 0);
  if (teamPrecedence.includes("wbw")) annotateWhoBeatWhom(teamList, teamPrecedence, pointsAgainst);

  teamList.sort((a, b) => {
    const byMetric = compareTeamsByPrecedence(a, b, teamPrecedence);
    return byMetric !== 0 ? byMetric : a.teamName.localeCompare(b.teamName);
  });
  teamList.forEach((row, index) => {
    const tied = index > 0 && teamsTiedByPrecedence(teamList[index - 1], row, teamPrecedence);
    row.rank = tied ? teamList[index - 1].rank : index + 1;
  });

  // Draw strength by rank (Tabbycat's draw_strength_rank, display only): the mean rank of the
  // team's opponents, each meeting counted once. Unranked opponents (swing teams) are skipped.
  const rankByTeam = new Map(teamList.map((row) => [row.teamId, row.rank]));
  for (const row of teamList) {
    const opponentRanks = (teamRoundAccum.get(row.teamId) ?? [])
      .flatMap((round) => round.opponentTeamIds)
      .flatMap((id) => (rankByTeam.has(id) ? [rankByTeam.get(id)!] : []));
    row.metrics.draw_strength_rank = opponentRanks.length
      ? opponentRanks.reduce((sum, rank) => sum + rank, 0) / opponentRanks.length
      : null;
  }

  /* ---------------------------------------------------------------------- */
  /* 4. Speaker and reply standings                                          */
  /* ---------------------------------------------------------------------- */

  const speakerRowsMap = new Map<string, SpeakerStandingRow>();
  const replyRowsMap = new Map<string, SpeakerStandingRow>();
  const speakerScoresByRound = new Map<string, { substantive: number[]; reply: number[] }>();
  const speechRanksBySpeaker = new Map<string, number[]>();

  for (const team of teams) {
    if (team.isSwing) continue;
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
    if (debate.postponed) continue;
    const ballot = ballotMap.get(debate.id);
    if (!ballot) continue;

    for (const [, scoresList] of Object.entries(ballot.speakerScores || {})) {
      const counted = new Set(countedSubstantiveSpeeches(scoresList, Boolean(isReplyPosition)));
      for (const entry of scoresList) {
        if (!entry.speakerId || !entry.score) continue;
        if (swingSpeakerIds.has(entry.speakerId)) continue;
        const isReply = Boolean(isReplyPosition && entry.position === 4);
        // Ghost (iron-person) speeches never count in the speaker tab.
        if (!isReply && !counted.has(entry)) continue;
        // Early private-portal ballots recorded replies under a per-side placeholder id; they
        // cannot be attributed to a speaker, so they are left out rather than merged.
        if (isReply && LEGACY_REPLY_ID.test(entry.speakerId)) continue;

        if (isReply) {
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
            // Reply speakers usually also gave a substantive speech: keep the scores already collected.
            if (!speakerScoresByRound.has(entry.speakerId)) {
              speakerScoresByRound.set(entry.speakerId, { substantive: [], reply: [] });
            }
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
            if (!speakerScoresByRound.has(entry.speakerId)) {
              speakerScoresByRound.set(entry.speakerId, { substantive: [], reply: [] });
            }
          }
          spkRow.totalScore += entry.score;
          spkRow.speechesCount++;
          spkRow.scoresByRound.push({ roundSeq: debate.roundSeq, score: entry.score, position: entry.position });
          speakerScoresByRound.get(entry.speakerId)!.substantive.push(entry.score);
          if (typeof entry.rank === "number") {
            speechRanksBySpeaker.set(entry.speakerId, [...(speechRanksBySpeaker.get(entry.speakerId) ?? []), entry.rank]);
          }
        }
      }
    }
  }

  // Tabbycat's trimmed mean drops one highest and one lowest score; speakerTrim may change the count.
  const trim = Math.max(0, tournament.preferences?.speakerTrim ?? 1);
  const speakerPrecedence = resolveSpeakerPrecedence(tournament.preferences);

  // Standings eligibility (Tabbycat's "speeches missable"): a speaker must have given at least
  // (preliminary rounds so far − missable) speeches to be ranked. As Tabbycat (every preliminary
  // round up to the current one), every preliminary round that has been drawn counts, whether or
  // not its results are in. One exception: a round whose confirmed ballots carry no speaker scores
  // at all (speakersInBallots) is not counted, since in Tabbycat it would make every speaker
  // ineligible.
  const hasSpeakerScores = (ballot: BallotSubmission | undefined) =>
    Boolean(ballot && !ballot.noSpeakerScores && !ballot.forfeitSide);
  const drawnRoundIds = new Set(debates.filter((debate) => !debate.postponed).map((debate) => debate.roundId));
  const resultsOnlyRoundIds = new Set(
    [...drawnRoundIds].filter((roundId) => {
      const roundBallots = debates
        .filter((debate) => debate.roundId === roundId)
        .flatMap((debate) => (ballotMap.has(debate.id) ? [ballotMap.get(debate.id)] : []));
      return roundBallots.length > 0 && !roundBallots.some(hasSpeakerScores);
    })
  );
  const roundsCounted = drawnRoundIds.size - resultsOnlyRoundIds.size;
  const minimumSpeeches = (missable: number | undefined) =>
    missable === undefined || !Number.isFinite(missable) || missable < 0 ? 0 : roundsCounted - Math.floor(missable);

  // Tabbycat ranks reply speakers on their average reply score alone (BaseReplyStandingsView
  // ('replies_avg',)), whatever the speaker standings precedence.
  const replyPrecedence: SpeakerMetricId[] = ["reply_avg"];

  const finalizeSpeakerList = (rowsMap: Map<string, SpeakerStandingRow>, isReplyList: boolean) => {
    const precedence = isReplyList ? replyPrecedence : speakerPrecedence;
    const list = Array.from(rowsMap.values());
    for (const row of list) {
      const scores = speakerScoresByRound.get(row.speakerId) ?? { substantive: [], reply: [] };
      // The team's results, whether or not this speaker spoke in each debate (as Tabbycat).
      const team = row.teamId ? speakerTeamResults(teamRoundAccum.get(row.teamId)) : NO_TEAM_RESULTS;
      row.averageScore = row.speechesCount > 0 ? Number((row.totalScore / row.speechesCount).toFixed(2)) : 0;
      row.metrics = isReplyList
        ? computeSpeakerMetrics(scores.reply, scores.reply, trim, team)
        : computeSpeakerMetrics(scores.substantive, scores.reply, trim, team, speechRanksBySpeaker.get(row.speakerId) ?? []);
    }
    const minimum = minimumSpeeches(
      isReplyList ? tournament.preferences?.standingsMissedReplies : tournament.preferences?.standingsMissedDebates
    );
    for (const row of list) {
      if (row.speechesCount < minimum) row.ineligible = true;
    }
    // Eligible speakers are ranked first; ineligible ones follow in the same order, unranked.
    list.sort((a, b) => {
      if (Boolean(a.ineligible) !== Boolean(b.ineligible)) return a.ineligible ? 1 : -1;
      const byMetric = compareByPrecedence(a.metrics, b.metrics, precedence, SPEAKER_METRIC_DIRECTION);
      return byMetric !== 0 ? byMetric : a.speakerName.localeCompare(b.speakerName);
    });
    const eligible = list.filter((row) => !row.ineligible);
    assignSharedRanks(eligible, (row) => row.metrics, precedence, (row, rank) => (row.rank = rank));
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
