import {
  COLUMN_BREAK,
  PAGE_BREAK,
  type Paragraph,
  type TextRun,
} from "@/lib/extract/body";
import type { Alignment, StyleProfile, TextStyle } from "@/lib/extract/types";
import { bibliographySetup } from "./bib";
import {
  BANNER,
  CLASS_NAME,
  fontSize,
  isShaped,
  mm,
  preambleLines,
  prefixed,
  pt,
  type ClassInput,
} from "./cls";
import { escapeLatex } from "./escape";
import { mapFont } from "./fonts";
import {
  bibToolFor,
  compileCommands,
  DEFAULT_OPTIONS,
  ENGINE_LABELS,
  usesFontspec,
  type GenerationOptions,
} from "./options";

export const MAIN_FILE = "main.tex";

/** Mirrors the sectioning commands the class defines for each outline level. */
const SECTIONING = [
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
] as const;

export interface DocumentInput extends ClassInput {
  readonly paragraphs: readonly Paragraph[];
}

export function generateDocument(input: DocumentInput): string {
  const options = input.options ?? DEFAULT_OPTIONS;
  const context = contextOf(input.profile);
  const bibliography = bibliographySetup(options.bibliography);

  return [
    ...opening(input, options),
    "",
    "\\begin{document}",
    ...prefixed(unsupported(input.profile)),
    "",
    ...input.paragraphs
      .map((paragraph) => render(paragraph, context))
      .filter(Boolean),
    ...(bibliography.body.length === 0 ? [] : ["", ...bibliography.body]),
    "",
    "\\end{document}",
    "",
  ].join("\n");
}

/**
 * What the document carries that this template does not yet reproduce.
 *
 * Said here rather than nowhere: a table whose text is simply missing from the
 * output is indistinguishable from a document that never had one, and someone
 * reading the PDF has no way to find out which it was.
 */
function unsupported(profile: StyleProfile): readonly string[] {
  const missing = [
    profile.features.tables && "tables",
    profile.features.images && "images",
    profile.features.ommlEquations && "equations",
    profile.features.oleObjects && "embedded objects",
    profile.features.numbering && "numbered or bulleted lists",
  ].filter((entry): entry is string => typeof entry === "string");

  if (missing.length === 0) {
    return [];
  }

  return [
    `%% TODO: the source document contains ${missing.join(", ")}.`,
    "%% Their text is not carried into this template yet, so what follows is",
    "%% the document's paragraphs alone. Nothing here silently stands in for",
    "%% them — they are absent.",
  ];
}

/**
 * Everything above `\begin{document}`.
 *
 * The multi-file layout points at the generated class; the single-file layout
 * has no class to point at, so the same preamble is inlined here.
 */
function opening(
  input: DocumentInput,
  options: GenerationOptions,
): readonly string[] {
  const header = [...BANNER, ...compileHeader(options), ""];

  if (options.layout === "multi") {
    return [...header, `\\documentclass{${CLASS_NAME}}`];
  }

  return [
    ...header,
    "\\documentclass{article}",
    "",
    ...asDocumentPreamble(preambleLines(input)),
  ];
}

/**
 * What to run, written into the file you run it on.
 *
 * The engine is picked in a browser and the archive is opened somewhere else
 * entirely, often much later. Without this, choosing XeLaTeX and then reaching
 * for pdfLaTeX out of habit produces a page of errors about fontspec that read
 * as though the template itself were broken.
 */
function compileHeader(options: GenerationOptions): readonly string[] {
  const bibTool = bibToolFor(options.bibliography);
  const commands = compileCommands(MAIN_FILE, {
    engine: options.engine,
    bibTool,
  });

  const lines = ["%%", "%% Compile with:", ...commands.map((c) => `%%   ${c}`)];

  if (usesFontspec(options.engine)) {
    lines.push(
      `%% ${ENGINE_LABELS[options.engine]} is not interchangeable with pdfLaTeX here: the preamble`,
      "%% selects fonts by name through fontspec, which pdfLaTeX cannot load.",
    );
  }
  if (bibTool !== "none") {
    lines.push(
      "%% The repeated passes are not redundant. The first records which keys were",
      `%% cited, ${bibTool} turns those into a .bbl, and the last two resolve the labels`,
      `%% it introduces. Until something is cited, ${bibTool} reports an error and exits`,
      "%% non-zero; the engine passes still succeed and the document still builds.",
    );
  }

  return lines;
}

/**
 * A class writes `\RequirePackage`; a document preamble spells the same
 * operation `\usepackage`. Either is legal in either place, but generated code
 * that reads the way handwritten code reads is easier to take over.
 */
