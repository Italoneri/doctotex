import {
  attributeOf,
  findChild,
  findDescendant,
  parseSequence,
  textOf,
  toXmlNode,
  type SequenceNode,
} from "@/lib/docx/sequence";
import {
  resolveMarker,
  type ListMarker,
  type Numbering,
} from "./numbering";
import type { Degradations } from "./report";
import {
  readParagraphStyle,
  readTextStyle,
  resolveParagraph,
  resolveRun,
  type StyleSheet,
} from "./styles";
import type { EffectiveStyle, ParagraphStyle, TextStyle } from "./types";
import { toInteger } from "./units";

/**
 * Structure XML itself cannot carry, so it can travel inside the text.
 *
 * XML 1.0 excludes every control character below U+0020 except tab, line feed
 * and carriage return, which leaves form feed and vertical tab impossible in a
 * `w:t` and therefore unambiguous here.
 */
export const PAGE_BREAK = "\f";
export const COLUMN_BREAK = "\v";

export interface TextRun {
  readonly text: string;
  /** Fully resolved: the cascade has already run, so nothing here inherits. */
  readonly style: TextStyle;
}

export interface Paragraph {
  /** Localised, e.g. `Titre1`. Kept so the sectioning role can be recovered. */
  readonly styleId?: string;
  /** Fully resolved, including the paragraph's own `w:pPr`. */
  readonly style: ParagraphStyle;
  readonly runs: readonly TextRun[];
  /** Set where `w:numPr` puts the paragraph in a list, with its level resolved. */
  readonly list?: ListMarker;
}

/**
 * Everything the walk needs that is not the node in front of it.
 *
 * Passed as one value rather than three parameters because the walk is
 * recursive and every reader below it needs the same three; threading them
 * separately is how a reader ends up quietly missing one.
 */
export interface BodyContext {
  readonly sheet: StyleSheet;
  readonly numbering: Numbering;
  readonly degradations: Degradations;
}

/**
 * Paragraphs in document order, with their runs in order within each.
 *
 * Tables and drawings are skipped rather than positioned: placing them needs
 * the same ordered walk this uses, so the block layer extends the traversal
 * rather than reworking it. `DocumentFeatures` records that they were there.
 */
