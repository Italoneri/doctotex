import {
  attribute,
  child,
  parseXml,
  toArray,
  type XmlNode,
} from "@/lib/docx/xml";
import type { Degradations } from "./report";
import { toInteger, twipsToMm } from "./units";

/**
 * `word/numbering.xml` resolved into what a list needs to be drawn.
 *
 * A paragraph carries a `w:numId`, which names a `w:num`, which names a
 * `w:abstractNum`, which holds the nine levels. Two paragraphs pointing at
 * different `w:numId`s are different lists even when both resolve to the same
 * abstract definition, which is what makes them number independently.
 */

/** The formats LaTeX can count in. Everything else degrades to one of these. */
export type ListFormat =
  | "bullet"
  | "decimal"
  | "lowerLetter"
  | "upperLetter"
  | "lowerRoman"
  | "upperRoman"
  | "none";

/**
 * Word writes its bullets as characters in Symbol or Wingdings, whose
 * codepoints sit in the private use area and mean nothing without the font.
 * Resolving them to a shape here keeps the font out of the LaTeX layer.
 */
export type BulletGlyph =
  "disc" | "circle" | "square" | "dash" | "asterisk" | "arrow" | "diamond";

export interface ListLevel {
  /** 0-based, matching `w:ilvl`. Word allows nine. */
  readonly index: number;
  readonly format: ListFormat;
  /** Word's label pattern, `%1.` or `%1.%2)`. Empty or a glyph for bullets. */
  readonly lvlText: string;
  /** Set only where `format` is `bullet` and the character was recognised. */
  readonly glyph?: BulletGlyph;
  readonly startAt: number;
  readonly indentLeftMm?: number;
  readonly indentHangingMm?: number;
}

export interface ListDefinition {
  readonly numId: string;
  readonly levels: ReadonlyMap<number, ListLevel>;
}

export type Numbering = ReadonlyMap<string, ListDefinition>;

/** Where a paragraph sits in a list, with its level already resolved. */
export interface ListMarker {
  readonly numId: string;
  /** 0-based `w:ilvl`. */
  readonly level: number;
  readonly definition: ListLevel;
  /**
   * Levels 0 to `level - 1`, resolved.
   *
   * A document may open at level 2 with nothing above it, and a label like
   * `%1.%2.` names levels the item itself is not at. Both need the enclosing
   * definitions, and carrying them here keeps the generator from having to hold
   * the whole numbering table.
   */
  readonly ancestors: readonly ListLevel[];
}

export const MAX_LIST_DEPTH = 9;

const DEFAULT_LEVEL: ListLevel = {
  index: 0,
  format: "bullet",
  lvlText: "",
  glyph: "disc",
  startAt: 1,
};

/**
 * `w:numFmt` has some forty values; these are the ones with a LaTeX counter.
 * Anything else is counted in arabic numerals and said so in the report, which
 * is closer to the document than dropping the list would be.
 */
const FORMATS: Readonly<Record<string, ListFormat>> = {
  bullet: "bullet",
  decimal: "decimal",
  lowerLetter: "lowerLetter",
  upperLetter: "upperLetter",
  lowerRoman: "lowerRoman",
  upperRoman: "upperRoman",
  none: "none",
};

/**
 * Bullet characters by codepoint, covering both the private-use codes Word
 * writes for Symbol and Wingdings and the real Unicode a Google Docs export
 * uses for the same shapes.
 */
const GLYPHS: ReadonlyMap<number, BulletGlyph> = new Map([
  [0x2022, "disc"],
  [0x00b7, "disc"],
  [0xf0b7, "disc"],
  [0x25cf, "disc"],
  [0x25cb, "circle"],
  [0x006f, "circle"],
  [0xf06f, "circle"],
  [0x25a0, "square"],
  [0x25aa, "square"],
  [0x25ab, "square"],
  [0xf0a7, "square"],
  [0xf06e, "square"],
  [0x2013, "dash"],
  [0x2012, "dash"],
  [0x2014, "dash"],
  [0x002d, "dash"],
  [0x002a, "asterisk"],
  [0x27a2, "arrow"],
  [0xf0d8, "arrow"],
  [0x2666, "diamond"],
  [0x25c6, "diamond"],
  [0xf075, "diamond"],
]);

export function parseNumbering(
  numberingXml: string | undefined,
  degradations: Degradations,
): Numbering {
  if (!numberingXml) {
    return new Map();
  }

  const root = child(parseXml(numberingXml), "w:numbering");
  const abstracts = readAbstracts(root, degradations);
  const definitions = new Map<string, ListDefinition>();

  for (const num of toArray(root?.["w:num"])) {
    const numId = attribute(num, "w:numId");
    const abstractId = attribute(child(num, "w:abstractNumId"), "w:val");
    if (!numId || abstractId === undefined) {
      continue;
    }

    const levels = abstracts.get(abstractId);
    if (!levels) {
      // A `w:numStyleLink` points at a style rather than at levels, and
      // resolving it needs the stylesheet this parser does not have.
      degradations.note(
        "unresolved-list",
        `List ${numId} points at definition ${abstractId}, which declares no levels this build can read.`,
      );
      continue;
    }

    definitions.set(numId, {
      numId,
      levels: applyOverrides(levels, num, degradations),
    });
  }

  return definitions;
}

function readAbstracts(
  root: XmlNode | undefined,
  degradations: Degradations,
): ReadonlyMap<string, ReadonlyMap<number, ListLevel>> {
  const abstracts = new Map<string, ReadonlyMap<number, ListLevel>>();

  for (const abstract of toArray(root?.["w:abstractNum"])) {
    const id = attribute(abstract, "w:abstractNumId");
    if (id === undefined) {
      continue;
    }
    const levels = readLevels(abstract, degradations);
    if (levels.size > 0) {
      abstracts.set(id, levels);
    }
  }

  return abstracts;
}

