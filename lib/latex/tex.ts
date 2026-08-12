import type { Paragraph, TextRun } from "@/lib/extract/body";
import type { StyleProfile } from "@/lib/extract/types";
import { CLASS_NAME } from "./cls";
import { escapeLatex } from "./escape";

export const MAIN_FILE = "main.tex";

/** Mirrors the sectioning commands the class defines for each outline level. */
const SECTIONING = [
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
] as const;

export function generateDocument(
  profile: StyleProfile,
  paragraphs: readonly Paragraph[],
): string {
  const roles = roleByStyleId(profile);

  return [
    `\\documentclass{${CLASS_NAME}}`,
    "",
    "\\begin{document}",
    "",
    ...paragraphs.map((paragraph) => render(paragraph, roles)).filter(Boolean),
    "",
    "\\end{document}",
    "",
  ].join("\n");
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
