const CODE39_PATTERNS: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn",
  "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
  "8": "wnnwnnwnn", "9": "nnwwnnwnn", A: "wnnnnwnnw", B: "nnwnnwnnw",
  C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn", F: "nnwnwwnnn",
  G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
  K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww",
  O: "wnnnwnnwn", P: "nnwnwnnwn", Q: "nnnnnnnww", R: "wnnnnnnwn",
  S: "nnwnnnnwn", T: "nnnnwnnwn", U: "wwnnnnnnw", V: "nwwnnnnnw",
  W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn", Z: "nwwnwnnnn",
  "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnw", "$": "nwnwnwnnn",
  "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn", "*": "nwnnwnwnn",
};

export interface BarcodeElement {
  bar: boolean;
  width: number;
}

export function supportsCode39(value: string): boolean {
  return Boolean(value) && /^[0-9A-Z. $/+%-]+$/i.test(value);
}

export function encodeCode39(value: string): BarcodeElement[] {
  const normalized = value.toUpperCase();
  if (!supportsCode39(value)) {
    throw new Error("Barcode IDs must contain only Code 39 characters (letters, numbers, space, and . $ / + % -).");
  }

  const encoded = `*${normalized}*`;
  const elements: BarcodeElement[] = [];
  for (let characterIndex = 0; characterIndex < encoded.length; characterIndex++) {
    const pattern = CODE39_PATTERNS[encoded[characterIndex]];
    if (!pattern) throw new Error(`Unsupported Code 39 character: ${encoded[characterIndex]}`);
    for (let elementIndex = 0; elementIndex < pattern.length; elementIndex++) {
      elements.push({
        bar: elementIndex % 2 === 0,
        width: pattern[elementIndex] === "w" ? 3 : 1,
      });
    }
    if (characterIndex < encoded.length - 1) elements.push({ bar: false, width: 1 });
  }
  return elements;
}