function readLevels(
  abstract: XmlNode,
  degradations: Degradations,
): ReadonlyMap<number, ListLevel> {
  const levels = new Map<number, ListLevel>();

  for (const node of toArray(abstract["w:lvl"])) {
    const level = readLevel(node, degradations);
    if (level) {
      levels.set(level.index, level);
    }
  }

  return levels;
}

/**
 * `w:lvlOverride` restarts a level's counter, or replaces the level outright.
 * Word writes the first form whenever a reader clicks "restart numbering", so a
 * definition read without it numbers the second list from where the first
 * stopped.
 */
function applyOverrides(
  levels: ReadonlyMap<number, ListLevel>,
  num: XmlNode,
  degradations: Degradations,
): ReadonlyMap<number, ListLevel> {
  const overrides = toArray(num["w:lvlOverride"]);
  if (overrides.length === 0) {
    return levels;
  }

  const merged = new Map(levels);
  for (const override of overrides) {
    const index = toInteger(attribute(override, "w:ilvl"));
    if (index === undefined) {
      continue;
    }

    const replacement = child(override, "w:lvl");
    if (replacement) {
      const level = readLevel(replacement, degradations);
      if (level) {
        merged.set(index, { ...level, index });
        continue;
      }
    }

    const startAt = toInteger(
      attribute(child(override, "w:startOverride"), "w:val"),
    );
    const existing = merged.get(index);
    if (startAt !== undefined && existing) {
      merged.set(index, { ...existing, startAt });
    }
  }

  return merged;
}

function readLevel(
  node: XmlNode,
  degradations: Degradations,
): ListLevel | undefined {
  const index = toInteger(attribute(node, "w:ilvl"));
  if (index === undefined || index < 0 || index >= MAX_LIST_DEPTH) {
    return undefined;
  }

  const declared = attribute(child(node, "w:numFmt"), "w:val");
  const lvlText = attribute(child(node, "w:lvlText"), "w:val") ?? "";
  const indent = child(child(node, "w:pPr"), "w:ind");

  return {
    index,
    format: readFormat(declared, lvlText, degradations),
    lvlText,
    glyph: readGlyph(declared, lvlText, degradations),
    startAt: toInteger(attribute(child(node, "w:start"), "w:val")) ?? 1,
    indentLeftMm:
      twipsAttributeToMm(indent, "w:start") ??
      twipsAttributeToMm(indent, "w:left"),
    indentHangingMm: twipsAttributeToMm(indent, "w:hanging"),
  };
}

function readFormat(
  declared: string | undefined,
  lvlText: string,
  degradations: Degradations,
): ListFormat {
  if (declared === undefined) {
    return DEFAULT_LEVEL.format;
  }
  const known = FORMATS[declared];
  if (known) {
    return known;
  }

  degradations.note(
    "custom-list-label",
    `Numbering format "${declared}" (${describeLabel(lvlText)}) has no LaTeX counter; the list is numbered in arabic numerals instead.`,
  );
  return "decimal";
}

function readGlyph(
  declared: string | undefined,
  lvlText: string,
  degradations: Degradations,
): BulletGlyph | undefined {
  if (declared !== "bullet") {
    return undefined;
  }

  const codePoint = lvlText.codePointAt(0);
  if (codePoint === undefined) {
    return DEFAULT_LEVEL.glyph;
  }

  const glyph = GLYPHS.get(codePoint);
  if (glyph) {
    return glyph;
  }

  degradations.note(
    "custom-list-label",
    `Bullet character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} belongs to a symbol font this build cannot map; a round bullet stands in for it.`,
  );
  return undefined;
}

/** Private-use characters print as tofu, so they are named rather than shown. */
function describeLabel(lvlText: string): string {
  return lvlText === "" ? "no label" : `label "${lvlText}"`;
}

function twipsAttributeToMm(
  node: XmlNode | undefined,
  name: string,
): number | undefined {
  const twips = toInteger(attribute(node, name));
  return twips === undefined ? undefined : twipsToMm(twips);
}

/**
 * The level a paragraph points at, or `undefined` where the document names a
 * list it never defined — which Word itself treats as an ordinary paragraph.
 */
export function resolveMarker(
  numbering: Numbering,
  numId: string | undefined,
  level: number,
): ListMarker | undefined {
  if (numId === undefined || level < 0 || level >= MAX_LIST_DEPTH) {
    return undefined;
  }

  const definition = numbering.get(numId);
  if (!definition) {
    return undefined;
  }

  const declared = levelAt(definition.levels, level);
  if (!declared) {
    return undefined;
  }

  return {
    numId,
    level,
    definition: declared,
    ancestors: Array.from({ length: level }, (_, index) =>
      levelAt(definition.levels, index),
    ).filter((found): found is ListLevel => found !== undefined),
  };
}

/**
 * A list that defines fewer levels than it uses is common in exports, so the
 * deepest declared level above the one asked for stands in — closer to the
 * document than dropping the item would be.
 */
function levelAt(
  levels: ReadonlyMap<number, ListLevel>,
  level: number,
): ListLevel | undefined {
  const declared = levels.get(level) ?? deepestBelow(levels, level);
  return declared && { ...declared, index: level };
}

function deepestBelow(
  levels: ReadonlyMap<number, ListLevel>,
  level: number,
): ListLevel | undefined {
  let found: ListLevel | undefined;
  for (const [index, candidate] of levels) {
    if (index < level && (!found || index > found.index)) {
      found = candidate;
    }
  }
  return found;
}
