import {
  attribute,
  child,
  descend,
  parseXml,
  toArray,
  value,
  type XmlNode,
} from "@/lib/docx/xml";
import { resolveThemeFont } from "./theme";
import {
  halfPointsToPt,
  lineToMultiplier,
  toColorHex,
  toInteger,
  toToggle,
  twipsToMm,
  twipsToPt,
} from "./units";
import type {
  Alignment,
  EffectiveStyle,
  HeadingStyle,
  LineSpacing,
  NamedStyle,
  ParagraphStyle,
  TextStyle,
  ThemeFonts,
  VerticalAlign,
} from "./types";

/**
 * Style IDs are localised — a French document calls heading 1 "Titre1" — but
 * `w:name` always carries the canonical English name. Matching on the ID finds
 * nothing outside English documents.
 */
const HEADING_NAME = /^heading\s+(\d+)$/i;

const TITLE_NAME = "title";

const EMPTY_STYLE: EffectiveStyle = { text: {}, paragraph: {} };

/** `w:u` is a value, not a toggle: every other value is a kind of underline. */
const NO_UNDERLINE = "none";

const VERTICAL_ALIGNS: Readonly<Record<string, VerticalAlign>> = {
  baseline: "baseline",
  superscript: "superscript",
  subscript: "subscript",
};

export interface StyleDefinition {
  readonly styleId: string;
  /** Canonical name, lowercased: "heading 1", "title", "body text indent". */
  readonly name: string;
  readonly basedOn?: string;
  readonly style: EffectiveStyle;
}

export interface StyleSheet {
  readonly docDefaults: EffectiveStyle;
  readonly definitions: ReadonlyMap<string, StyleDefinition>;
  /**
   * Carried here because direct formatting can name a theme font too, and the
   * body walker would otherwise need the theme threaded alongside the sheet
   * everywhere the sheet already goes.
   */
  readonly theme: ThemeFonts;
}

export function parseStyleSheet(
  stylesXml: string | undefined,
  theme: ThemeFonts,
): StyleSheet {
  if (!stylesXml) {
    return { docDefaults: EMPTY_STYLE, definitions: new Map(), theme };
  }

  const root = child(parseXml(stylesXml), "w:styles");
  const defaults = child(root, "w:docDefaults");

  const definitions = new Map<string, StyleDefinition>();
  for (const node of toArray(root?.["w:style"])) {
    const definition = readDefinition(node, theme);
    if (definition) {
      definitions.set(definition.styleId, definition);
    }
  }

  return {
    docDefaults: {
      text: readTextStyle(descend(defaults, "w:rPrDefault", "w:rPr"), theme),
      paragraph: readParagraphStyle(descend(defaults, "w:pPrDefault", "w:pPr")),
    },
    definitions,
    theme,
  };
}

/**
 * Word resolves formatting as docDefaults, then the `w:basedOn` chain from its
 * root downwards, then the style itself. Reading a style in isolation reports
 * only what it overrides, which is rarely what the document looks like.
 */
export function resolveStyle(
  sheet: StyleSheet,
  styleId: string | undefined,
): EffectiveStyle {
  return chainFor(sheet, styleId).reduce(mergeStyles, sheet.docDefaults);
}

/**
 * The paragraph's own `w:pPr` is the last level of the cascade, and the one
 * Word writes most: a document can carry a full stylesheet and still apply
 * every visible heading by hand, in which case the style chain says nothing
 * about how the page looks.
 */
export function resolveParagraph(
  sheet: StyleSheet,
  styleId: string | undefined,
  direct: EffectiveStyle,
): EffectiveStyle {
  return mergeStyles(resolveStyle(sheet, styleId), direct);
}

/**
 * A run resolves against the paragraph it sits in, then its own character
 * style, then its own `w:rPr`. Starting from the paragraph rather than from
 * docDefaults is what makes `<w:b w:val="0"/>` inside a bold style un-bold
 * rather than read as an absent property.
 */
