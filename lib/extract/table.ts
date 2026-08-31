import { attributeOf, findChild, type SequenceNode } from "@/lib/docx/sequence";
import type { Block } from "./body";
import { toColorHex, toInteger, twipsToMm } from "./units";

/**
 * A `w:tbl` as everything the generator needs and nothing it does not.
 *
 * Word measures a table four ways at once — the grid in twips, the cell widths
 * in twips or fiftieths of a percent, the borders in eighths of a point, the
 * padding in twips again — and every one of those is converted here so that no
 * raw OOXML measure reaches `lib/latex`.
 */

export type BorderStyle =
  "none" | "single" | "double" | "dashed" | "dotted" | "thick";

export interface Border {
  readonly style: BorderStyle;
  readonly widthPt: number;
  readonly colorHex?: string;
}

export interface Borders {
  readonly top?: Border;
  readonly bottom?: Border;
  readonly left?: Border;
  readonly right?: Border;
  /** Declared by the table only: the rules between its rows and columns. */
  readonly insideHorizontal?: Border;
  readonly insideVertical?: Border;
}

/**
 * `w:tblGrid` is in twips, but a cell may override its share as a percentage of
 * the table, and `auto` means the width is whatever the content turns out to
 * need. Folding all three into a number would make the last one a lie.
 */
export type ColumnWidth =
  | { readonly kind: "fixed"; readonly mm: number }
  | { readonly kind: "percent"; readonly value: number }
  | { readonly kind: "auto" };

export type CellAlign = "top" | "center" | "bottom";

/**
 * Word merges cells downwards by marking the first `restart` and every cell
 * under it `continue`. The continuing cells are kept rather than dropped: LaTeX
 * still needs a column in that position, it just needs it empty.
 */
export type VerticalMerge = "none" | "restart" | "continue";

export interface TableCell {
  readonly blocks: readonly Block[];
  /** Grid columns covered, from `w:gridSpan`. */
  readonly columnSpan: number;
  readonly verticalMerge: VerticalMerge;
  /** Rows covered. Meaningful only where `verticalMerge` is `restart`. */
  readonly rowSpan: number;
  readonly borders: Borders;
  readonly shadingHex?: string;
  readonly verticalAlign: CellAlign;
}

export interface TableRow {
  readonly cells: readonly TableCell[];
  /** `w:tblHeader` — repeated at the top of every page the table crosses. */
  readonly repeatsAsHeader: boolean;
}

export interface CellMargins {
  readonly topMm: number;
  readonly bottomMm: number;
  readonly leftMm: number;
  readonly rightMm: number;
}

export interface TableProfile {
  readonly columns: readonly ColumnWidth[];
  readonly rows: readonly TableRow[];
  readonly borders: Borders;
  readonly cellMargins: CellMargins;
}

/** Word's default cell padding: nothing above or below, 0.19cm either side. */
export const DEFAULT_CELL_MARGINS: CellMargins = {
  topMm: 0,
  bottomMm: 0,
  leftMm: 1.9,
  rightMm: 1.9,
};

/** `w:sz` inside a border is in eighths of a point, not the half-points of `w:rPr`. */
const EIGHTHS_PER_POINT = 8;

/** `w:type="pct"` counts in fiftieths of a percent, so 5000 is the whole width. */
const PERCENT_UNITS = 50;

const BORDER_STYLES: Readonly<Record<string, BorderStyle>> = {
  nil: "none",
  none: "none",
  single: "single",
  thick: "thick",
  double: "double",
  dotted: "dotted",
  dashed: "dashed",
  dotDash: "dashed",
  dotDotDash: "dashed",
  dashSmallGap: "dashed",
  dashDotStroked: "dashed",
  triple: "double",
  thinThickSmallGap: "double",
  thickThinSmallGap: "double",
  wave: "single",
};

const CELL_ALIGNS: Readonly<Record<string, CellAlign>> = {
  top: "top",
  center: "center",
  bottom: "bottom",
};

/** The four edges, by the name Word gives each in a borders container. */
const EDGES = [
  ["top", ["w:top"]],
  ["bottom", ["w:bottom"]],
  // w:start and w:end are the newer spellings and win where both appear.
  ["left", ["w:start", "w:left"]],
  ["right", ["w:end", "w:right"]],
  ["insideHorizontal", ["w:insideH"]],
  ["insideVertical", ["w:insideV"]],
] as const;

export function readTableGrid(table: SequenceNode): readonly ColumnWidth[] {
  const grid = findChild(table, "w:tblGrid");
  if (!grid) {
    return [];
  }

  return grid.children
    .filter((node) => node.name === "w:gridCol")
    .map((node) => widthOf(attributeOf(node, "w:w"), "dxa"));
}