function asDocumentPreamble(lines: readonly string[]): readonly string[] {
  return lines.map((line) => line.replace(/^\\RequirePackage/, "\\usepackage"));
}

type Role =
  | { readonly kind: "heading"; readonly level: number }
  | { readonly kind: "title" };

/**
 * What the class has already done to a paragraph before its text is written.
 *
 * A run only has to say what the class does not already say: a heading is
 * bold and blue by the time `\section*` expands, and repeating that on every
 * run inside it would bury the one word that was italicised by hand.
 */
interface Context {
  readonly profile: StyleProfile;
  readonly roles: ReadonlyMap<string, Role>;
  readonly baselines: ReadonlyMap<string, TextStyle>;
}

/**
 * Word marks a heading by pointing the paragraph at a style, so the mapping
 * from style to sectioning command is resolved once rather than per paragraph.
 */
function contextOf(profile: StyleProfile): Context {
  const roles = new Map<string, Role>();
  const baselines = new Map<string, TextStyle>();

  for (const heading of profile.headings) {
    roles.set(heading.styleId, { kind: "heading", level: heading.level });
    baselines.set(heading.styleId, heading.text);
  }
  if (profile.title) {
    roles.set(profile.title.styleId, { kind: "title" });
    baselines.set(profile.title.styleId, profile.title.text);
  }

  return { profile, roles, baselines };
}

function render(paragraph: Paragraph, context: Context): string {
  const rendered = renderParagraph(paragraph, context);

  // `w:pageBreakBefore` breaks before the paragraph whether or not it is a
  // heading, so it is applied outside the choice of sectioning command.
  if (rendered === "" || !paragraph.style.pageBreakBefore) {
    return rendered;
  }
  return `\\newpage\n${rendered}`;
}

function renderParagraph(paragraph: Paragraph, context: Context): string {
  const role = paragraph.styleId
    ? context.roles.get(paragraph.styleId)
    : undefined;
  const body = dropTrailingBreak(
    renderRuns(paragraph.runs, baselineFor(paragraph, context)),
  );

  // An empty heading would produce a bare rule with nothing under it; an empty
  // body paragraph is a deliberate blank line and survives.
  if (body.trim() === "") {
    return role ? "" : "\n";
  }

  if (role?.kind === "title") {
    return `\\doctotextitle{${body}}\n`;
  }
  if (role?.kind === "heading") {
    const command = SECTIONING[role.level - 1];
    // Word's heading styles are unnumbered unless bound to a list, so the
    // starred forms are the faithful default. Their spacing belongs to
    // titlesec, so they are not wrapped in the paragraph environment.
    return command
      ? `\\${command}*{${body}}\n`
      : `%% TODO: outline level ${role.level} has no LaTeX equivalent.\n${body}\n`;
  }

  return shape(paragraph, body, context);
}

/** The text style the class already applies to a paragraph of this style. */
function baselineFor(paragraph: Paragraph, context: Context): TextStyle {
  const named = paragraph.styleId
    ? context.baselines.get(paragraph.styleId)
    : undefined;
  return named ?? context.profile.defaults.text;
}

/**
 * A paragraph that asks for nothing the document does not already give it is
 * written as plain text. Wrapping every one of them would triple the size of
 * the generated document to say the same thing.
 */
function shape(paragraph: Paragraph, body: string, context: Context): string {
  if (!isShaped(paragraph, context.profile)) {
    return `${body}\n`;
  }

  const own = paragraph.style;
  const open =
    "\\begin{doctotexpara}" +
    `{${pt(own.spaceBeforePt ?? 0)}}` +
    `{${pt(own.spaceAfterPt ?? 0)}}` +
    `{${mm(own.indentLeftMm ?? 0)}}` +
    `{${mm(own.indentFirstLineMm ?? 0)}}` +
    `{${alignmentSwitch(paragraph, context)}}`;

  return `${open}\n${body}\n\\end{doctotexpara}\n`;
}

const ALIGNMENT_SWITCHES: ReadonlyMap<Alignment, string> = new Map([
  ["left", "\\raggedright"],
  ["right", "\\raggedleft"],
  ["center", "\\centering"],
  ["justify", "\\justifying"],
]);

/** Empty where the paragraph is aligned the way the whole document is. */
function alignmentSwitch(paragraph: Paragraph, context: Context): string {
  const own = paragraph.style.alignment ?? "left";
  const body = context.profile.defaults.paragraph.alignment ?? "left";

  return own === body ? "" : (ALIGNMENT_SWITCHES.get(own) ?? "");
}

function renderRuns(runs: readonly TextRun[], baseline: TextStyle): string {
  return runs.map((run) => renderRun(run, baseline)).join("");
}