export function resolveRun(
  sheet: StyleSheet,
  paragraph: EffectiveStyle,
  runStyleId: string | undefined,
  direct: TextStyle,
): TextStyle {
  const character = chainFor(sheet, runStyleId).reduce(
    mergeStyles,
    EMPTY_STYLE,
  );

  return {
    ...paragraph.text,
    ...defined(character.text),
    ...defined(direct),
  };
}

/** Root-first list of styles to apply, with `basedOn` cycles broken. */
function chainFor(
  sheet: StyleSheet,
  styleId: string | undefined,
): readonly EffectiveStyle[] {
  const chain: EffectiveStyle[] = [];
  const seen = new Set<string>();

  let current = styleId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const definition = sheet.definitions.get(current);
    if (!definition) {
      break;
    }
    chain.unshift(definition.style);
    current = definition.basedOn;
  }

  return chain;
}

/**
 * Levels are whatever the document declares. exemplo.docx defines 1, 3 and 4
 * with no 2, so callers get a sparse ascending list rather than a dense range.
 */
export function findHeadingStyles(sheet: StyleSheet): readonly HeadingStyle[] {
  const headings: HeadingStyle[] = [];

  for (const definition of sheet.definitions.values()) {
    const level = toInteger(HEADING_NAME.exec(definition.name)?.[1]);
    if (level === undefined) {
      continue;
    }
    const { text, paragraph } = resolveStyle(sheet, definition.styleId);
    headings.push({ level, styleId: definition.styleId, text, paragraph });
  }

  return headings.sort((a, b) => a.level - b.level);
}

/** Word's "Title" is a document title, not an outline level. */
export function findTitleStyle(sheet: StyleSheet): NamedStyle | undefined {
  for (const definition of sheet.definitions.values()) {
    if (definition.name === TITLE_NAME) {
      const { text, paragraph } = resolveStyle(sheet, definition.styleId);
      return { styleId: definition.styleId, text, paragraph };
    }
  }
  return undefined;
}

function readDefinition(
  node: XmlNode,
  theme: ThemeFonts,
): StyleDefinition | undefined {
  const styleId = attribute(node, "w:styleId");
  if (!styleId) {
    return undefined;
  }

  return {
    styleId,
    name: (attribute(child(node, "w:name"), "w:val") ?? "").toLowerCase(),
    basedOn: attribute(child(node, "w:basedOn"), "w:val"),
    style: {
      text: readTextStyle(child(node, "w:rPr"), theme),
      paragraph: readParagraphStyle(child(node, "w:pPr")),
    },
  };
}

/**
 * One `w:rPr`, whether it belongs to a style or to a run in the body. Direct
 * formatting is the last level of the same cascade, so it is read by the same
 * function rather than by a parallel one that could disagree with it.
 */
export function readTextStyle(
  rPr: XmlNode | undefined,
  theme: ThemeFonts,
): TextStyle {
  const fonts = child(rPr, "w:rFonts");
  const halfPoints = toInteger(attribute(child(rPr, "w:sz"), "w:val"));

  return {
    // w:ascii covers the Latin range and w:hAnsi everything above it. Word
    // writes both; Google Docs exports often write only w:hAnsi, and reading
    // w:ascii alone reports those documents as having no font at all.
    fontFamily:
      attribute(fonts, "w:ascii") ??
      attribute(fonts, "w:hAnsi") ??
      resolveThemeFont(theme, attribute(fonts, "w:asciiTheme")) ??
      resolveThemeFont(theme, attribute(fonts, "w:hAnsiTheme")),
    fontSizePt:
      halfPoints === undefined ? undefined : halfPointsToPt(halfPoints),
    bold: readToggle(rPr, "w:b"),
    italic: readToggle(rPr, "w:i"),
    underline: readUnderline(rPr),
    // A single and a double strike differ only in how they are drawn, and
    // LaTeX draws one line either way.
    strike: readToggle(rPr, "w:strike") ?? readToggle(rPr, "w:dstrike"),
    allCaps: readToggle(rPr, "w:caps"),
    smallCaps: readToggle(rPr, "w:smallCaps"),
    script: readVerticalAlign(rPr),
    colorHex: toColorHex(attribute(child(rPr, "w:color"), "w:val")),
  };
}

