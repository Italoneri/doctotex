/**
 * Numbers and line lists written the way LaTeX reads them.
 *
 * Kept apart from the emitters so that a module producing one kind of output —
 * a list, a table, the class itself — can measure things without importing the
 * module that assembles the preamble, which imports it back.
 */

/** TeX sets leading at 1.2 times the type size unless told otherwise. */
export const TEX_LEADING_RATIO = 1.2;

/** A blank line before a section, but no blank line where there is no section. */
export function prefixed(lines: readonly string[]): readonly string[] {
  return lines.length === 0 ? [] : ["", ...lines];
}

export function fontSize(sizePt: number): string {
  return `\\fontsize{${trim(sizePt)}pt}{${trim(sizePt * TEX_LEADING_RATIO)}pt}\\selectfont`;
}

export function mm(value: number): string {
  return `${trim(value)}mm`;
}

export function pt(value: number): string {
  return `${trim(value)}pt`;
}

/**
 * Two decimals is finer than any printer resolves, and it keeps a margin
 * derived from twips out of the output as 24.999999999999996mm.
 */
export function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}
