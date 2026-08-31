import type { Block } from "@/lib/extract/body";
import type {
  Borders,
  ColumnWidth,
  TableCell,
  TableProfile,
  TableRow,
} from "@/lib/extract/table";
import { mm, trim } from "./format";

/**
 * A `TableProfile` written as LaTeX.
 *
 * Word gives every column a width and lets any cell reach across rows and
 * columns; LaTeX gives a table a column specification decided once, up front,
 * and asks each spanning cell to restate it. Most of what follows is that
 * translation.
 */

/** The column type the generated preamble defines, weighted by `\hsize`. */
const COLUMN_TYPE = "D";

/**
 * Word repeats a header row on every page a table crosses. `tabularx` cannot
 * break across pages at all and `longtable` cannot size a column to the space
 * that is left, so a table that does both needs the package that is both.
 */
const BREAKING_ENVIRONMENT = "xltabular";
const FIXED_ENVIRONMENT = "tabularx";

/** Cells are separated from the rules by this on each side, as booktabs does. */
const TABCOLSEP_ALLOWANCE = "2\\tabcolsep";

/** Holds the surrounding value of `\tabcolsep` while a table changes it. */
const SAVED_COLSEP = "doctotexcolsep";

export interface TableNeeds {
  readonly tables: boolean;
  /** `w:shd` on any cell, which needs xcolor's table option. */
  readonly cellColours: boolean;
  /** `w:vMerge`, which is the only thing that needs multirow. */
  readonly rowSpans: boolean;
  /** A repeating header row, which is the only thing that needs xltabular. */
  readonly breakingTables: boolean;
  /** Rules drawn with booktabs rather than `\hline`. */
  readonly booktabs: boolean;
}

export const NO_TABLES: TableNeeds = {
  tables: false,
  cellColours: false,
  rowSpans: false,
  breakingTables: false,
  booktabs: false,
};

/** What the tables in a document ask the preamble for, and nothing more. */
export function tableNeedsOf(blocks: readonly Block[]): TableNeeds {
  const tables = tablesIn(blocks);
  if (tables.length === 0) {
    return NO_TABLES;
  }

  const cells = tables.flatMap((table) =>
    table.rows.flatMap((row) => row.cells),
  );

  return {
    tables: true,
    cellColours: cells.some((cell) => cell.shadingHex !== undefined),
    rowSpans: cells.some((cell) => cell.rowSpan > 1),
    breakingTables: tables.some(breaksAcrossPages),
    booktabs: tables.some((table) => !hasVerticalRules(table)),
  };
}

function tablesIn(blocks: readonly Block[]): readonly TableProfile[] {
  return blocks.flatMap((block) =>
    block.kind === "table"
      ? [
          block.table,
          ...block.table.rows.flatMap((row) =>
            row.cells.flatMap((cell) => tablesIn(cell.blocks)),
          ),
        ]
      : [],
  );
}

function breaksAcrossPages(table: TableProfile): boolean {
  return table.rows.some((row) => row.repeatsAsHeader);
}

/**
 * The preamble a document with tables needs.
 *
 * `\hsize` is what makes a `tabularx` column take a share of the width rather
 * than an equal slice of it; the shares are written into the column type so the
 * table itself reads as a list of proportions.
 */
export function tablePreamble(needs: TableNeeds): readonly string[] {
  if (!needs.tables) {
    return [];
  }

  const lines = [
    "%% The document contains tables.",
    `\\RequirePackage{${FIXED_ENVIRONMENT}}`,
  ];

  if (needs.breakingTables) {
    lines.push(
      "%% A table repeats a header row, which means it may cross a page.",
      `\\RequirePackage{${BREAKING_ENVIRONMENT}}`,
    );
  }
  if (needs.booktabs) {
    lines.push("\\RequirePackage{booktabs}");
  }
  if (needs.rowSpans) {
    lines.push("%% Cells merged downwards.", "\\RequirePackage{multirow}");
  }

  lines.push(
    `\\newlength{\\${SAVED_COLSEP}}`,
    "%% Column widths are proportions of the text width, as Word's are of the",
    "%% page. The factors in each table sum to its number of columns.",
    `\\newcolumntype{${COLUMN_TYPE}}[1]{>{\\hsize=#1\\hsize\\linewidth=\\hsize\\raggedright\\arraybackslash}X}`,
  );

  return lines;
}

/** Renders one cell's blocks; supplied by the caller so this file emits no runs. */
export type CellRenderer = (cell: TableCell) => string;

