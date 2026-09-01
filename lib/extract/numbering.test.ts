import { describe, expect, it } from "vitest";
import {
  parseNumbering,
  resolveMarker,
  type ListFormat,
  type Numbering,
} from "./numbering";
import { collectDegradations, type Degradations } from "./report";

function numberingXml(inner: string): string {
  return `<?xml version="1.0"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${inner}</w:numbering>`;
}

function level(index: number, inner: string): string {
  return `<w:lvl w:ilvl="${index}">${inner}</w:lvl>`;
}

function abstract(id: string, levels: string): string {
  return `<w:abstractNum w:abstractNumId="${id}">${levels}</w:abstractNum>`;
}

function num(numId: string, abstractId: string, overrides = ""): string {
  return `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractId}"/>${overrides}</w:num>`;
}

function parse(
  inner: string,
  degradations: Degradations = collectDegradations(),
): Numbering {
  return parseNumbering(numberingXml(inner), degradations);
}

/** One decimal level under numId 1, which most cases only need as scaffolding. */
function simple(inner: string): Numbering {
  return parse(abstract("0", level(0, inner)) + num("1", "0"));
}

describe("parseNumbering", () => {
  it("resolves a numId through its abstract definition", () => {
    const numbering = simple(
      `<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>`,
    );

    expect(resolveMarker(numbering, "1", 0)?.definition).toMatchObject({
      format: "decimal",
      lvlText: "%1.",
      startAt: 1,
    });
  });

  const formats: readonly (readonly [string, ListFormat])[] = [
    ["decimal", "decimal"],
    ["bullet", "bullet"],
    ["lowerLetter", "lowerLetter"],
    ["upperLetter", "upperLetter"],
    ["lowerRoman", "lowerRoman"],
    ["upperRoman", "upperRoman"],
    ["none", "none"],
  ];

  it.each(formats)("reads w:numFmt %s", (declared, expected) => {
    const numbering = simple(`<w:numFmt w:val="${declared}"/>`);

    expect(resolveMarker(numbering, "1", 0)?.definition.format).toBe(expected);
  });

  it("counts a format with no LaTeX equivalent in arabic and says so", () => {
    const degradations = collectDegradations();
    const numbering = parse(
      abstract("0", level(0, `<w:numFmt w:val="cardinalText"/>`)) +
        num("1", "0"),
      degradations,
    );

    expect(resolveMarker(numbering, "1", 0)?.definition.format).toBe("decimal");
    expect(degradations.report().degradations[0]).toMatchObject({
      code: "custom-list-label",
    });
  });

  it("reads the start value", () => {
    const numbering = simple(`<w:start w:val="5"/><w:numFmt w:val="decimal"/>`);

    expect(resolveMarker(numbering, "1", 0)?.definition.startAt).toBe(5);
  });

  it("converts the level indents from twips to millimetres", () => {
    const numbering = simple(
      `<w:numFmt w:val="decimal"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr>`,
    );

    expect(resolveMarker(numbering, "1", 0)?.definition).toMatchObject({
      indentLeftMm: 25.4,
      indentHangingMm: 6.35,
    });
  });

  it("lets w:startOverride restart a list that shares a definition", () => {
    const numbering = parse(
      abstract(
        "0",
        level(0, `<w:start w:val="1"/><w:numFmt w:val="decimal"/>`),
      ) +
        num("1", "0") +
        num(
          "2",
          "0",
          `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride>`,
        ),
    );

    expect(resolveMarker(numbering, "1", 0)?.definition.startAt).toBe(1);
    expect(resolveMarker(numbering, "2", 0)?.definition.startAt).toBe(7);
  });

  it("lets w:lvlOverride replace a level outright", () => {
    const numbering = parse(
      abstract("0", level(0, `<w:numFmt w:val="decimal"/>`)) +
        num(
          "2",
          "0",
          `<w:lvlOverride w:ilvl="0">${level(0, `<w:numFmt w:val="upperRoman"/>`)}</w:lvlOverride>`,
        ),
    );

    expect(resolveMarker(numbering, "2", 0)?.definition.format).toBe(
      "upperRoman",
    );
  });

  it("reports a numId whose definition declares no levels", () => {
    const degradations = collectDegradations();
    const numbering = parse(num("1", "99"), degradations);

    expect(numbering.size).toBe(0);
    expect(degradations.report().degradations[0]).toMatchObject({
      code: "unresolved-list",
    });
  });

  it("reads nothing from a document with no numbering part", () => {
    expect(parseNumbering(undefined, collectDegradations()).size).toBe(0);
  });
});

describe("bullet glyphs", () => {
  const glyphs: readonly (readonly [string, string, string])[] = [
    ["Symbol's disc", "", "disc"],
    ["Symbol's square", "", "square"],
    ["Word's hollow o", "o", "circle"],
    ["a real bullet", "•", "disc"],
    ["an en dash", "–", "dash"],
  ];

  it.each(glyphs)("recognises %s", (_name, character, expected) => {
    const numbering = parse(
      abstract(
        "0",
        level(0, `<w:numFmt w:val="bullet"/><w:lvlText w:val="${character}"/>`),
      ) + num("1", "0"),
    );

    expect(resolveMarker(numbering, "1", 0)?.definition.glyph).toBe(expected);
  });

  it("reports a glyph it cannot map rather than guessing at it", () => {
    const degradations = collectDegradations();
    const numbering = parse(
      abstract(
        "0",
        level(0, `<w:numFmt w:val="bullet"/><w:lvlText w:val=""/>`),
      ) + num("1", "0"),
      degradations,
    );

    expect(resolveMarker(numbering, "1", 0)?.definition.glyph).toBeUndefined();
    expect(degradations.report().degradations[0]).toMatchObject({
      code: "custom-list-label",
      detail: expect.stringContaining("U+F0FC"),
    });
  });
});

describe("resolveMarker", () => {
  const threeLevels = () =>
    parse(
      abstract(
        "0",
        level(0, `<w:numFmt w:val="decimal"/>`) +
          level(1, `<w:numFmt w:val="lowerLetter"/>`) +
          level(2, `<w:numFmt w:val="lowerRoman"/>`),
      ) + num("1", "0"),
    );

  it("carries the enclosing levels so a label can name them", () => {
    const marker = resolveMarker(threeLevels(), "1", 2);

    expect(marker?.ancestors.map((level) => level.format)).toEqual([
      "decimal",
      "lowerLetter",
    ]);
  });

  it("falls back to the deepest declared level where one is missing", () => {
    const numbering = parse(
      abstract("0", level(0, `<w:numFmt w:val="upperRoman"/>`)) + num("1", "0"),
    );

    expect(resolveMarker(numbering, "1", 3)?.definition).toMatchObject({
      format: "upperRoman",
      index: 3,
    });
  });

  it("reports nothing for a numId the document never defined", () => {
    expect(resolveMarker(threeLevels(), "9", 0)).toBeUndefined();
  });

  it("refuses a level outside the nine Word allows", () => {
    expect(resolveMarker(threeLevels(), "1", 9)).toBeUndefined();
    expect(resolveMarker(threeLevels(), "1", -1)).toBeUndefined();
  });
});
