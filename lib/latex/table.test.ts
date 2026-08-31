import { describe, expect, it } from "vitest";
import type { Block } from "@/lib/extract/body";
import {
  DEFAULT_CELL_MARGINS,
  type Border,
  type Borders,
  type ColumnWidth,
  type TableCell,
  type TableProfile,
  type TableRow,
} from "@/lib/extract/table";
import { renderTable, tableNeedsOf, tablePreamble } from "./table";

const RULE: Border = { style: "single", widthPt: 1 };

function cell(text: string, over: Partial<TableCell> = {}): TableCell {
  return {
    blocks: [],
    columnSpan: 1,
    verticalMerge: "none",
    rowSpan: 1,
    borders: {},
    verticalAlign: "top",
    ...over,
    // Carried on the cell so the fake renderer below can find it again.
    ...(text ? { shadingHex: over.shadingHex } : {}),
  };
}

function row(cells: readonly TableCell[], repeatsAsHeader = false): TableRow {
  return { cells, repeatsAsHeader };
}

function table(
  rows: readonly TableRow[],
  over: Partial<TableProfile> = {},
): TableProfile {
  return {
    columns: [],
    rows,
    borders: {},
    cellMargins: DEFAULT_CELL_MARGINS,
    ...over,
  };
}

const fixed = (mm: number): ColumnWidth => ({ kind: "fixed", mm });

/** Cells carry no text of their own here, so the position stands in for it. */
function render(profile: TableProfile): string {
  let index = 0;
  return renderTable(profile, () => `c${(index += 1)}`).join("\n");
}

function blocksOf(profile: TableProfile): readonly Block[] {
  return [{ kind: "table", table: profile }];
}

describe("column widths", () => {
  // tabularx divides the width equally unless told otherwise, so a table whose
  // grid says 20/80 comes out 50/50 without this.
  it("turns the grid into factors that sum to the column count", () => {
    const tex = render(
      table([row([cell("a"), cell("b")])], {
        columns: [fixed(20), fixed(60)],
      }),
    );

    expect(tex).toContain("{D{0.5}D{1.5}}");
  });

  it("divides the width equally where the grid says nothing", () => {
    const tex = render(table([row([cell("a"), cell("b")])]));

    expect(tex).toContain("{D{1}D{1}}");
  });

  // A column left at zero width would hide its text entirely.
  it("gives an auto column the average of the measured ones", () => {
    const tex = render(
      table([row([cell("a"), cell("b")])], {
        columns: [fixed(30), { kind: "auto" }],
      }),
    );

    expect(tex).toContain("{D{1}D{1}}");
  });

  it("counts the columns a spanning cell covers", () => {
    const tex = render(
      table([row([cell("a", { columnSpan: 3 })])], { columns: [] }),
    );

    expect(tex).toContain("{D{1}D{1}D{1}}");
  });
});

describe("rules", () => {
  it("draws booktabs rules where the table has no vertical ones", () => {
    const tex = render(
      table([row([cell("a")]), row([cell("b")])], {
        borders: { top: RULE, bottom: RULE, insideHorizontal: RULE },
      }),
    );

    expect(tex).toContain("\\toprule");
    expect(tex).toContain("\\midrule");
    expect(tex).toContain("\\bottomrule");
    expect(tex).not.toContain("\\hline");
  });

  // booktabs draws no vertical rules at all, so a table that has them is drawn
  // the plain way rather than half in each style.
  it("falls back to hline where the table rules its columns", () => {
    const tex = render(
      table([row([cell("a")]), row([cell("b")])], {
        borders: {
          top: RULE,
          bottom: RULE,
          insideHorizontal: RULE,
          insideVertical: RULE,
        },
      }),
    );

    expect(tex).toContain("\\hline");
    expect(tex).not.toContain("rule");
    expect(tex).toContain("{|D{1}|}");
  });

  it("draws no rules where the table declares none", () => {
    const tex = render(table([row([cell("a")]), row([cell("b")])]));

    expect(tex).not.toContain("hline");
    expect(tex).not.toContain("rule");
  });

  // A merged cell has no rule under it: that is what being merged means.
  it("uses cline so a rule does not cut through a vertical merge", () => {
    const tex = render(
      table(
        [
          row([cell("a", { verticalMerge: "restart", rowSpan: 2 }), cell("b")]),
          row([cell("", { verticalMerge: "continue" }), cell("c")]),
        ],
        { borders: { insideHorizontal: RULE, insideVertical: RULE } },
      ),
    );

    expect(tex).toContain("\\cline{2-2}");
  });
});