export function renderTable(
  table: TableProfile,
  renderCell: CellRenderer,
): readonly string[] {
  const columns = columnCountOf(table);
  if (columns === 0 || table.rows.length === 0) {
    return ["%% A table in the source document has no rows."];
  }

  const layout = layoutOf(table, columns);
  const environment = breaksAcrossPages(table)
    ? BREAKING_ENVIRONMENT
    : FIXED_ENVIRONMENT;

  return [
    ...cellPadding(table),
    `\\begin{${environment}}{\\textwidth}{${layout.spec}}`,
    ...rule(layout, "top"),
    ...renderRows(table, layout, renderCell),
    ...rule(layout, "bottom"),
    `\\end{${environment}}`,
    ...restorePadding(),
  ];
}

/**
 * Word pads inside the cell; LaTeX pads outside the rule, and `\tabcolsep` is
 * the nearest equivalent.
 *
 * It is saved and put back rather than set inside a group: a `longtable` — and
 * `xltabular` is one — has to sit at the outer paragraph level, so the braces
 * that would confine the change are exactly what it cannot be wrapped in.
 */
function cellPadding(table: TableProfile): readonly string[] {
  const sides = (table.cellMargins.leftMm + table.cellMargins.rightMm) / 2;
  return [
    `\\${SAVED_COLSEP}=\\tabcolsep`,
    `\\setlength{\\tabcolsep}{${mm(sides)}}`,
  ];
}

function restorePadding(): readonly string[] {
  return [`\\tabcolsep=\\${SAVED_COLSEP}`];
}

interface Layout {
  readonly spec: string;
  readonly weights: readonly number[];
  readonly columns: number;
  readonly verticalRules: boolean;
  readonly booktabs: boolean;
  readonly borders: Borders;
}

function layoutOf(table: TableProfile, columns: number): Layout {
  const weights = weightsOf(table.columns, columns);
  const verticalRules = hasVerticalRules(table);
  const separator = verticalRules ? "|" : "";

  const spec =
    separator +
    weights.map((weight) => `${COLUMN_TYPE}{${trim(weight)}}`).join(separator) +
    separator;

  return {
    spec,
    weights,
    columns,
    verticalRules,
    // booktabs draws no vertical rules at all, so a table that has them is
    // drawn the plain way rather than half in each style.
    booktabs: !verticalRules,
    borders: table.borders,
  };
}

/**
 * How wide each column is, as a share of the whole.
 *
 * `tabularx` divides the width equally unless told otherwise, so a table whose
 * grid says 20/80 comes out 50/50 without this. Columns Word left as `auto`
 * take an equal share of what the fixed ones leave.
 */
function weightsOf(
  declared: readonly ColumnWidth[],
  columns: number,
): readonly number[] {
  const widths = Array.from(
    { length: columns },
    (_, index) => declared[index] ?? { kind: "auto" as const },
  );

  const measured = widths.map((width) =>
    width.kind === "fixed"
      ? width.mm
      : width.kind === "percent"
        ? width.value
        : undefined,
  );

  const known = measured.filter(
    (value): value is number => value !== undefined,
  );
  if (known.length === 0) {
    return widths.map(() => 1);
  }

  // An unmeasured column is given the average of the measured ones rather than
  // nothing, which would collapse it to zero width and hide its text.
  const average = known.reduce((sum, value) => sum + value, 0) / known.length;
  const filled = measured.map((value) => value ?? average);
  const total = filled.reduce((sum, value) => sum + value, 0);

  // The factors must sum to the column count, which is what \hsize expects.
  return filled.map((value) => round((value / total) * columns));
}

function columnCountOf(table: TableProfile): number {
  const spanned = table.rows.map((row) =>
    row.cells.reduce((total, cell) => total + cell.columnSpan, 0),
  );

  return Math.max(table.columns.length, ...spanned, 0);
}

function hasVerticalRules(table: TableProfile): boolean {
  const { left, right, insideVertical } = table.borders;
  if (left ?? right ?? insideVertical) {
    return true;
  }

  return table.rows.some((row) =>
    row.cells.some((cell) => cell.borders.left ?? cell.borders.right),
  );
}

function renderRows(
  table: TableProfile,
  layout: Layout,
  renderCell: CellRenderer,
): readonly string[] {
  const lines: string[] = [];

  table.rows.forEach((row, index) => {
    lines.push(`${renderRow(row, layout, renderCell)} \\\\`);

    // A repeating header is declared once, after the rows that make it up.
    const isLastHeader =
      row.repeatsAsHeader && !table.rows[index + 1]?.repeatsAsHeader;

    lines.push(...separatorAfter(table, layout, index));
    if (isLastHeader) {
      lines.push("\\endhead");
    }
  });

  return lines;
}

function renderRow(
  row: TableRow,
  layout: Layout,
  renderCell: CellRenderer,
): string {
  let column = 0;

  return row.cells
    .map((cell) => {
      const at = column;
      column += cell.columnSpan;
      return renderCellAt(cell, at, layout, renderCell);
    })
    .join(" & ");
}

