import {
  MAX_LIST_DEPTH,
  type ListFormat,
  type ListLevel,
  type ListMarker,
} from "@/lib/extract/numbering";
import { escapeLatex } from "./escape";
import { mm, pt } from "./format";

/**
 * Word's lists rendered as `enumitem` environments.
 *
 * The label, the margins and the spacing all come out of `numbering.xml`, so a
 * document whose second level is lettered and indented 12mm gets exactly that
 * rather than LaTeX's defaults, which look nothing like Word's.
 */

export type ListEnvironment = "itemize" | "enumerate";

/**
 * The counters `\renewlist{enumerate}{enumerate}{9}` creates, in order. A label
 * that shows its parents' numbers — `1.2.` — has to name them, and `\arabic*`
 * only ever means the innermost one.
 */
const COUNTERS: readonly string[] = [
  "enumi",
  "enumii",
  "enumiii",
  "enumiv",
  "enumv",
  "enumvi",
  "enumvii",
  "enumviii",
  "enumix",
];

/** The LaTeX counter command for each format Word can number in. */
const NUMBER_COMMANDS: Readonly<Record<ListFormat, string | undefined>> = {
  bullet: undefined,
  none: undefined,
  decimal: "arabic",
  lowerLetter: "alph",
  upperLetter: "Alph",
  lowerRoman: "roman",
  upperRoman: "Roman",
};

/**
 * Bullets as commands every engine has without a package. `\rule` draws the
 * square rather than borrowing `\blacksquare` from amssymb, which would mean
 * loading a maths package to print one character.
 */
const GLYPH_COMMANDS: Readonly<Record<string, string>> = {
  disc: "\\textbullet",
  circle: "$\\circ$",
  square: "\\rule{0.8ex}{0.8ex}",
  dash: "--",
  asterisk: "\\textasteriskcentered",
  arrow: "$\\rightarrow$",
  diamond: "$\\diamond$",
};

const DEFAULT_GLYPH = "\\textbullet";

/** A `%N` reference to a level's counter; `%` before anything else is literal. */
const LEVEL_REFERENCE = /%([1-9])/g;

/** What each enclosing level is, outermost first. */
export type ListStack = readonly ListMarker[];

export interface ListShape {
  /** Continue the counter rather than restarting it. */
  readonly resume: boolean;
  readonly spaceBeforePt?: number;
  readonly spaceAfterPt?: number;
}

export function environmentFor(marker: ListMarker): ListEnvironment {
  return NUMBER_COMMANDS[marker.definition.format] === undefined
    ? "itemize"
    : "enumerate";
}

/**
 * The bracketed options for one `\begin{itemize}` or `\begin{enumerate}`.
 *
 * `resume` is what makes a list interrupted by a paragraph carry on counting
 * instead of starting again at one, which is what Word does and what a reader
 * comparing the two documents notices first.
 */
export function optionsFor(
  marker: ListMarker,
  stack: ListStack,
  shape: ListShape,
): string {
  const level = marker.definition;
  const options = [`label=${labelFor(marker, stack)}`];

  const margin = leftMarginMm(level, stack);
  if (margin !== undefined) {
    options.push(`leftmargin=${mm(margin)}`);
  }
  if (level.indentHangingMm !== undefined) {
    options.push(`labelsep=${mm(labelSeparationMm(level.indentHangingMm))}`);
  }
  if (shape.spaceAfterPt !== undefined) {
    options.push(`itemsep=${pt(shape.spaceAfterPt)}`);
  }
  if (shape.spaceBeforePt !== undefined) {
    options.push(`topsep=${pt(shape.spaceBeforePt)}`);
  }

  if (shape.resume) {
    options.push("resume");
  } else if (level.startAt !== 1 && environmentFor(marker) === "enumerate") {
    options.push(`start=${level.startAt}`);
  }

  return `[${options.join(", ")}]`;
}

/**
 * Word's hanging indent is the whole distance from the label to the text; what
 * enumitem wants is the gap after the label. Half of it lands close enough to
 * Word to read as the same list, and never collapses to zero.
 */
function labelSeparationMm(hangingMm: number): number {
  return Math.max(hangingMm / 2, 0.5);
}

/**
 * Word indents a level from the page margin; enumitem indents it from the level
 * that encloses it. Passing Word's number through unchanged makes every nested
 * list march right across the page.
 */
