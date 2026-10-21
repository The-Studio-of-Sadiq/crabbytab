import type { Adjudicator, AuditCategory, Team } from "@/types";
import { generatePrivateKey } from "@/lib/privateUrls";

type PrivateAccessItem = {
  id: string;
  privateUrlKey?: string;
  privatePasscode?: string;
};

export function regeneratePrivateAccess<T extends PrivateAccessItem>(
  items: T[],
  forceRegenerate = false,
  prefix: "team" | "adj"
): { items: T[]; changed: boolean; updatedIds: string[] } {
  const updatedIds: string[] = [];
  const updatedItems = items.map((item) => {
    const needsRefresh = forceRegenerate || !item.privateUrlKey || !item.privatePasscode;
    if (!needsRefresh) {
      return item;
    }

    updatedIds.push(item.id);
    return {
      ...item,
      privateUrlKey: forceRegenerate || !item.privateUrlKey ? generatePrivateKey(prefix) : item.privateUrlKey,
      privatePasscode: generatePrivateKey(),
    } as T;
  });

  return {
    items: updatedItems,
    changed: updatedIds.length > 0,
    updatedIds,
  };
}

export async function regeneratePrivateAccessCommand(
  teams: Team[],
  adjudicators: Adjudicator[],
  forceRegenerate: boolean,
  dependencies: {
    localRepository: {
      saveTeams(teams: Team[]): void;
      saveAdjudicators(adjudicators: Adjudicator[]): void;
    };
    cloudRepository?: {
      savePrivateAccessChanges(changes: {
        teams?: Team[];
        adjudicators?: Adjudicator[];
      }): Promise<void>;
    };
    recordAuditEvent(event: {
      action: string;
      category: AuditCategory;
      summary: string;
      details?: Record<string, unknown>;
    }): Promise<void>;
  }
): Promise<void> {
  const teamsResult = regeneratePrivateAccess(teams, forceRegenerate, "team");
  const adjudicatorsResult = regeneratePrivateAccess(adjudicators, forceRegenerate, "adj");

  if (teamsResult.changed) dependencies.localRepository.saveTeams(teamsResult.items);
  if (adjudicatorsResult.changed) {
    dependencies.localRepository.saveAdjudicators(adjudicatorsResult.items);
  }
  if (dependencies.cloudRepository && (teamsResult.changed || adjudicatorsResult.changed)) {
    await dependencies.cloudRepository.savePrivateAccessChanges({
      teams: teamsResult.changed ? teamsResult.items : undefined,
      adjudicators: adjudicatorsResult.changed ? adjudicatorsResult.items : undefined,
    });
  }
  if (teamsResult.changed || adjudicatorsResult.changed) {
    await dependencies.recordAuditEvent({
      action: "private_urls.regenerated",
      category: "tournament",
      summary: "Private access credentials generated",
      details: {
        forceRegenerate,
        teamsUpdated: teamsResult.updatedIds.length,
        adjudicatorsUpdated: adjudicatorsResult.updatedIds.length,
      },
    });
  }
}