/**
 * Unlike `w:b`, `w:u` carries which underline to draw. Anything but `none` is
 * one, so an unknown kind still underlines rather than silently vanishing.
 */
function readUnderline(rPr: XmlNode | undefined): boolean | undefined {
  const { present, val } = value(rPr, "w:u");
  if (!present) {
    return undefined;
  }
  return (val ?? "").toLowerCase() !== NO_UNDERLINE;
}

function readVerticalAlign(
  rPr: XmlNode | undefined,
): VerticalAlign | undefined {
  const raw = attribute(child(rPr, "w:vertAlign"), "w:val");
  return raw === undefined ? undefined : VERTICAL_ALIGNS[raw.toLowerCase()];
}

/** One `w:pPr`, from a style definition or from a paragraph in the body. */
export function readParagraphStyle(pPr: XmlNode | undefined): ParagraphStyle {
  const spacing = child(pPr, "w:spacing");
  const indent = child(pPr, "w:ind");

  return {
    lineSpacing: readLineSpacing(spacing),
    spaceBeforePt: twipsAttributeToPt(spacing, "w:before"),
    spaceAfterPt: twipsAttributeToPt(spacing, "w:after"),
    // w:start is the newer spelling of w:left and wins where both appear.
    indentLeftMm:
      twipsAttributeToMm(indent, "w:start") ??
      twipsAttributeToMm(indent, "w:left"),
    indentFirstLineMm: readFirstLineIndent(indent),
    alignment: readAlignment(attribute(child(pPr, "w:jc"), "w:val")),
    keepWithNext: readToggle(pPr, "w:keepNext"),
    pageBreakBefore: readToggle(pPr, "w:pageBreakBefore"),
  };
}

/** A hanging indent is a negative first line, expressed as its own attribute. */
function readFirstLineIndent(indent: XmlNode | undefined): number | undefined {
  const firstLine = twipsAttributeToMm(indent, "w:firstLine");
  if (firstLine !== undefined) {
    return firstLine;
  }
  const hanging = twipsAttributeToMm(indent, "w:hanging");
  return hanging === undefined ? undefined : -hanging;
}

function readLineSpacing(
  spacing: XmlNode | undefined,
): LineSpacing | undefined {
  const line = toInteger(attribute(spacing, "w:line"));
  if (line === undefined) {
    return undefined;
  }

  // An omitted w:lineRule means auto, per the schema default.
  switch (attribute(spacing, "w:lineRule") ?? "auto") {
    case "exact":
      return { kind: "exact", pt: twipsToPt(line) };
    case "atLeast":
      return { kind: "atLeast", pt: twipsToPt(line) };
    default:
      return { kind: "multiple", value: lineToMultiplier(line) };
  }
}

const ALIGNMENTS: Readonly<Record<string, Alignment>> = {
  left: "left",
  start: "left",
  center: "center",
  centre: "center",
  right: "right",
  end: "right",
  both: "justify",
  distribute: "justify",
};

function readAlignment(raw: string | undefined): Alignment | undefined {
  return raw === undefined ? undefined : ALIGNMENTS[raw.toLowerCase()];
}

function readToggle(
  parent: XmlNode | undefined,
  name: string,
): boolean | undefined {
  const { present, val } = value(parent, name);
  return present ? toToggle(val) : undefined;
}

function twipsAttributeToPt(
  node: XmlNode | undefined,
  name: string,
): number | undefined {
  const twips = toInteger(attribute(node, name));
  return twips === undefined ? undefined : twipsToPt(twips);
}

function twipsAttributeToMm(
  node: XmlNode | undefined,
  name: string,
): number | undefined {
  const twips = toInteger(attribute(node, name));
  return twips === undefined ? undefined : twipsToMm(twips);
}

function mergeStyles(
  base: EffectiveStyle,
  override: EffectiveStyle,
): EffectiveStyle {
  return {
    text: { ...base.text, ...defined(override.text) },
    paragraph: { ...base.paragraph, ...defined(override.paragraph) },
  };
}

/**
 * A style reports every property it does not set as `undefined`, and spreading
 * those over the base would erase inherited values instead of keeping them.
 */
function defined<T extends object>(source: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
