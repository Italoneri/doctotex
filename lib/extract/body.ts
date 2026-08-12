import {
  attributeOf,
  descendSequence,
  findChild,
  findDescendant,
  hasChild,
  parseSequence,
  textOf,
  type SequenceNode,
} from "@/lib/docx/sequence";
import { toToggle } from "./units";

export interface TextRun {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

export interface Paragraph {
  /** Localised, e.g. `Titre1`; resolved against the stylesheet by the caller. */
  readonly styleId?: string;
  readonly runs: readonly TextRun[];
}

/**
 * Paragraphs in document order, with their runs in order within each.
 *
 * Tables and drawings are skipped rather than positioned: placing them needs
 * the same ordered walk this uses, so phase 5 extends the switch below instead
 * of reworking the traversal.
 */
export function extractParagraphs(documentXml: string): readonly Paragraph[] {
  const body = findDescendant(parseSequence(documentXml), "w:body");
  if (!body) {
    return [];
  }

  return body.children.filter((node) => node.name === "w:p").map(readParagraph);
}

/**
 * How many paragraphs point at each style.
 *
 * A style declared in styles.xml is not necessarily used: documents routinely
 * carry Word's built-in heading styles while every visible heading is a normal
 * paragraph someone bolded by hand. Reporting the declaration alone would claim
 * a structure the document does not have.
 */
export function countStyleUsage(
  paragraphs: readonly Paragraph[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();

  for (const { styleId } of paragraphs) {
    if (styleId) {
      counts.set(styleId, (counts.get(styleId) ?? 0) + 1);
    }
  }

  return counts;
}

function readParagraph(node: SequenceNode): Paragraph {
  const style = descendSequence(node, "w:pPr", "w:pStyle");

  return {
    styleId: attributeOf(style, "w:val"),
    runs: mergeAdjacent(collectRuns(node.children)),
  };
}

/**
 * Runs sit directly under the paragraph, but also inside `w:hyperlink` and
 * `w:smartTag` wrappers. Collecting each container separately would reorder the
 * sentence, so the walk descends through wrappers in place.
 */
function collectRuns(nodes: readonly SequenceNode[]): readonly TextRun[] {
  const runs: TextRun[] = [];

  for (const node of nodes) {
    switch (node.name) {
      case "w:r": {
        const run = readRun(node);
        if (run.text !== "") {
          runs.push(run);
        }
        break;
      }
      case "w:hyperlink":
      case "w:smartTag":
      case "w:ins":
        runs.push(...collectRuns(node.children));
        break;
      default:
        break;
    }
  }

  return runs;
}

function readRun(node: SequenceNode): TextRun {
  const properties = findChild(node, "w:rPr");

  return {
    text: node.children.map(readRunContent).join(""),
    bold: readToggle(properties, "w:b"),
    italic: readToggle(properties, "w:i"),
  };
}

function readRunContent(node: SequenceNode): string {
  switch (node.name) {
    case "w:t":
      return textOf(node);
    case "w:tab":
      return "\t";
    case "w:br":
    case "w:cr":
      return "\n";
    case "w:noBreakHyphen":
      return "-";
    // w:drawing, w:object and w:rPr contribute no text in this phase.
    default:
      return "";
  }
}

function readToggle(
  properties: SequenceNode | undefined,
  name: string,
): boolean {
  if (!hasChild(properties, name)) {
    return false;
  }
  return toToggle(attributeOf(findChild(properties, name), "w:val"));
}

/**
 * Word splits a sentence into separate runs whenever it records an editing
 * session, so identical formatting repeats. Merging keeps the output from
 * reading as `\textbf{Hel}\textbf{lo}`.
 */
function mergeAdjacent(runs: readonly TextRun[]): readonly TextRun[] {
  return runs.reduce<TextRun[]>((merged, run) => {
    const previous = merged.at(-1);
    if (previous?.bold === run.bold && previous?.italic === run.italic) {
      merged[merged.length - 1] = {
        ...previous,
        text: previous.text + run.text,
      };
      return merged;
    }
    merged.push(run);
    return merged;
  }, []);
}