export function readTableBorders(table: SequenceNode): Borders {
  return readBorders(findChild(findChild(table, "w:tblPr"), "w:tblBorders"));
}

/**
 * `w:tblCellMar` is padding inside every cell. Word's default is not zero, and
 * a table generated with zero padding has its text touching its rules.
 */
export function readCellMargins(table: SequenceNode): CellMargins {
  const margins = findChild(findChild(table, "w:tblPr"), "w:tblCellMar");
  if (!margins) {
    return DEFAULT_CELL_MARGINS;
  }

  return {
    topMm: marginOf(margins, "w:top") ?? DEFAULT_CELL_MARGINS.topMm,
    bottomMm: marginOf(margins, "w:bottom") ?? DEFAULT_CELL_MARGINS.bottomMm,
    leftMm:
      marginOf(margins, "w:start") ??
      marginOf(margins, "w:left") ??
      DEFAULT_CELL_MARGINS.leftMm,
    rightMm:
      marginOf(margins, "w:end") ??
      marginOf(margins, "w:right") ??
      DEFAULT_CELL_MARGINS.rightMm,
  };
}

function marginOf(margins: SequenceNode, name: string): number | undefined {
  const twips = toInteger(attributeOf(findChild(margins, name), "w:w"));
  return twips === undefined ? undefined : twipsToMm(twips);
}

export function readRowIsHeader(row: SequenceNode): boolean {
  const properties = findChild(row, "w:trPr");
  const header = findChild(properties, "w:tblHeader");
  if (!header) {
    return false;
  }
  // Present with no value means on, like every other OOXML toggle.
  return attributeOf(header, "w:val") !== "0";
}

/** Everything about a cell except what is inside it. */
export interface CellProperties {
  readonly columnSpan: number;
  readonly verticalMerge: VerticalMerge;
  readonly borders: Borders;
  readonly shadingHex?: string;
  readonly verticalAlign: CellAlign;
}

export function readCellProperties(cell: SequenceNode): CellProperties {
  const properties = findChild(cell, "w:tcPr");

  return {
    columnSpan:
      toInteger(attributeOf(findChild(properties, "w:gridSpan"), "w:val")) ?? 1,
    verticalMerge: readVerticalMerge(properties),
    borders: readBorders(findChild(properties, "w:tcBorders")),
    shadingHex: readShading(findChild(properties, "w:shd")),
    verticalAlign:
      CELL_ALIGNS[
        attributeOf(findChild(properties, "w:vAlign"), "w:val") ?? ""
      ] ?? "top",
  };
}

function readVerticalMerge(
  properties: SequenceNode | undefined,
): VerticalMerge {
  const merge = findChild(properties, "w:vMerge");
  if (!merge) {
    return "none";
  }
  // An omitted value means "continue", per the schema default.
  return attributeOf(merge, "w:val") === "restart" ? "restart" : "continue";
}

/**
 * `w:fill` is the background; `w:val` is a pattern over it. Only the fill is
 * carried — a LaTeX cell has no equivalent of a 25% diagonal hatch, and
 * approximating one with its base colour would be inventing a shade.
 */
function readShading(shading: SequenceNode | undefined): string | undefined {
  const fill = attributeOf(shading, "w:fill");
  return fill === "auto" ? undefined : toColorHex(fill);
}

function readBorders(container: SequenceNode | undefined): Borders {
  if (!container) {
    return {};
  }

  const borders: Record<string, Border | undefined> = {};
  for (const [edge, names] of EDGES) {
    const node = names
      .map((name) => findChild(container, name))
      .find((found) => found !== undefined);
    const border = node && readBorder(node);
    if (border) {
      borders[edge] = border;
    }
  }

  return borders;
}

function readBorder(node: SequenceNode): Border | undefined {
  const style = BORDER_STYLES[attributeOf(node, "w:val") ?? ""] ?? "single";
  if (style === "none") {
    // Kept out rather than recorded as a border of no width: an edge Word
    // explicitly switched off and one it never mentioned draw the same.
    return undefined;
  }

  const eighths = toInteger(attributeOf(node, "w:sz")) ?? EIGHTHS_PER_POINT;

  return {
    style,
    widthPt: round(eighths / EIGHTHS_PER_POINT),
    colorHex: toColorHex(attributeOf(node, "w:color")),
  };
}

/** A `w:tblW` or `w:tcW` pair, whose meaning depends on its `w:type`. */
export function widthOf(
  value: string | undefined,
  type: string | undefined,
): ColumnWidth {
  const measure = toInteger(value);
  if (measure === undefined || type === "auto" || type === "nil") {
    return { kind: "auto" };
  }
  if (type === "pct") {
    return { kind: "percent", value: round(measure / PERCENT_UNITS) };
  }
  return { kind: "fixed", mm: twipsToMm(measure) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
