import {
  attributeOf,
  findChild,
  findDescendant,
  parseSequence,
  textOf,
  toXmlNode,
  type SequenceNode,
} from "@/lib/docx/sequence";
import { readDrawing, type ImageRef, type Relationships } from "./media";
import { resolveMarker, type ListMarker, type Numbering } from "./numbering";
import type { Degradations } from "./report";
import {
  readParagraphStyle,
  readTextStyle,
  resolveParagraph,
  resolveRun,
  type StyleSheet,
} from "./styles";
import {
  readCellMargins,
  readCellProperties,
  readRowIsHeader,
  readTableBorders,
  readTableGrid,
  type TableCell,
  type TableProfile,
  type TableRow,
} from "./table";
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
  readonly kind: "text";
  readonly text: string;
  /** Fully resolved: the cascade has already run, so nothing here inherits. */
  readonly style: TextStyle;
}

/**
 * A picture sitting in the run sequence, where Word puts it.
 *
 * Word places a picture inside a `w:r`, which means it has a position within a
 * sentence rather than between two paragraphs. A separate list of images
 * alongside the runs would lose that position, and an image is far more often
 * a paragraph of its own than mid-sentence — but "far more often" is not
 * "always", and the shape should not decide which documents convert correctly.
 */
export interface ImageRun {
  readonly kind: "image";
  readonly image: ImageRef;
}

export type Run = TextRun | ImageRun;

export interface Paragraph {
  /** Localised, e.g. `Titre1`. Kept so the sectioning role can be recovered. */
  readonly styleId?: string;
  /** Fully resolved, including the paragraph's own `w:pPr`. */
  readonly style: ParagraphStyle;
  readonly runs: readonly Run[];
  /** Set where `w:numPr` puts the paragraph in a list, with its level resolved. */
  readonly list?: ListMarker;
}

/**
 * What sits at the top level of a document, and inside a table cell.
 *
 * A discriminated union rather than a paragraph with optional table fields: a
 * table has no runs and a paragraph has no rows, and a shape that allows both
 * at once is a shape every reader has to check twice.
 */
export type Block =
  | { readonly kind: "paragraph"; readonly paragraph: Paragraph }
  | { readonly kind: "table"; readonly table: TableProfile };

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
  /** Where a picture's `r:embed` points, resolved to a part in the archive. */
  readonly relationships: Relationships;
}

/**
 * How deep a table may sit before its contents are flattened.
 *
 * One means top-level tables only. A table inside a cell is legal OOXML and
 * rare in practice, and the LaTeX for it — a tabularx inside a cell of another,
 * inside a longtable that may not contain either — is where the generated
 * document stops compiling. Flattening loses the inner grid and keeps the text.
 */
const MAX_TABLE_DEPTH = 1;

/** Blocks in document order, with their runs in order within each paragraph. */
export function extractBlocks(
  documentXml: string,
  context: BodyContext,
): readonly Block[] {
  const body = findDescendant(parseSequence(documentXml), "w:body");
  return body ? readBlocks(body.children, context, 0) : [];
}

/** Paragraphs as the blocks they are, for a caller that has only paragraphs. */
export function paragraphBlocks(
  paragraphs: readonly Paragraph[],
): readonly Block[] {
  return paragraphs.map((paragraph) => ({ kind: "paragraph", paragraph }));
}

/** Every paragraph in a block list, including the ones inside table cells. */
export function paragraphsOf(blocks: readonly Block[]): readonly Paragraph[] {
  return blocks.flatMap((block) =>
    block.kind === "paragraph"
      ? [block.paragraph]
      : block.table.rows.flatMap((row) =>
          row.cells.flatMap((cell) => paragraphsOf(cell.blocks)),
        ),
  );
}

/**
 * Every picture the blocks include, by part, without repeats.
 *
 * A document that places the same picture twice references one part twice, and
 * writing it into the generated sources twice would double its weight in the
 * archive the reader downloads.
 */
export function imagePartsOf(blocks: readonly Block[]): readonly string[] {
  const parts = new Set<string>();

  for (const paragraph of paragraphsOf(blocks)) {
    for (const run of paragraph.runs) {
      if (run.kind === "image") {
        parts.add(run.image.part);
      }
    }
  }

  return [...parts];
}

function readBlocks(
  nodes: readonly SequenceNode[],
  context: BodyContext,
  depth: number,
): readonly Block[] {
  const blocks: Block[] = [];

  for (const node of nodes) {
    switch (node.name) {
      case "w:p":
        blocks.push({
          kind: "paragraph",
          paragraph: readParagraph(node, context),
        });
        break;
      case "w:tbl":
        blocks.push(...readTableBlock(node, context, depth));
        break;
      // A content control wraps ordinary content; its own element carries none.
      case "w:sdt":
        blocks.push(
          ...readBlocks(
            findChild(node, "w:sdtContent")?.children ?? [],
            context,
            depth,
          ),
        );
        break;
      default:
        break;
    }
  }

  return blocks;
}

function readTableBlock(
  node: SequenceNode,
  context: BodyContext,
  depth: number,
): readonly Block[] {
  if (depth >= MAX_TABLE_DEPTH) {
    context.degradations.note(
      "nested-table",
      "A table sat inside another table's cell. Its text is kept as ordinary paragraphs; its own rows and columns are not.",
    );
    return flattenTable(node, context, depth);
  }

  return [{ kind: "table", table: readTable(node, context, depth + 1) }];
}

