/**
 * Explicit, seedable randomness for draw generation (AGENTS.md §7.2): every
 * random choice a draw makes goes through an `Rng`, so the same inputs and the
 * same seed always produce the same draw.
 */

/** Returns a float in [0, 1), like Math.random. */
export type Rng = () => number;

/** mulberry32: small, fast, and good enough for shuffling teams (not for cryptography). */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh 32-bit seed, used when the caller did not supply one. Record it to reproduce the draw. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/** Uniform integer in [0, n). */
export function randomInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** Uniform Fisher-Yates shuffle (unlike `sort(() => Math.random() - 0.5)`, which is biased). */
export function shuffle<T>(arr: readonly T[], rng: Rng = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
