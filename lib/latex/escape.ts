/**
 * The ten characters LaTeX reserves. `\` maps to a command that itself contains
 * braces, so the replacement runs as a single pass — escaping character by
 * character would re-escape the braces it just produced.
 */
const ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  _: "\\_",
  "%": "\\%",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

const RESERVED = /[\\{}$&#_%~^]/g;

/** A no-break space is a instruction to not break, which LaTeX spells `~`. */
const NO_BREAK_SPACE = / /g;

/**
 * Makes a run of document text safe to place in a LaTeX source file.
 *
 * Tabs and newlines pass through untouched: they carry paragraph-level meaning
 * that only the generator can express, since a `\\` is a line break inside a
 * paragraph but an error at the end of one.
 */
export function escapeLatex(text: string): string {
  return text
    .replace(RESERVED, (character) => ESCAPES[character] ?? character)
    .replace(NO_BREAK_SPACE, "~");
}
