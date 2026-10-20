/**
 * Kuhn-Munkres (Hungarian) algorithm implementation for optimal weighted bipartite matching.
 * Solves the minimum weight matching problem for an N x M cost matrix in O(n^3) time.
 *
 * Speed (wave 4), without changing any result: the matrix and potentials live in flat typed
 * arrays; unused columns are kept in an ascending linked list so each step visits only them, in
 * the same order as a full scan; and the `minv[j] -= delta` update of unused columns is deferred
 * to the start of the next step's scan (the same subtraction on the same value before it is read;
 * it is skipped only when the row's search ends, after which `minv` is reset anyway). Every
 * floating-point operation that affects the result happens in the same order, so ties resolve
 * exactly as before.
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
  // Unused columns 1..dim as a doubly linked list from the sentinel 0, in ascending order.
  const next = new Int32Array(dim + 2);
  const prev = new Int32Array(dim + 2);
  // Columns used in the current row's search, including the start column 0.
  const usedColumns = new Int32Array(dim + 1);

  for (let i = 1; i <= dim; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(Infinity);
    for (let j = 0; j <= dim; j++) {
      next[j] = j + 1;
      prev[j + 1] = j;
    }
    next[dim] = -1;
    let usedCount = 0;
    let pending = 0;
    let hasPending = false;

    do {
      // Mark j0 used: record it and unlink it from the unused list.
      usedColumns[usedCount++] = j0;
      if (j0 !== 0) {
        const before = prev[j0];
        const after = next[j0];
        next[before] = after;
        if (after !== -1) prev[after] = before;
      }
      const i0 = p[j0];
      const rowOffset = (i0 - 1) * dim - 1;
      const ui0 = u[i0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = next[0]; j !== -1; j = next[j]) {
        if (hasPending) minv[j] -= pending;
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

      for (let k = 0; k < usedCount; k++) {
        const j = usedColumns[k];
        u[p[j]] += delta;
        v[j] -= delta;
      }
      pending = delta;
      hasPending = true;

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
