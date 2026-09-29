import { Adjudicator, Debate, Team, Venue } from "@/types";
import { solveHungarian } from "./hungarian";

export interface AllocationOptions {
  panelSize: number; // e.g., 1 (solo chair), 3 (chair + 2 panellists), or 5
  balancePanels: boolean;
  respectInstitutionConflicts: boolean;
  respectPersonalConflicts: boolean;
  respectHistoryConflicts: boolean;
}

export interface AdjudicatorAllocationResult {
  debateId: string;
  chairId?: string;
  chairName?: string;
  panellistIds: string[];
  panellistNames: string[];
  traineeIds: string[];
  traineeNames: string[];
  conflicts: string[];
}

export interface AdjDebateConflictResult {
  penalty: number;
  reasons: string[];
  hasClash: boolean;
  hasInstitutionalClash: boolean;
  hasPersonalClash: boolean;
  hasHistoryClash: boolean;
}

/**
 * Calculates conflict penalty between an adjudicator and a debate's teams/institutions.
 */
export function calculateAdjDebateConflict(
  adj: Adjudicator,
  debateTeams: Team[],
  pastAdjudicatorTeams: Map<string, Set<string>> = new Map() // adjId -> Set of teamIds
): AdjDebateConflictResult {
  let penalty = 0;
  const reasons: string[] = [];
  let hasInstitutionalClash = false;
  let hasPersonalClash = false;
  let hasHistoryClash = false;

  for (const team of debateTeams) {
    if (!team) continue;

    // 1. Direct Institutional Conflict (unless judge is explicitly marked independent with no institution)
    if (!adj.independent) {
      if (adj.institutionId && team.institutionId && adj.institutionId === team.institutionId) {
        penalty += 10000;
        hasInstitutionalClash = true;
        reasons.push(`Institutional clash with ${team.name} (${team.institutionName || "Same Institution"})`);
      } else if (
        adj.institutionName &&
        team.institutionName &&
        adj.institutionName.trim().toLowerCase() === team.institutionName.trim().toLowerCase()
      ) {
        penalty += 10000;
        hasInstitutionalClash = true;
        reasons.push(`Institutional clash with ${team.name} (${team.institutionName})`);
      }
    }

    // 2. Declared conflicts (personal, institutional, etc.)
    if (adj.conflicts && adj.conflicts.length > 0) {
      for (const conflict of adj.conflicts) {
        if (conflict.teamId && conflict.teamId === team.id) {
          penalty += 10000;
          hasPersonalClash = true;
          reasons.push(`Personal clash with team "${team.name}"`);
        }
        if (
          conflict.institutionId &&
          ((team.institutionId && conflict.institutionId === team.institutionId) ||
            (team.institutionName && conflict.institutionId.toLowerCase() === team.institutionName.toLowerCase()))
        ) {
          penalty += 8000;
          hasInstitutionalClash = true;
          reasons.push(`Declared institutional clash with ${team.name}`);
        }
      }
    }

    // 3. Past debate history clash (adjudicated this team in earlier rounds)
    const judgedTeams = pastAdjudicatorTeams.get(adj.id);
    if (judgedTeams && judgedTeams.has(team.id)) {
      penalty += 500;
      hasHistoryClash = true;
      reasons.push(`Previously judged ${team.name}`);
    }
  }

  return {
    penalty,
    reasons,
    hasClash: reasons.length > 0,
    hasInstitutionalClash,
    hasPersonalClash,
    hasHistoryClash,
  };
}

/**
 * Automatically allocates available adjudicators to debates using Hungarian matching.
 */