/** A nested table's paragraphs, in order, with the grid around them dropped. */
function flattenTable(
  node: SequenceNode,
  context: BodyContext,
  depth: number,
): readonly Block[] {
  return node.children
    .filter((row) => row.name === "w:tr")
    .flatMap((row) =>
      row.children
        .filter((cell) => cell.name === "w:tc")
        .flatMap((cell) => readBlocks(cell.children, context, depth)),
    );
}

function readTable(
  node: SequenceNode,
  context: BodyContext,
  depth: number,
): TableProfile {
  const rows = node.children
    .filter((row) => row.name === "w:tr")
    .map((row) => readRow(row, context, depth));

  return {
    columns: readTableGrid(node),
    rows: withRowSpans(rows),
    borders: readTableBorders(node),
    cellMargins: readCellMargins(node),
  };
}

function readRow(
  node: SequenceNode,
  context: BodyContext,
  depth: number,
): TableRow {
  return {
    repeatsAsHeader: readRowIsHeader(node),
    cells: node.children
      .filter((cell) => cell.name === "w:tc")
      .map((cell) => readCell(cell, context, depth)),
  };
}

function readCell(
  node: SequenceNode,
  context: BodyContext,
  depth: number,
): TableCell {
  const properties = readCellProperties(node);

  if (properties.verticalAlign !== "top") {
    context.degradations.note(
      "table-cell-alignment",
      `A cell asks to sit at the ${properties.verticalAlign} of its row. LaTeX aligns a whole column rather than one cell, so it is set at the top.`,
    );
  }

  return {
    ...properties,
    // Filled in once the whole table is read: how far a merge reaches is a
    // property of the rows under a cell, which the cell itself cannot see.
    rowSpan: 1,
    blocks: readBlocks(node.children, context, depth),
  };
}

/**
 * How many rows each vertically merged cell covers.
 *
 * Word says only where a merge starts and which cells continue it, so the
 * extent has to be counted afterwards — and counted by grid column, because a
 * cell spanning two columns shifts every cell to its right out of step with the
 * row above.
 */
function withRowSpans(rows: readonly TableRow[]): readonly TableRow[] {
  const columns = rows.map((row) => gridColumnsOf(row));

  const continuesAt = (row: number, column: number): boolean =>
    (rows[row]?.cells ?? []).some(
      (cell, index) =>
        columns[row]?.[index] === column && cell.verticalMerge === "continue",
    );

  return rows.map((row, index) => ({
    ...row,
    cells: row.cells.map((cell, cellIndex) => {
      if (cell.verticalMerge !== "restart") {
        return cell;
      }
      const column = columns[index]?.[cellIndex] ?? 0;

      let rowSpan = 1;
      while (continuesAt(index + rowSpan, column)) {
        rowSpan += 1;
      }
      return { ...cell, rowSpan };
    }),
  }));
}

/** The grid column each cell in a row starts at, accounting for its spans. */
function gridColumnsOf(row: TableRow): readonly number[] {
  const starts: number[] = [];
  let column = 0;

  for (const cell of row.cells) {
    starts.push(column);
    column += cell.columnSpan;
  }

  return starts;
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
    runs: mergeAdjacent(collectRuns(node.children, effective, context)),
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
  paragraph: EffectiveStyle,
  context: BodyContext,
): readonly Run[] {
  const runs: Run[] = [];

  for (const node of nodes) {
    switch (node.name) {
      case "w:r":
        runs.push(...readRun(node, paragraph, context));
        break;
      case "w:hyperlink":
      case "w:smartTag":
      case "w:ins":
      case "w:moveTo":
        runs.push(...collectRuns(node.children, paragraph, context));
        break;
      default:
        break;
    }
  }

  return runs;
}

/**
 * One `w:r` as the runs it holds.
 *
 * A run is usually either text or a picture, but the schema allows both, and
 * the children are walked in order rather than partitioned so that a picture
 * between two words stays between them. Text accumulates until a picture
 * interrupts it, which is also what keeps a run of pure text a single run.
 */
function readRun(
  node: SequenceNode,
  paragraph: EffectiveStyle,
  context: BodyContext,
): readonly Run[] {
  const { sheet, relationships, degradations } = context;
  const properties = findChild(node, "w:rPr");
  const runStyleId = attributeOf(findChild(properties, "w:rStyle"), "w:val");
  const style = resolveRun(
    sheet,
    paragraph,
    runStyleId,
    readTextStyle(propertiesOf(properties), sheet.theme),
  );

  const runs: Run[] = [];
  let text = "";

  const flush = () => {
    if (text !== "") {
      runs.push({ kind: "text", text, style });
      text = "";
    }
  };

  for (const child of node.children) {
    if (child.name !== "w:drawing") {
      text += readRunContent(child);
      continue;
    }
    const image = readDrawing(child, relationships, degradations);
    if (image) {
      flush();
      runs.push({ kind: "image", image });
    }
  }

  flush();
  return runs;
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
    // w:object and w:rPr contribute no text; w:drawing is read as a run.
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
function mergeAdjacent(runs: readonly Run[]): readonly Run[] {
  return runs.reduce<Run[]>((merged, run) => {
    const previous = merged.at(-1);
    if (
      previous?.kind === "text" &&
      run.kind === "text" &&
      sameStyle(previous.style, run.style)
    ) {
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