export function extractParagraphs(
  documentXml: string,
  context: BodyContext,
): readonly Paragraph[] {
  const body = findDescendant(parseSequence(documentXml), "w:body");
  if (!body) {
    return [];
  }

  return body.children
    .filter((node) => node.name === "w:p")
    .map((node) => readParagraph(node, context));
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

function readParagraph(node: SequenceNode, context: BodyContext): Paragraph {
  const properties = findChild(node, "w:pPr");
  const styleId = attributeOf(findChild(properties, "w:pStyle"), "w:val");

  // `w:pPr/w:rPr` formats the paragraph mark itself, not the runs inside it,
  // so only the paragraph properties are read here; each run carries its own.
  const effective = resolveParagraph(context.sheet, styleId, {
    text: {},
    paragraph: readParagraphStyle(propertiesOf(properties)),
  });

  return {
    styleId,
    style: effective.paragraph,
    runs: mergeAdjacent(collectRuns(node.children, context.sheet, effective)),
    list: readListMarker(properties, styleId, context),
  };
}

/**
 * A paragraph joins a list through `w:numPr`, either directly or through the
 * style it points at. Word writes the second form for its own List Paragraph
 * style, so reading only the direct one misses every list in a Word document
 * that was made with the ribbon button.
 */
function readListMarker(
  properties: SequenceNode | undefined,
  styleId: string | undefined,
  { sheet, numbering, degradations }: BodyContext,
): ListMarker | undefined {
  const own = findChild(properties, "w:numPr");
  const inherited = styleId ? sheet.numbering.get(styleId) : undefined;

  const numId =
    attributeOf(findChild(own, "w:numId"), "w:val") ?? inherited?.numId;
  if (numId === undefined || numId === "0") {
    // Word writes numId 0 to take a paragraph back out of a list.
    return undefined;
  }

  const level =
    toInteger(attributeOf(findChild(own, "w:ilvl"), "w:val")) ??
    inherited?.level ??
    0;

  const marker = resolveMarker(numbering, numId, level);
  if (!marker) {
    degradations.note(
      "unresolved-list",
      `A paragraph asks for list ${numId} at level ${level}, which numbering.xml does not define; it is written as an ordinary paragraph.`,
    );
  }
  return marker;
}

/**
 * Runs sit directly under the paragraph, but also inside `w:hyperlink` and
 * `w:smartTag` wrappers. Collecting each container separately would reorder the
 * sentence, so the walk descends through wrappers in place.
 */
function collectRuns(
  nodes: readonly SequenceNode[],
  sheet: StyleSheet,
  paragraph: EffectiveStyle,
): readonly TextRun[] {
  const runs: TextRun[] = [];

  for (const node of nodes) {
    switch (node.name) {
      case "w:r": {
        const run = readRun(node, sheet, paragraph);
        if (run.text !== "") {
          runs.push(run);
        }
        break;
      }
      case "w:hyperlink":
      case "w:smartTag":
      case "w:ins":
      case "w:moveTo":
        runs.push(...collectRuns(node.children, sheet, paragraph));
        break;
      default:
        break;
    }
  }

  return runs;
}

function readRun(
  node: SequenceNode,
  sheet: StyleSheet,
  paragraph: EffectiveStyle,
): TextRun {
  const properties = findChild(node, "w:rPr");
  const runStyleId = attributeOf(findChild(properties, "w:rStyle"), "w:val");

  return {
    text: node.children.map(readRunContent).join(""),
    style: resolveRun(
      sheet,
      paragraph,
      runStyleId,
      readTextStyle(propertiesOf(properties), sheet.theme),
    ),
  };
}

/** The property readers work on the unordered view; this is the crossing. */
function propertiesOf(node: SequenceNode | undefined) {
  return node ? toXmlNode(node) : undefined;
}

function readRunContent(node: SequenceNode): string {
  switch (node.name) {
    case "w:t":
      return textOf(node);
    case "w:tab":
      return "\t";
    case "w:br":
      return breakOf(node);
    case "w:cr":
      return "\n";
    case "w:noBreakHyphen":
      return "-";
    // w:drawing, w:object and w:rPr contribute no text in this phase.
    default:
      return "";
  }
}

/** An omitted `w:type` means a line break, per the schema default. */
function breakOf(node: SequenceNode): string {
  switch (attributeOf(node, "w:type")) {
    case "page":
      return PAGE_BREAK;
    case "column":
      return COLUMN_BREAK;
    default:
      return "\n";
  }
}

/**
 * Word splits a sentence into separate runs whenever it records an editing
 * session, so identical formatting repeats. Merging keeps the output from
 * reading as `\textbf{Hel}\textbf{lo}`.
 *
 * The comparison covers the whole resolved style rather than a chosen few
 * properties: merging two runs erases the boundary between them for good, so a
 * property the comparison cannot see is a property silently lost.
 */
function mergeAdjacent(runs: readonly TextRun[]): readonly TextRun[] {
  return runs.reduce<TextRun[]>((merged, run) => {
    const previous = merged.at(-1);
    if (previous && sameStyle(previous.style, run.style)) {
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

/**
 * Every property, by name, so a field added to `TextStyle` is compared without
 * anything here having to be remembered. An absent property and one set to
 * `undefined` are the same thing, which is why undefined entries are dropped
 * before the counts are compared.
 */
function sameStyle(left: TextStyle, right: TextStyle): boolean {
  const declared = (style: TextStyle) =>
    Object.entries(style).filter(([, value]) => value !== undefined);

  const ours = declared(left);
  const theirs = new Map(declared(right));

  return (
    ours.length === theirs.size &&
    ours.every(([name, value]) => theirs.get(name) === value)
  );
}