export function autoAllocateAdjudicators(
  debates: Debate[],
  teamsMap: Map<string, Team>,
  adjudicators: Adjudicator[],
  pastAdjudicatorTeams: Map<string, Set<string>>,
  options: AllocationOptions = {
    panelSize: 3,
    balancePanels: true,
    respectInstitutionConflicts: true,
    respectPersonalConflicts: true,
    respectHistoryConflicts: true,
  }
): AdjudicatorAllocationResult[] {
  const availableAdjs = adjudicators.filter((a) => a.checkedIn !== false);
  const numDebates = debates.length;

  if (numDebates === 0 || availableAdjs.length === 0) {
    return debates.map((d) => ({
      debateId: d.id,
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
      conflicts: [],
    }));
  }

  // Sort debates by importance / bracket (highest bracket gets top chairs)
  const sortedDebateIndices = Array.from({ length: numDebates }, (_, i) => i).sort((a, b) => {
    return (debates[b].bracket || 0) - (debates[a].bracket || 0);
  });

  // Separate chairs vs trainees
  const nonTrainees = availableAdjs.filter((a) => !a.trainee);
  const trainees = availableAdjs.filter((a) => a.trainee);

  // Step 1: Assign Chairs via Hungarian matching
  // Construct cost matrix: Debates (rows) x Adjudicators (cols)
  const chairCostMatrix: number[][] = [];

  for (let r = 0; r < numDebates; r++) {
    const debate = debates[sortedDebateIndices[r]];
    const debateTeams: Team[] = Object.values(debate.teams)
      .map((t) => teamsMap.get(t.teamId))
      .filter((t): t is Team => t !== undefined);

    const row: number[] = [];
    for (let c = 0; c < nonTrainees.length; c++) {
      const adj = nonTrainees[c];
      const { penalty } = calculateAdjDebateConflict(adj, debateTeams, pastAdjudicatorTeams);

      // We want higher-rated judges for higher-bracket rooms
      // Score difference penalty:
      const targetScore = Math.max(1, 10 - r * (10 / Math.max(1, numDebates)));
      const scoreDiff = Math.abs((adj.baseScore || 5) - targetScore) * 10;

      row.push(penalty + scoreDiff);
    }
    chairCostMatrix.push(row);
  }

  const chairMatching = solveHungarian(chairCostMatrix);

  const resultsMap = new Map<string, AdjudicatorAllocationResult>();
  const usedAdjIds = new Set<string>();

  for (let r = 0; r < numDebates; r++) {
    const debate = debates[sortedDebateIndices[r]];
    const adjCol = chairMatching[r];
    const debateTeams: Team[] = Object.values(debate.teams)
      .map((t) => teamsMap.get(t.teamId))
      .filter((t): t is Team => t !== undefined);

    let chairId: string | undefined;
    let chairName: string | undefined;
    const conflicts: string[] = [];

    if (adjCol !== undefined && adjCol >= 0 && adjCol < nonTrainees.length) {
      const chair = nonTrainees[adjCol];
      chairId = chair.id;
      chairName = chair.name;
      usedAdjIds.add(chair.id);

      const { reasons } = calculateAdjDebateConflict(chair, debateTeams, pastAdjudicatorTeams);
      conflicts.push(...reasons);
    }

    resultsMap.set(debate.id, {
      debateId: debate.id,
      chairId,
      chairName,
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
      conflicts,
    });
  }

  // Step 2: Assign Panellists if panelSize > 1
  const remainingNonTrainees = nonTrainees.filter((a) => !usedAdjIds.has(a.id));
  const panellistsNeededPerDebate = Math.max(0, options.panelSize - 1);

  if (panellistsNeededPerDebate > 0 && remainingNonTrainees.length > 0) {
    let currentAdjIdx = 0;
    for (let slot = 0; slot < panellistsNeededPerDebate; slot++) {
      for (let r = 0; r < numDebates; r++) {
        if (currentAdjIdx >= remainingNonTrainees.length) break;
        const debate = debates[sortedDebateIndices[r]];
        const res = resultsMap.get(debate.id)!;
        const panellist = remainingNonTrainees[currentAdjIdx++];

        res.panellistIds.push(panellist.id);
        res.panellistNames.push(panellist.name);
        usedAdjIds.add(panellist.id);

        const debateTeams: Team[] = Object.values(debate.teams)
          .map((t) => teamsMap.get(t.teamId))
          .filter((t): t is Team => t !== undefined);
        const { reasons } = calculateAdjDebateConflict(panellist, debateTeams, pastAdjudicatorTeams);
        res.conflicts.push(...reasons);
      }
    }
  }

  // Step 3: Distribute trainees evenly across debates
  let traineeIdx = 0;
  while (traineeIdx < trainees.length) {
    for (let r = 0; r < numDebates; r++) {
      if (traineeIdx >= trainees.length) break;
      const debate = debates[sortedDebateIndices[r]];
      const res = resultsMap.get(debate.id)!;
      const trainee = trainees[traineeIdx++];

      res.traineeIds.push(trainee.id);
      res.traineeNames.push(trainee.name);
    }
  }

  return debates.map((d) => resultsMap.get(d.id)!);
}
