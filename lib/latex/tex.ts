import type { Paragraph, TextRun } from "@/lib/extract/body";
import type { StyleProfile } from "@/lib/extract/types";
import { bibliographySetup } from "./bib";
import { BANNER, CLASS_NAME, preambleLines, type ClassInput } from "./cls";
import { escapeLatex } from "./escape";
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
  const roles = roleByStyleId(input.profile);
  const bibliography = bibliographySetup(options.bibliography);

  return [
    ...opening(input, options),
    "",
    "\\begin{document}",
    "",
    ...input.paragraphs
      .map((paragraph) => render(paragraph, roles))
      .filter(Boolean),
    ...(bibliography.body.length === 0 ? [] : ["", ...bibliography.body]),
    "",
    "\\end{document}",
    "",
  ].join("\n");
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
 * Word marks a heading by pointing the paragraph at a style, so the mapping
 * from style to sectioning command is resolved once rather than per paragraph.
 */
function roleByStyleId(profile: StyleProfile): ReadonlyMap<string, Role> {
  const roles = new Map<string, Role>();

  for (const heading of profile.headings) {
    roles.set(heading.styleId, { kind: "heading", level: heading.level });
  }
  if (profile.title) {
    roles.set(profile.title.styleId, { kind: "title" });
  }

  return roles;
}

function render(
  paragraph: Paragraph,
  roles: ReadonlyMap<string, Role>,
): string {
  const body = renderRuns(paragraph.runs);
  const role = paragraph.styleId ? roles.get(paragraph.styleId) : undefined;

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
    // starred forms are the faithful default.
    return command
      ? `\\${command}*{${body}}\n`
      : `%% TODO: outline level ${role.level} has no LaTeX equivalent.\n${body}\n`;
  }

  return `${body}\n`;
}

function renderRuns(runs: readonly TextRun[]): string {
  return runs.map(renderRun).join("");
}

function renderRun(run: TextRun): string {
  const text = decorate(escapeLatex(run.text), run);
  return applyBreaks(text);
}

function decorate(text: string, run: TextRun): string {
  let decorated = text;
  if (run.italic) {
    decorated = `\\textit{${decorated}}`;
  }
  if (run.bold) {
    decorated = `\\textbf{${decorated}}`;
  }
  return decorated;
}

/**
 * A `w:br` is a line break inside the paragraph, which LaTeX spells `\\`. A
 * trailing one has to go: `\\` immediately before a paragraph break is an
 * "There's no line here to end" error.
 */
function applyBreaks(text: string): string {
  return text
    .replace(/\t/g, "\\quad{}")
    .replace(/\n+$/, "")
    .replace(/\n/g, " \\\\\n");
}