function leftMarginMm(level: ListLevel, stack: ListStack): number | undefined {
  if (level.indentLeftMm === undefined) {
    return undefined;
  }
  const parent = stack.at(-1)?.definition.indentLeftMm ?? 0;
  return Math.max(level.indentLeftMm - parent, 0);
}

/**
 * `w:lvlText` written as an enumitem label.
 *
 * Everything that is not a `%N` reference is literal text from the document and
 * is escaped: a level labelled `100%` would otherwise comment out the rest of
 * the line.
 */
export function labelFor(marker: ListMarker, stack: ListStack): string {
  const level = marker.definition;

  if (environmentFor(marker) === "itemize") {
    return level.format === "none" ? "{}" : glyphFor(level);
  }

  let numbered = false;
  const label = replaceReferences(level.lvlText, (index, literal) => {
    const reference = referenceFor(index, marker, stack, literal);
    numbered ||= reference.counted;
    return reference.text;
  });

  // A numbered level whose label resolved no reference at all would print the
  // same characters on every item, which reads as a bullet that lost its shape.
  return numbered ? label : currentNumber(level.format);
}

function replaceReferences(
  lvlText: string,
  resolve: (index: number, literal: string) => string,
): string {
  const pieces: string[] = [];
  let cursor = 0;

  for (const match of lvlText.matchAll(LEVEL_REFERENCE)) {
    const at = match.index;
    pieces.push(escapeLatex(lvlText.slice(cursor, at)));
    pieces.push(resolve(Number(match[1]) - 1, match[0]));
    cursor = at + match[0].length;
  }
  pieces.push(escapeLatex(lvlText.slice(cursor)));

  return pieces.join("");
}

function glyphFor(level: ListLevel): string {
  return (level.glyph && GLYPH_COMMANDS[level.glyph]) ?? DEFAULT_GLYPH;
}

interface Reference {
  readonly text: string;
  /** False where the level could not be named, so the label is not a number. */
  readonly counted: boolean;
}

/**
 * One `%N` resolved. The innermost level is `\arabic*`, which enumitem binds to
 * whichever counter the environment owns; an enclosing level has to be named,
 * and can only be named when it is itself numbered.
 */
function referenceFor(
  index: number,
  marker: ListMarker,
  stack: ListStack,
  literal: string,
): Reference {
  if (index === marker.level) {
    return { text: currentNumber(marker.definition.format), counted: true };
  }

  const enclosing = stack.find((open) => open.level === index);
  const counter = COUNTERS[index];
  if (
    !enclosing ||
    counter === undefined ||
    environmentFor(enclosing) !== "enumerate"
  ) {
    // The document refers to a level that is not numbered here — a lettered
    // sub-list under a bulleted one. Printing the reference would name a
    // counter LaTeX never created, so the literal stands in for it.
    return { text: escapeLatex(literal), counted: false };
  }

  return {
    text: `\\${commandFor(enclosing.definition.format)}{${counter}}`,
    counted: true,
  };
}

function currentNumber(format: ListFormat): string {
  return `\\${commandFor(format)}*`;
}

function commandFor(format: ListFormat): string {
  return NUMBER_COMMANDS[format] ?? "arabic";
}

/**
 * The preamble a document with lists needs.
 *
 * LaTeX nests four levels; Word nests nine. `\setlistdepth` raises the limit,
 * but `\renewlist` clears the labels that came with the original environments,
 * so a default has to be put back or every item prints without one.
 */
export function listPreamble(): readonly string[] {
  return [
    "%% The document contains lists.",
    "\\RequirePackage{enumitem}",
    `%% Word nests ${MAX_LIST_DEPTH} levels where LaTeX stops at four.`,
    `\\setlistdepth{${MAX_LIST_DEPTH}}`,
    `\\renewlist{itemize}{itemize}{${MAX_LIST_DEPTH}}`,
    `\\renewlist{enumerate}{enumerate}{${MAX_LIST_DEPTH}}`,
    "%% \\renewlist leaves every level unlabelled; each list overrides these.",
    `\\setlist[itemize]{label=${DEFAULT_GLYPH}}`,
    "\\setlist[enumerate]{label=\\arabic*.}",
  ];
}
