/**
 * A small QR Code (ISO/IEC 18004, Model 2) encoder for private URL slips, kept local instead of a
 * dependency (AGENTS.md §14): byte mode only, versions 1-40, all four error correction levels,
 * automatic mask selection. Follows the structure of Project Nayuki's reference generator.
 */

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

const ECL_ORDINAL: Record<ErrorCorrectionLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };
const ECL_FORMAT_BITS: Record<ErrorCorrectionLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Indexed by [ecl ordinal][version]; index 0 is unused.
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

export class QrCodeError extends Error {}

export interface QrCode {
  version: number;
  size: number;
  mask: number;
  errorCorrectionLevel: ErrorCorrectionLevel;
  /** modules[y][x]; true is dark. */
  modules: boolean[][];
}

function getBit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(version: number, ecl: ErrorCorrectionLevel): number {
  const ordinal = ECL_ORDINAL[ecl];
  return (
    Math.floor(numRawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ordinal][version] * NUM_ERROR_CORRECTION_BLOCKS[ordinal][version]
  );
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

function addEccAndInterleave(data: number[], version: number, ecl: ErrorCorrectionLevel): number[] {
  const ordinal = ECL_ORDINAL[ecl];
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ordinal][version];
  const blockEccLength = ECC_CODEWORDS_PER_BLOCK[ordinal][version];
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLength = Math.floor(rawCodewords / numBlocks);
  const divisor = reedSolomonDivisor(blockEccLength);
  const blocks: number[][] = [];
  for (let i = 0, offset = 0; i < numBlocks; i += 1) {
    const length = shortBlockLength - blockEccLength + (i < numShortBlocks ? 0 : 1);
    const blockData = data.slice(offset, offset + length);
    offset += length;
    const ecc = reedSolomonRemainder(blockData, divisor);
    if (i < numShortBlocks) blockData.push(0);
    blocks.push(blockData.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i += 1) {
    blocks.forEach((block, j) => {
      // Skip the padding byte in short blocks.
      if (i !== shortBlockLength - blockEccLength || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

function alignmentPatternPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < numAlign; position -= step) result.splice(1, 0, position);
  return result;
}

function applyMask(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

class Matrix {
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  setFunction(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }
}

function drawFunctionPatterns(matrix: Matrix, version: number, ecl: ErrorCorrectionLevel): void {
  const { size } = matrix;
  for (let i = 0; i < size; i += 1) {
    matrix.setFunction(6, i, i % 2 === 0);
    matrix.setFunction(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) matrix.setFunction(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  const positions = alignmentPatternPositions(version, size);
  const last = positions.length - 1;
  positions.forEach((cx, i) => {
    positions.forEach((cy, j) => {
      // The three corners holding finder patterns get no alignment pattern.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          matrix.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });
  drawFormatBits(matrix, ecl, 0);
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let i = 0; i < 18; i += 1) {
      const dark = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      matrix.setFunction(a, b, dark);
      matrix.setFunction(b, a, dark);
    }
  }
}

function drawFormatBits(matrix: Matrix, ecl: ErrorCorrectionLevel, mask: number): void {
  const { size } = matrix;
  const data = (ECL_FORMAT_BITS[ecl] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  for (let i = 0; i <= 5; i += 1) matrix.setFunction(8, i, getBit(bits, i));
  matrix.setFunction(8, 7, getBit(bits, 6));
  matrix.setFunction(8, 8, getBit(bits, 7));
  matrix.setFunction(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i += 1) matrix.setFunction(14 - i, 8, getBit(bits, i));
  for (let i = 0; i < 8; i += 1) matrix.setFunction(size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i += 1) matrix.setFunction(8, size - 15 + i, getBit(bits, i));
  matrix.setFunction(8, size - 8, true);
}

function drawCodewords(matrix: Matrix, codewords: number[]): void {
  const { size } = matrix;
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (!matrix.isFunction[y][x] && bitIndex < codewords.length * 8) {
          matrix.modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
          bitIndex += 1;
        }
      }
    }
  }
}

function toggleMask(matrix: Matrix, mask: number): void {
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (!matrix.isFunction[y][x] && applyMask(mask, x, y)) matrix.modules[y][x] = !matrix.modules[y][x];
    }
  }
}

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

function penaltyScore(matrix: Matrix): number {
  const { size, modules } = matrix;
  let result = 0;

  const addHistory = (length: number, history: number[]) => {
    if (history[0] === 0) length += size;
    history.pop();
    history.unshift(length);
  };
  const countPatterns = (history: number[]) => {
    const n = history[1];
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
  };
  const terminateAndCount = (runColor: boolean, runLength: number, history: number[]) => {
    if (runColor) {
      addHistory(runLength, history);
      runLength = 0;
    }
    addHistory(runLength + size, history);
    return countPatterns(history);
  };
  const scanLine = (get: (i: number) => boolean) => {
    let runColor = false;
    let runLength = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < size; i += 1) {
      if (get(i) === runColor) {
        runLength += 1;
        if (runLength === 5) result += PENALTY_N1;
        else if (runLength > 5) result += 1;
      } else {
        addHistory(runLength, history);
        if (!runColor) result += countPatterns(history) * PENALTY_N3;
        runColor = get(i);
        runLength = 1;
      }
    }
    result += terminateAndCount(runColor, runLength, history) * PENALTY_N3;
  };
  for (let y = 0; y < size; y += 1) scanLine((x) => modules[y][x]);
  for (let x = 0; x < size; x += 1) scanLine((y) => modules[y][x]);

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = modules[y][x];
      if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) {
        result += PENALTY_N2;
      }
    }
  }

  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * PENALTY_N4;
  return result;
}

/**
 * Encodes text (as UTF-8 bytes) into the smallest QR Code that fits at the given level. The mask
 * is chosen by the standard penalty rules unless `forceMask` (0-7) is given.
 */
export function encodeQrCode(
  text: string,
  errorCorrectionLevel: ErrorCorrectionLevel = "M",
  forceMask?: number
): QrCode {
  if (forceMask !== undefined && !(Number.isInteger(forceMask) && forceMask >= 0 && forceMask <= 7)) {
    throw new QrCodeError("The mask must be an integer from 0 to 7.");
  }
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 1;
  for (; version <= 40; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= numDataCodewords(version, errorCorrectionLevel) * 8) break;
  }
  if (version > 40) throw new QrCodeError("The text is too long for a QR code.");

  const capacityBits = numDataCodewords(version, errorCorrectionLevel) * 8;
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, capacityBits - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) append(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));

  const size = version * 4 + 17;
  const matrix = new Matrix(size);
  drawFunctionPatterns(matrix, version, errorCorrectionLevel);
  drawCodewords(matrix, addEccAndInterleave(data, version, errorCorrectionLevel));

  let bestMask = forceMask ?? 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8 && forceMask === undefined; mask += 1) {
    toggleMask(matrix, mask);
    drawFormatBits(matrix, errorCorrectionLevel, mask);
    const penalty = penaltyScore(matrix);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    toggleMask(matrix, mask);
  }
  toggleMask(matrix, bestMask);
  drawFormatBits(matrix, errorCorrectionLevel, bestMask);

  return {
    version,
    size,
    mask: bestMask,
    errorCorrectionLevel,
    modules: matrix.modules.map((row) => [...row]),
  };
}

/**
 * An SVG path ("M x y h1 v1 h-1 z" per dark module, offset by the quiet zone) for rendering the
 * code with a single <path>. Coordinates are in modules; scale with the SVG viewBox.
 */
export function qrCodeSvgPath(code: QrCode, quietZone = 4): string {
  const parts: string[] = [];
  code.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + quietZone} ${y + quietZone}h1v1h-1z`);
    });
  });
  return parts.join("");
}
