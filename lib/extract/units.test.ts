import { describe, expect, it } from "vitest";
import {
  halfPointsToPt,
  lineToMultiplier,
  toColorHex,
  toInteger,
  toToggle,
  twipsToMm,
  twipsToPt,
} from "./units";

describe("twipsToMm", () => {
  // The A4 page and margins below are the real values inside exemplo.docx.
  const cases: ReadonlyArray<[twips: number, mm: number, note: string]> = [
    [0, 0, "zero"],
    [1440, 25.4, "one inch"],
    [11906, 210.01, "A4 width"],
    [16838, 297, "A4 height"],
    [1701, 30, "30mm top margin"],
    [1418, 25.01, "25mm side margin"],
    [567, 10, "10mm header offset"],
    [709, 12.51, "12.5mm footer offset"],
  ];

  for (const [twips, mm, note] of cases) {
    it(`converts ${twips} twips to ${mm}mm (${note})`, () => {
      expect(twipsToMm(twips)).toBe(mm);
    });
  }
});

describe("twipsToPt", () => {
  const cases: ReadonlyArray<[twips: number, pt: number]> = [
    [0, 0],
    [20, 1],
    [240, 12],
    [1440, 72],
  ];

  for (const [twips, pt] of cases) {
    it(`converts ${twips} twips to ${pt}pt`, () => {
      expect(twipsToPt(twips)).toBe(pt);
    });
  }
});

describe("halfPointsToPt", () => {
  const cases: ReadonlyArray<[halfPoints: number, pt: number]> = [
    [20, 10],
    [22, 11],
    [24, 12],
    [28, 14],
    [21, 10.5],
  ];

  for (const [halfPoints, pt] of cases) {
    it(`converts ${halfPoints} half-points to ${pt}pt`, () => {
      expect(halfPointsToPt(halfPoints)).toBe(pt);
    });
  }
});

describe("lineToMultiplier", () => {
  const cases: ReadonlyArray<[line: number, multiplier: number, note: string]> =
    [
      [240, 1, "single"],
      [360, 1.5, "one and a half"],
      [480, 2, "double"],
      [276, 1.15, "Word's default body spacing"],
    ];

  for (const [line, multiplier, note] of cases) {
    it(`reads ${line} as ${multiplier}x (${note})`, () => {
      expect(lineToMultiplier(line)).toBe(multiplier);
    });
  }
});

describe("toInteger", () => {
  const cases: ReadonlyArray<[input: unknown, expected: number | undefined]> = [
    ["1440", 1440],
    ["-120", -120],
    [1440, 1440],
    // Zero must survive: an explicit 0 overrides an inherited value.
    ["0", 0],
    [0, 0],
    [undefined, undefined],
    [null, undefined],
    ["", undefined],
    ["   ", undefined],
    ["auto", undefined],
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
  ];

  for (const [input, expected] of cases) {
    it(`reads ${JSON.stringify(input)} as ${expected}`, () => {
      expect(toInteger(input)).toBe(expected);
    });
  }
});

describe("toToggle", () => {
  const cases: ReadonlyArray<[input: unknown, expected: boolean]> = [
    // A bare <w:b/> carries no w:val and means the toggle is on.
    [undefined, true],
    [null, true],
    ["1", true],
    ["true", true],
    ["on", true],
    ["0", false],
    ["false", false],
    ["off", false],
    ["OFF", false],
  ];

  for (const [input, expected] of cases) {
    it(`reads ${JSON.stringify(input)} as ${expected}`, () => {
      expect(toToggle(input)).toBe(expected);
    });
  }
});

describe("toColorHex", () => {
  const cases: ReadonlyArray<[input: unknown, expected: string | undefined]> = [
    ["FF0000", "#FF0000"],
    ["ff0000", "#FF0000"],
    ["#1A2B3C", "#1A2B3C"],
    // "auto" is an instruction, not a colour; it must inherit rather than
    // collapse to black.
    ["auto", undefined],
    ["", undefined],
    ["12345", undefined],
    ["1234567", undefined],
    ["GGGGGG", undefined],
    [undefined, undefined],
    [16711680, undefined],
  ];

  for (const [input, expected] of cases) {
    it(`reads ${JSON.stringify(input)} as ${expected}`, () => {
      expect(toColorHex(input)).toBe(expected);
    });
  }
});