/**
 * Structure the run text carries, spelled as LaTeX.
 *
 * A break has to sit between two decorated pieces rather than inside one:
 * `ulem` measures its argument to draw under it, and a `\\` inside that
 * argument is an error rather than a line break.
 */
const STRUCTURE: ReadonlyMap<string, string> = new Map([
  ["\n", " \\\\\n"],
  [PAGE_BREAK, "\n\\newpage\n"],
  [
    COLUMN_BREAK,
    "\n%% TODO: a column break has no equivalent in a single-column document.\n",
  ],
]);

function renderRun(run: TextRun, baseline: TextStyle): string {
  return run.text
    .split(/([\n\f\v])/)
    .map((piece) => {
      const structure = STRUCTURE.get(piece);
      if (structure !== undefined) {
        return structure;
      }
      return piece === ""
        ? ""
        : decorate(withTabs(escapeLatex(piece)), run.style, baseline);
    })
    .join("");
}

/** Until tab stops are read, a tab is a fixed space rather than a position. */
function withTabs(text: string): string {
  return text.replace(/\t/g, "\\quad{}");
}

/**
 * A trailing `\\` immediately before a paragraph break is an "There's no line
 * here to end" error. Stripping it at the paragraph rather than at the run is
 * what keeps a break between two runs of a sentence.
 */
function dropTrailingBreak(body: string): string {
  return body.replace(/(\s*\\\\\s*)+$/, "");
}

/**
 * The switches that carry a run from what the class already applies to what
 * the document asks for, innermost first. Order is not cosmetic: `ulem` boxes
 * its argument, so it wraps text that is already set, and the colour wraps
 * that so the line it draws is coloured too.
 */
function decorate(text: string, style: TextStyle, baseline: TextStyle): string {
  let decorated = text;

  if (style.allCaps && !baseline.allCaps) {
    decorated = `\\MakeUppercase{${decorated}}`;
  }
  if (style.smallCaps && !baseline.smallCaps) {
    decorated = `\\textsc{${decorated}}`;
  }
  decorated = raised(decorated, style, baseline);
  decorated = slant(decorated, style, baseline);
  decorated = weight(decorated, style, baseline);
  decorated = face(decorated, style, baseline);

  if (style.underline && !baseline.underline) {
    decorated = `\\uline{${decorated}}`;
  }
  if (style.strike && !baseline.strike) {
    decorated = `\\sout{${decorated}}`;
  }
  if (style.colorHex && style.colorHex !== baseline.colorHex) {
    decorated = `\\textcolor[HTML]{${style.colorHex.replace("#", "")}}{${decorated}}`;
  }

  return decorated;
}

/**
 * Bold and italic go both ways: a run inside a bold heading that turns the
 * weight back off has to say so, because the class has already switched it on.
 */
function weight(text: string, style: TextStyle, baseline: TextStyle): string {
  if (Boolean(style.bold) === Boolean(baseline.bold)) {
    return text;
  }
  return style.bold ? `\\textbf{${text}}` : `{\\mdseries{}${text}}`;
}

function slant(text: string, style: TextStyle, baseline: TextStyle): string {
  if (Boolean(style.italic) === Boolean(baseline.italic)) {
    return text;
  }
  return style.italic ? `\\textit{${text}}` : `{\\upshape{}${text}}`;
}

function raised(text: string, style: TextStyle, baseline: TextStyle): string {
  if (!style.script || style.script === baseline.script) {
    return text;
  }
  switch (style.script) {
    case "superscript":
      return `\\textsuperscript{${text}}`;
    case "subscript":
      return `\\textsubscript{${text}}`;
    case "baseline":
      return text;
  }
}

/**
 * Family and size travel together because both are declarations rather than
 * commands: they need a group to end in, and one group serves both.
 */
function face(text: string, style: TextStyle, baseline: TextStyle): string {
  const switches: string[] = [];

  const family = mapFont(style.fontFamily).family;
  if (style.fontFamily && family !== mapFont(baseline.fontFamily).family) {
    switches.push(`\\${family}family`);
  }
  if (
    style.fontSizePt !== undefined &&
    style.fontSizePt !== baseline.fontSizePt
  ) {
    switches.push(fontSize(style.fontSizePt));
  }

  // An empty group closes the switch, which would otherwise read the first
  // letter of the text as part of its own name. A space would close it too and
  // then vanish along with every space behind it, because TeX skips all of
  // them after a control word — which is how `Estado  •` became `Estado•`.
  return switches.length === 0 ? text : `{${switches.join("")}{}${text}}`;
}
