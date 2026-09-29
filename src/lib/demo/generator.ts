import {
  Tournament,
  Round,
  Team,
  Adjudicator,
  Venue,
  Motion,
  BreakCategory,
  Debate,
  BallotSubmission,
  TournamentFormat,
  DebateSide,
  BPSide,
  Institution,
} from "@/types";
import { generateRoundDraw } from "../draw/generator";
import { autoAllocateAdjudicators } from "../draw/allocator";
import { calculateStandings } from "../standings/calculator";

export interface DemoTournamentBundle {
  tournament: Tournament;
  rounds: Round[];
  teams: Team[];
  adjudicators: Adjudicator[];
  institutions: Institution[];
  venues: Venue[];
  motions: Motion[];
  breakCategories: BreakCategory[];
  debates: Debate[];
  ballots: BallotSubmission[];
}

export function generateDemoTournament(
  name: string = "World Universities Debating Championship (Demo)",
  slug: string = "wudc-demo",
  format: TournamentFormat = "bp"
): DemoTournamentBundle {
  const tournamentId = `tourn-${slug}-${Date.now()}`;
  const now = new Date().toISOString();

  const isBP = format === "bp";

  // 1. Tournament metadata
  const tournament: Tournament = {
    id: tournamentId,
    name,
    shortName: "WUDC Demo",
    slug,
    format,
    active: true,
    ownerId: "demo-owner",
    admins: { "demo-owner": true },
    preferences: {
      teamsInDebate: isBP ? 4 : 2,
      substantiveSpeakers: isBP ? 2 : 3,
      replyScoresEnabled: !isBP,
      minSpeakerScore: 68,
      maxSpeakerScore: 84,
      stepSpeakerScore: 1,
      minReplyScore: 34,
      maxReplyScore: 42,
      drawRule: "power_paired",
      sideAllocationRule: "balanced",
      ballotDoubleEntry: false,
      publicDraw: true,
      publicResults: true,
      publicStandings: true,
      publicMotions: true,
      feedbackEnabled: true,
      feedbackMinScore: 1,
      feedbackMaxScore: 10,
    },
    createdAt: now,
    updatedAt: now,
  };

  // 2. Break Categories
  const breakCategories: BreakCategory[] = [
    {
      id: `bc-open-${tournamentId}`,
      tournamentId,
      name: "Open Break",
      slug: "open",
      seq: 1,
      breakSize: isBP ? 8 : 8,
      reserveSize: 2,
      isGeneral: true,
      priority: 10,
    },
    {
      id: `bc-esl-${tournamentId}`,
      tournamentId,
      name: "ESL Break",
      slug: "esl",
      seq: 2,
      breakSize: 4,
      reserveSize: 2,
      isGeneral: false,
      priority: 5,
    },
    {
      id: `bc-novice-${tournamentId}`,
      tournamentId,
      name: "Novice Break",
      slug: "novice",
      seq: 3,
      breakSize: 4,
      reserveSize: 1,
      isGeneral: false,
      priority: 2,
    },
  ];

  // 3. Institutions
  const sampleInstitutions: Institution[] = [
    { id: `inst-${tournamentId}-oxford`, tournamentId, name: "Oxford Union", code: "Oxford", region: "UK" },
    { id: `inst-${tournamentId}-cambridge`, tournamentId, name: "Cambridge Union", code: "Cambridge", region: "UK" },
    { id: `inst-${tournamentId}-harvard`, tournamentId, name: "Harvard Debating Union", code: "Harvard", region: "North America" },
    { id: `inst-${tournamentId}-sydney`, tournamentId, name: "Sydney Debating Society", code: "Sydney", region: "Australasia" },
    { id: `inst-${tournamentId}-yale`, tournamentId, name: "Yale Debate Association", code: "Yale", region: "North America" },
    { id: `inst-${tournamentId}-lse`, tournamentId, name: "London School of Economics", code: "LSE", region: "UK" },
    { id: `inst-${tournamentId}-melbourne`, tournamentId, name: "Melbourne Debating Society", code: "Melbourne", region: "Australasia" },
    { id: `inst-${tournamentId}-stanford`, tournamentId, name: "Stanford Debate Society", code: "Stanford", region: "North America" },
  ];

  // 4. Teams & Speakers (16 teams)
  const teams: Team[] = [];
  let tIdx = 1;

  for (const inst of sampleInstitutions) {
    for (const suffix of ["A", "B"]) {
      const teamId = `team-${tournamentId}-${tIdx}`;
      const isESL = tIdx % 3 === 0;
      const isNovice = tIdx % 4 === 0;

      const spkCategories: string[] = [];
      if (isESL) spkCategories.push("esl");
      if (isNovice) spkCategories.push("novice");

      const eligibleBreaks = [`bc-open-${tournamentId}`];
      if (isESL) eligibleBreaks.push(`bc-esl-${tournamentId}`);
      if (isNovice) eligibleBreaks.push(`bc-novice-${tournamentId}`);

      const speakers = [
        {
          id: `spk-${teamId}-1`,
          name: `${inst.code} ${suffix} Speaker 1`,
          categories: spkCategories,
        },
        {
          id: `spk-${teamId}-2`,
          name: `${inst.code} ${suffix} Speaker 2`,
          categories: spkCategories,
        },
      ];

      if (!isBP) {
        speakers.push({
          id: `spk-${teamId}-3`,
          name: `${inst.code} ${suffix} Speaker 3`,
          categories: spkCategories,
        });
      }

      teams.push({
        id: teamId,
        tournamentId,
        name: `${inst.code} ${suffix}`,
        codeName: `${inst.code} ${suffix}`,
        institutionId: inst.id,
        institutionName: inst.name,
        speakers,
        breakCategories: eligibleBreaks,
        speakerCategories: spkCategories,
        checkedIn: true,
      });

      tIdx++;
    }
  }

  // 5. Adjudicators (8 judges with realistic affiliations and conflicts)
  const sampleJudges = [
    { name: "Eleanor Vance (Chief Adj)", score: 9.0, trainee: false, inst: sampleInstitutions[0] }, // Oxford
    { name: "Marcus Brody", score: 8.5, trainee: false, inst: sampleInstitutions[1] }, // Cambridge
    { name: "Aria Montgomery", score: 8.0, trainee: false, inst: sampleInstitutions[4] }, // Yale
    { name: "David Kim", score: 7.5, trainee: false, inst: sampleInstitutions[2] }, // Harvard
    { name: "Sophie Dupont", score: 7.0, trainee: false, inst: sampleInstitutions[3] }, // Sydney
    { name: "Lucas Silva", score: 6.5, trainee: false, inst: null }, // Independent
    { name: "Zara Chen", score: 5.5, trainee: true, inst: sampleInstitutions[0] }, // Oxford Trainee
    { name: "Oliver Smith", score: 5.0, trainee: true, inst: null }, // Independent Trainee
  ];

  const adjudicators: Adjudicator[] = sampleJudges.map((j, idx) => ({
    id: `adj-${tournamentId}-${idx + 1}`,
    tournamentId,
    name: j.name,
    institutionId: j.inst?.id,
    institutionName: j.inst?.name,
    baseScore: j.score,
    trainee: j.trainee,
    independent: !j.inst,
    checkedIn: true,
    conflicts: j.inst ? [{ institutionId: j.inst.id, type: "institution" }] : [],
  }));

  // 5. Venues (4 to 8 rooms)
  const venues: Venue[] = Array.from({ length: 8 }, (_, idx) => ({
    id: `ven-${tournamentId}-${idx + 1}`,
    tournamentId,
    name: `Lecture Hall ${String.fromCharCode(65 + idx)}`,
    priority: 10 - idx,
    available: true,
  }));

  // 6. Motions (5 rounds)
  const sampleMotions = [
    {
      text: "This House would abolish all patents on life-saving pharmaceuticals.",
      infoSlide: "For the purpose of this debate, life-saving pharmaceuticals include vaccines and critical oncological treatments.",
      ref: "Round 1: Healthcare & IP",
    },
    {
      text: "This House prefers a world with no national borders.",
      infoSlide: "",
      ref: "Round 2: Global Governance",
    },
    {
      text: "This House would ban algorithmic feeds on social media platforms.",
      infoSlide: "Platforms would be limited to strictly chronological feeds.",
      ref: "Round 3: Technology & Society",
    },
    {
      text: "This House regrets the glorification of work ethic in modern capitalist economies.",
      infoSlide: "",
      ref: "Round 4: Labour & Culture",
    },
    {
      text: "This House, as a developing nation, would prioritize environmental protection over rapid industrial growth.",
      infoSlide: "",
      ref: "Round 5: Climate & Development",
    },
  ];

  // 7. Rounds (5 preliminary rounds)
  const rounds: Round[] = Array.from({ length: 5 }, (_, idx) => {
    const seq = idx + 1;
    return {
      id: `round-${tournamentId}-${seq}`,
      tournamentId,
      seq,
      name: `Round ${seq}`,
      abbreviation: `R${seq}`,
      stage: "preliminary",
      drawType: seq === 1 ? "random" : "power_paired",
      drawStatus: seq <= 3 ? "confirmed" : seq === 4 ? "released" : "none",
      feedbackWeight: 1.0,
      silent: seq === 5,
      motionsReleased: seq <= 4,
      resultsReleased: seq <= 3,
      completed: seq <= 3,
      createdAt: now,
    };
  });

  const motions: Motion[] = sampleMotions.map((m, idx) => ({
    id: `motion-${tournamentId}-${idx + 1}`,
    tournamentId,
    text: m.text,
    infoSlide: m.infoSlide,
    reference: m.ref,
    rounds: [`round-${tournamentId}-${idx + 1}`],
    seq: idx + 1,
    released: idx < 4,
  }));

  // 8. Generate Debates and Ballots for Completed Rounds 1, 2, 3
  const allDebates: Debate[] = [];
  const allBallots: BallotSubmission[] = [];
  const teamsMap = new Map<string, Team>();
  teams.forEach((t) => teamsMap.set(t.id, t));

  for (let rSeq = 1; rSeq <= 4; rSeq++) {
    const round = rounds[rSeq - 1];

    // Compute standings up to previous round
    const currentStandings = calculateStandings(tournament, rounds.slice(0, rSeq - 1), teams, allDebates, allBallots).teams;

    const roundDebates = generateRoundDraw({
      tournament,
      round,
      teams,
      venues,
      pastDebates: allDebates,
      standings: currentStandings,
    });

    // Allocate adjudicators
    const pastAdjTeams = new Map<string, Set<string>>();
    const allocations = autoAllocateAdjudicators(roundDebates, teamsMap, adjudicators, pastAdjTeams, {
      panelSize: 1,
      balancePanels: true,
      respectInstitutionConflicts: true,
      respectPersonalConflicts: true,
      respectHistoryConflicts: true,
    });

    roundDebates.forEach((d, dIdx) => {
      const alloc = allocations[dIdx];
      d.adjudicators.chairId = alloc?.chairId;
      d.adjudicators.chairName = alloc?.chairName;
      d.motionId = motions[rSeq - 1]?.id;
      d.motionText = motions[rSeq - 1]?.text;
    });

    // For rounds 1, 2, 3: Create realistic confirmed ballots
    if (rSeq <= 3) {
      roundDebates.forEach((debate) => {
        debate.resultStatus = "confirmed";

        const speakerScores: Record<string, any[]> = {};
        const teamScores: Record<string, any> = {};

        const sides: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];
        const rankPoints = isBP ? [3, 2, 1, 0] : [1, 0];

        // Shuffle ranks to give realistic varied outcomes
        const shuffledSides = [...sides].sort(() => Math.random() - 0.5);

        shuffledSides.forEach((side, rankIdx) => {
          const teamSlot = debate.teams[side];
          const team = teamsMap.get(teamSlot.teamId);
          const pts = rankPoints[rankIdx];

          const spkScores = (team?.speakers || []).map((spk, pos) => {
            // Realistic speaker score base: 74-79 + small noise based on rank
            const base = 74 + (3 - rankIdx) * 1.5;
            const noise = Math.floor(Math.random() * 3) - 1;
            const score = Math.min(84, Math.max(68, base + noise));
            return {
              speakerId: spk.id,
              speakerName: spk.name,
              position: pos + 1,
              score,
            };
          });

          const totalTeamScore = spkScores.reduce((sum, s) => sum + s.score, 0);

          speakerScores[side] = spkScores;
          teamScores[side] = {
            side,
            teamId: teamSlot.teamId,
            points: pts,
            totalSpeakerScore: totalTeamScore,
            rank: rankIdx + 1,
            win: pts === 1 || pts === 3,
            margin: isBP ? 0 : pts === 1 ? 2 : -2,
          };
        });

        const ballot: BallotSubmission = {
          id: `ballot-${debate.id}-v1`,
          tournamentId,
          roundId: round.id,
          debateId: debate.id,
          version: 1,
          confirmed: true,
          discarded: false,
          submitterType: "tabroom",
          submitterName: "Tab Director",
          motionId: debate.motionId,
          motionText: debate.motionText,
          speakerScores: speakerScores as any,
          teamScores: teamScores as any,
          chairId: debate.adjudicators.chairId,
          timestamp: now,
          confirmedBy: "Tab Director",
          confirmedTimestamp: now,
        };

        allBallots.push(ballot);
      });
    }

    allDebates.push(...roundDebates);
  }

  return {
    tournament,
    rounds,
    teams,
    adjudicators,
    institutions: sampleInstitutions,
    venues,
    motions,
    breakCategories,
    debates: allDebates,
    ballots: allBallots,
  };
}
