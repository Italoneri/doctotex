import { sameTextStyle, type Block, type Paragraph } from "./body";
import type { Degradations } from "./report";
import type { EffectiveStyle } from "./types";

/**
 * Long enough for "MATERIAL AND METHODS", short enough that a sentence written
 * in capitals for emphasis is not mistaken for a section title.
 */
const MAX_HEADING_LENGTH = 60;

/**
 * The sections a document has without saying so.
 *
 * Word marks a heading by pointing the paragraph at a style. A great many
 * documents — conference templates above all — never do: their sections are
 * ordinary paragraphs a person centred and typed in capitals, and the outline
 * exists only in the reader's eye. Converting those faithfully produces a
 * document with no structure at all: no contents page, nothing to reference,
 * and nothing to navigate in the PDF.
 *
 * So this reads the same signal a person reads, and every promotion is written
 * into the report. An inference the reader is not told about is a claim the
 * document never made, which is the one thing this converter does not do.
 *
 * Only top level: a centred line inside a table cell is a column heading, and
 * `\section` inside a `tabularx` is an error rather than a structure.
 */
export function inferHeadings(
  blocks: readonly Block[],
  defaults: EffectiveStyle,
  declaredRoles: ReadonlySet<string>,
  degradations: Degradations,
): readonly Block[] {
  if ((defaults.paragraph.alignment ?? "left") === "center") {
    // Nothing to read: in a document whose body is centred, being centred says
    // nothing about a paragraph.
    return blocks;
  }

  return blocks.map((block) => {
    if (
      block.kind !== "paragraph" ||
      !readsAsHeading(block.paragraph, defaults, declaredRoles)
    ) {
      return block;
    }

    degradations.note(
      "inferred-heading",
      "A paragraph is centred, upper case and short in a document whose body is neither, so it is written as a section. Word does not mark it as one.",
    );

    return {
      kind: "paragraph",
      paragraph: { ...block.paragraph, inferredHeading: true },
    };
  });
}

function readsAsHeading(
  paragraph: Paragraph,
  defaults: EffectiveStyle,
  declaredRoles: ReadonlySet<string>,
): boolean {
  // A paragraph that already has a role has said what it is.
  if (paragraph.styleId && declaredRoles.has(paragraph.styleId)) {
    return false;
  }
  if (paragraph.list || paragraph.style.alignment !== "center") {
    return false;
  }

  // Typed no differently from body text, only placed differently. A line that
  // is also larger or bolder is doing something else — a title, most often —
  // and giving it a section's formatting would take that away.
  const plain = paragraph.runs.every(
    (run) => run.kind === "text" && sameTextStyle(run.style, defaults.text),
  );

  return plain && readsAsTitleText(textOf(paragraph));
}

function textOf(paragraph: Paragraph): string {
  return paragraph.runs
    .map((run) => (run.kind === "text" ? run.text : ""))
    .join("");
}

/**
 * Short, capitalised, and not a sentence.
 *
 * The full stop is what separates "CONCLUSÃO" from a line of shouted prose:
 * headings do not end in one, and a sentence in capitals almost always does.
 */
function readsAsTitleText(raw: string): boolean {
  const text = raw.trim();

  return (
    text.length > 0 &&
    text.length <= MAX_HEADING_LENGTH &&
    !/[\n\f\v]/.test(text) &&
    !text.endsWith(".") &&
    /\p{Letter}/u.test(text) &&
    text === text.toUpperCase()
  );
}
