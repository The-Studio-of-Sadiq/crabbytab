import { describe, expect, it } from "vitest";

import { encodeQrCode, qrCodeSvgPath, QrCodeError, type QrCode } from "./qrcode";

// Golden values below were captured when this encoder's output was decoded successfully by an
// independent decoder (jsQR) for every mask and error correction level, and protect against
// regressions without adding that decoder as a dependency.

const URL = "https://crabbytab.vercel.app/my-open-2026/private/team/abcdefghjkmn";

function fingerprint(code: QrCode): string {
  let hash = 0x811c9dc5;
  for (const row of code.modules) {
    for (const dark of row) {
      hash ^= dark ? 1 : 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16);
}

function readFormat(code: QrCode): { ecl: number; mask: number } {
  let bits = 0;
  const at = (x: number, y: number) => (code.modules[y][x] ? 1 : 0);
  const positions: [number, number][] = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  positions.forEach(([x, y], index) => {
    bits |= at(x, y) << index;
  });
  const data = (bits ^ 0x5412) >>> 10;
  return { ecl: data >>> 3, mask: data & 7 };
}

describe("encodeQrCode", () => {
  it("picks the smallest version that fits", () => {
    expect(encodeQrCode("HELLO WORLD", "M").version).toBe(1);
    expect(encodeQrCode(URL, "M").version).toBe(5);
    expect(encodeQrCode(URL, "H").version).toBe(8);
    expect(encodeQrCode(URL, "M").size).toBe(37);
  });

  it("draws finder patterns, timing patterns and the dark module", () => {
    const code = encodeQrCode(URL, "M");
    const { modules, size } = code;
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      expect(modules[oy][ox]).toBe(true);
      expect(modules[oy + 1][ox + 1]).toBe(false);
      expect(modules[oy + 3][ox + 3]).toBe(true);
    }
    for (let i = 8; i < size - 8; i += 1) expect(modules[6][i]).toBe(i % 2 === 0);
    expect(modules[size - 8][8]).toBe(true);
  });

  it("writes format information matching the level and chosen mask", () => {
    for (const [level, ordinalBits] of [["L", 1], ["M", 0], ["Q", 3], ["H", 2]] as const) {
      const code = encodeQrCode(URL, level);
      expect(readFormat(code)).toEqual({ ecl: ordinalBits, mask: code.mask });
    }
    const forced = encodeQrCode(URL, "M", 5);
    expect(forced.mask).toBe(5);
    expect(readFormat(forced).mask).toBe(5);
  });

  it("is deterministic and stable", () => {
    expect(fingerprint(encodeQrCode(URL, "M"))).toBe(fingerprint(encodeQrCode(URL, "M")));
    expect({
      m: fingerprint(encodeQrCode(URL, "M")),
      h: fingerprint(encodeQrCode(URL, "H")),
      long: fingerprint(encodeQrCode("w".repeat(300), "Q")),
    }).toMatchInlineSnapshot(`
      {
        "h": "252a7d30",
        "long": "73b6fcc2",
        "m": "8fa0e47",
      }
    `);
  });

  it("rejects text that cannot fit and invalid masks", () => {
    expect(() => encodeQrCode("x".repeat(3000), "H")).toThrow(QrCodeError);
    expect(() => encodeQrCode("x", "M", 8)).toThrow(QrCodeError);
  });

  it("renders one square per dark module, offset by the quiet zone", () => {
    const code = encodeQrCode("a", "L");
    const dark = code.modules.flat().filter(Boolean).length;
    const path = qrCodeSvgPath(code);
    expect(path.match(/M/g)).toHaveLength(dark);
    expect(path.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});
