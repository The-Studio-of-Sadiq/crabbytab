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