/**
 * One cell, with its merges spelled the way LaTeX spells them.
 *
 * A cell continuing a merge from above prints nothing: `\multirow` has already
 * set the text across this row, and printing it again would overprint it.
 */
function renderCellAt(
  cell: TableCell,
  column: number,
  layout: Layout,
  renderCell: CellRenderer,
): string {
  const shading = cell.shadingHex ? colourOf(cell.shadingHex) : "";
  const body =
    cell.verticalMerge === "continue"
      ? ""
      : merged(cell, renderCell(cell).trim());

  if (cell.columnSpan === 1) {
    return `${shading}${body}`;
  }
  return `\\multicolumn{${cell.columnSpan}}{${spanSpec(cell, column, layout)}}{${shading}${body}}`;
}

function merged(cell: TableCell, body: string): string {
  return cell.rowSpan > 1
    ? // `=` sets the box to the width of the column it lands in, which is what
      // lets merged text wrap the way the rest of the column does.
      `\\multirow{${cell.rowSpan}}{=}{${body}}`
    : body;
}

/**
 * The column specification a `\multicolumn` restates.
 *
 * `X` cannot appear here — tabularx has already divided the width by the time a
 * row is set — so the span is given the width its columns add up to.
 */
function spanSpec(cell: TableCell, column: number, layout: Layout): string {
  const share = layout.weights
    .slice(column, column + cell.columnSpan)
    .reduce((total, weight) => total + weight, 0);

  const fraction = trim(share / layout.columns);
  const edge = layout.verticalRules ? "|" : "";
  const width = `\\dimexpr ${fraction}\\textwidth-${TABCOLSEP_ALLOWANCE}\\relax`;

  return `${column === 0 ? edge : ""}>{\\raggedright\\arraybackslash}p{${width}}${edge}`;
}

function colourOf(hex: string): string {
  return `\\cellcolor[HTML]{${hex.replace("#", "")}}`;
}

/**
 * The rule under a row.
 *
 * A cell merged downwards has no rule under it — that is what being merged
 * means — so a table whose rows are otherwise separated needs `\cline` over the
 * columns either side of the merge rather than an `\hline` drawn through it.
 */
function separatorAfter(
  table: TableProfile,
  layout: Layout,
  index: number,
): readonly string[] {
  if (index === table.rows.length - 1) {
    return [];
  }

  const merged = mergedColumnsAfter(table, index);
  const underlined = table.borders.insideHorizontal
    ? allColumns(layout)
    : columnsWithBottomBorder(table.rows[index]);

  const drawn = underlined.filter((column) => !merged.has(column));
  if (drawn.length === 0) {
    return [];
  }
  if (drawn.length === layout.columns) {
    return [layout.booktabs ? "\\midrule" : "\\hline"];
  }

  return [
    rangesOf(drawn)
      .map(([from, to]) => `\\cline{${from}-${to}}`)
      .join(""),
  ];
}

/** The grid columns a vertical merge carries past this row. */
function mergedColumnsAfter(
  table: TableProfile,
  index: number,
): ReadonlySet<number> {
  const merged = new Set<number>();
  let column = 0;

  for (const cell of table.rows[index + 1]?.cells ?? []) {
    if (cell.verticalMerge === "continue") {
      for (let span = 0; span < cell.columnSpan; span += 1) {
        merged.add(column + span + 1);
      }
    }
    column += cell.columnSpan;
  }

  return merged;
}

function allColumns(layout: Layout): readonly number[] {
  return Array.from({ length: layout.columns }, (_, index) => index + 1);
}

function columnsWithBottomBorder(row: TableRow | undefined): readonly number[] {
  const columns: number[] = [];
  let column = 0;

  for (const cell of row?.cells ?? []) {
    for (let span = 0; span < cell.columnSpan; span += 1) {
      if (cell.borders.bottom) {
        columns.push(column + span + 1);
      }
    }
    column += cell.columnSpan;
  }

  return columns;
}

/** Consecutive columns collapsed into the ranges `\cline` takes. */
function rangesOf(
  columns: readonly number[],
): readonly (readonly [number, number])[] {
  const ranges: [number, number][] = [];

  for (const column of [...columns].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && last[1] === column - 1) {
      last[1] = column;
      continue;
    }
    ranges.push([column, column]);
  }

  return ranges;
}

function rule(layout: Layout, edge: "top" | "bottom"): readonly string[] {
  const border = edge === "top" ? layout.borders.top : layout.borders.bottom;
  if (!border) {
    return [];
  }
  if (!layout.booktabs) {
    return ["\\hline"];
  }
  return [edge === "top" ? "\\toprule" : "\\bottomrule"];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
