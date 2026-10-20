/**
 * Allocation sharding (Tabbycat `templates/allocations/DragAndDropShardingMethods.js` and the
 * drag-and-drop store's `shardedDebatesOrPanels`): split a round's debates into 2-6 shards so
 * several people can allocate in parallel, or one person can focus on part of the draw.
 *
 * - sort: the order debates are ranked in before splitting (highest first). Tabbycat offers
 *   bracket and importance; CrabbyTab adds venue (category, then name), so a shard can be one
 *   building or floor.
 * - mix: "top_to_bottom" puts the top of the ranking in the first shard; "interleaved" deals
 *   debates out in turn, so every shard has a similar spread.
 *
 * A shard is only a view: auto-allocation and the conflict checks still cover the whole round.
 */

export type ShardSort = "bracket" | "importance" | "venue";
export type ShardMix = "top_to_bottom" | "interleaved";

export interface ShardSettings {
  split: number;
  sort: ShardSort;
  mix: ShardMix;
}

export const SHARD_SPLITS = [2, 3, 4, 5, 6] as const;

export function shardLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * Splits items into `split` consecutive shards whose sizes differ by at most one (earlier shards
 * take the extra items). Tabbycat's splitDebates can be lopsided (8 debates in 3 shards gives 1,
 * 1 and 6); CrabbyTab always balances. Fewer items than shards gives one item per shard.
 */
export function splitIntoShards<T>(items: T[], split: number): T[][] {
  const count = Math.min(Math.max(1, Math.floor(split)), items.length);
  const base = Math.floor(items.length / count);
  const extra = items.length % count;
  const shards: T[][] = [];
  let index = 0;
  for (let shard = 0; shard < count; shard++) {
    const size = base + (shard < extra ? 1 : 0);
    shards.push(items.slice(index, (index += size)));
  }
  return shards;
}

/** Tabbycat's sortInterleaved: deal items round-robin into `split` piles, then concatenate them. */
export function interleave<T>(items: T[], split: number): T[] {
  const piles: T[][] = Array.from({ length: Math.max(1, split) }, () => []);
  items.forEach((item, index) => piles[index % piles.length].push(item));
  return piles.flat();
}

export interface ShardableDebate {
  id: string;
  bracket: number;
  importance: number;
  roomRank: number;
  venueName?: string;
  venueCategory?: string;
}

function compareForShards(sort: ShardSort) {
  return (a: ShardableDebate, b: ShardableDebate): number => {
    if (sort === "venue") {
      return (
        (a.venueCategory ?? "").localeCompare(b.venueCategory ?? "") ||
        (a.venueName ?? "").localeCompare(b.venueName ?? "", undefined, { numeric: true }) ||
        a.roomRank - b.roomRank
      );
    }
    const key = sort === "bracket" ? "bracket" : "importance";
    return b[key] - a[key] || a.roomRank - b.roomRank || a.id.localeCompare(b.id);
  };
}

/** Every shard in order, each a list of debate ids. */
export function buildShards(debates: ShardableDebate[], settings: ShardSettings): string[][] {
  const sorted = [...debates].sort(compareForShards(settings.sort));
  const ordered = settings.mix === "interleaved" ? interleave(sorted, settings.split) : sorted;
  return splitIntoShards(ordered, settings.split).map((shard) => shard.map((debate) => debate.id));
}