describe("merges", () => {
  it("writes a horizontal span as multicolumn", () => {
    const tex = render(
      table([row([cell("a", { columnSpan: 2 }), cell("b")])], {
        columns: [fixed(10), fixed(10), fixed(10)],
      }),
    );

    expect(tex).toContain("\\multicolumn{2}{");
    // Two of three columns, so two thirds of the width.
    expect(tex).toContain("0.67\\textwidth");
  });

  it("writes a vertical merge as multirow", () => {
    const tex = render(
      table([
        row([cell("a", { verticalMerge: "restart", rowSpan: 3 })]),
        row([cell("", { verticalMerge: "continue" })]),
        row([cell("", { verticalMerge: "continue" })]),
      ]),
    );

    expect(tex).toContain("\\multirow{3}{=}{");
  });

  // \multirow has already set the text across this row; printing it again
  // would overprint it.
  it("leaves a continuing cell empty", () => {
    const tex = render(
      table([
        row([cell("a", { verticalMerge: "restart", rowSpan: 2 }), cell("b")]),
        row([cell("", { verticalMerge: "continue" }), cell("c")]),
      ]),
    );

    expect(tex).toContain(" & c3 \\\\");
  });
});

describe("headers and shading", () => {
  // Word repeats a header row on every page the table crosses; tabularx cannot
  // break across pages at all.
  it("uses xltabular and endhead for a repeating header", () => {
    const tex = render(table([row([cell("h")], true), row([cell("d")])]));

    expect(tex).toContain("\\begin{xltabular}");
    expect(tex).toContain("\\endhead");
  });

  it("uses tabularx where no row repeats", () => {
    const tex = render(table([row([cell("a")])]));

    expect(tex).toContain("\\begin{tabularx}");
    expect(tex).not.toContain("endhead");
  });

  it("shades a cell from its fill colour", () => {
    const tex = render(table([row([cell("a", { shadingHex: "#D9E2F3" })])]));

    expect(tex).toContain("\\cellcolor[HTML]{D9E2F3}");
  });

  it("says so rather than emitting an empty table", () => {
    expect(render(table([]))).toContain("%%");
  });
});

describe("cell padding", () => {
  // xltabular is a longtable, which has to sit at the outer paragraph level, so
  // the braces that would confine the change cannot be used.
  it("puts the surrounding value back after the table", () => {
    const tex = render(table([row([cell("a")])]));

    expect(tex).toContain("\\doctotexcolsep=\\tabcolsep");
    expect(tex).toContain("\\tabcolsep=\\doctotexcolsep");
  });
});

describe("tableNeedsOf", () => {
  it("asks for nothing where the document has no table", () => {
    expect(tableNeedsOf([])).toMatchObject({ tables: false });
  });

  it("asks for multirow only where a cell is merged downwards", () => {
    const plain = tableNeedsOf(blocksOf(table([row([cell("a")])])));
    const merged = tableNeedsOf(
      blocksOf(
        table([
          row([cell("a", { verticalMerge: "restart", rowSpan: 2 })]),
          row([cell("", { verticalMerge: "continue" })]),
        ]),
      ),
    );

    expect(plain.rowSpans).toBe(false);
    expect(merged.rowSpans).toBe(true);
  });

  it("asks for xltabular only where a header repeats", () => {
    expect(
      tableNeedsOf(blocksOf(table([row([cell("a")], true)]))).breakingTables,
    ).toBe(true);
    expect(
      tableNeedsOf(blocksOf(table([row([cell("a")])]))).breakingTables,
    ).toBe(false);
  });

  it("asks for cell colours only where a cell is shaded", () => {
    expect(
      tableNeedsOf(
        blocksOf(table([row([cell("a", { shadingHex: "#FFF000" })])])),
      ).cellColours,
    ).toBe(true);
  });
});

describe("tablePreamble", () => {
  it("emits nothing for a document with no tables", () => {
    expect(tablePreamble(tableNeedsOf([]))).toEqual([]);
  });

  it("loads only the packages the tables actually need", () => {
    const plain = tablePreamble(
      tableNeedsOf(blocksOf(table([row([cell("a")])]))),
    ).join("\n");

    expect(plain).toContain("\\RequirePackage{tabularx}");
    expect(plain).not.toContain("multirow");
    expect(plain).not.toContain("xltabular");
  });

  it("defines the weighted column type the tables use", () => {
    const lines = tablePreamble(
      tableNeedsOf(blocksOf(table([row([cell("a")])]))),
    ).join("\n");

    expect(lines).toContain("\\newcolumntype{D}[1]{");
    expect(lines).toContain("\\hsize=#1\\hsize");
  });
});

describe("borders", () => {
  const withBorders = (borders: Borders) =>
    render(table([row([cell("a")])], { borders }));

  it("rules the outside edges only where the table declares them", () => {
    expect(withBorders({ top: RULE })).toContain("\\toprule");
    expect(withBorders({})).not.toContain("toprule");
  });
});
