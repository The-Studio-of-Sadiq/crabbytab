/**
 * Kuhn-Munkres (Hungarian) algorithm implementation for optimal weighted bipartite matching.
 * Solves the minimum weight matching problem for an N x M cost matrix in O(n^3) time.
 *
 * The matrix and potentials live in flat Float64Arrays (wave 4 speed work); the arithmetic and
 * the order of every comparison are unchanged, so ties resolve exactly as before.
 */

export function solveHungarian(costMatrix: number[][]): number[] {
  const n = costMatrix.length;
  if (n === 0) return [];
  const m = costMatrix[0].length;
  if (m === 0) return [];

  // Rectangular matrices are padded with 0 to a square of side dim.
  const dim = Math.max(n, m);
  const matrix = new Float64Array(dim * dim);
  for (let r = 0; r < n; r++) {
    const source = costMatrix[r];
    const offset = r * dim;
    for (let c = 0; c < m; c++) matrix[offset + c] = source[c];
  }

  const u = new Float64Array(dim + 1);
  const v = new Float64Array(dim + 1);
  const p = new Int32Array(dim + 1);
  const way = new Int32Array(dim + 1);
  const minv = new Float64Array(dim + 1);
  const used = new Uint8Array(dim + 1);

  for (let i = 1; i <= dim; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(Infinity);
    used.fill(0);

    do {
      used[j0] = 1;
      const i0 = p[j0];
      const rowOffset = (i0 - 1) * dim - 1;
      const ui0 = u[i0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= dim; j++) {
        if (!used[j]) {
          const cur = matrix[rowOffset + j] - ui0 - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }

      for (let j = 0; j <= dim; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= dim; j++) {
    if (p[j] <= n && j <= m) {
      result[p[j] - 1] = j - 1;
    }
  }

  return result;
}
