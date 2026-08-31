import { describe, expect, it } from "vitest";
import { findDescendant, parseSequence } from "@/lib/docx/sequence";
import {
  DEFAULT_CELL_MARGINS,
  readCellMargins,
  readCellProperties,
  readRowIsHeader,
  readTableBorders,
  readTableGrid,
  widthOf,
} from "./table";

function node(xml: string, name: string) {
  const found = findDescendant(
    parseSequence(
      `<w:root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${xml}</w:root>`,
    ),
    name,
  );
  if (!found) {
    throw new Error(`No ${name} in the test document.`);
  }
  return found;
}

function table(inner: string) {
  return node(`<w:tbl>${inner}</w:tbl>`, "w:tbl");
}

function cell(properties: string) {
  return node(`<w:tc><w:tcPr>${properties}</w:tcPr></w:tc>`, "w:tc");
}

describe("readTableGrid", () => {
  it("reads the column widths in millimetres", () => {
    const grid = readTableGrid(
      table(
        `<w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="2880"/></w:tblGrid>`,
      ),
    );

    expect(grid).toEqual([
      { kind: "fixed", mm: 25.4 },
      { kind: "fixed", mm: 50.8 },
    ]);
  });

  it("reads nothing from a table with no grid", () => {
    expect(readTableGrid(table(""))).toEqual([]);
  });
});

describe("widthOf", () => {
  // w:type decides what the number means; reading it as twips regardless turns
  // a half-width column into one 1.7mm across.
  const cases = [
    ["1440", "dxa", { kind: "fixed", mm: 25.4 }],
    ["2500", "pct", { kind: "percent", value: 50 }],
    ["0", "auto", { kind: "auto" }],
    [undefined, "dxa", { kind: "auto" }],
  ] as const;

  it.each(cases)("reads %s of type %s", (value, type, expected) => {
    expect(widthOf(value, type)).toEqual(expected);
  });
});

describe("readTableBorders", () => {
  const bordered = (inner: string) =>
    readTableBorders(
      table(`<w:tblPr><w:tblBorders>${inner}</w:tblBorders></w:tblPr>`),
    );

  // w:sz is eighths of a point here and half-points inside w:rPr; the same
  // attribute name means two different units depending on where it sits.
  it("reads the width in eighths of a point", () => {
    const borders = bordered(
      `<w:top w:val="single" w:sz="16" w:color="333333"/>`,
    );

    expect(borders.top).toEqual({
      style: "single",
      widthPt: 2,
      colorHex: "#333333",
    });
  });

  it("reads the inside rules apart from the outer edges", () => {
    const borders = bordered(
      `<w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/>`,
    );

    expect(borders.insideHorizontal).toBeDefined();
    expect(borders.insideVertical).toBeDefined();
    expect(borders.top).toBeUndefined();
  });

  it("prefers w:start over w:left, which is the older spelling", () => {
    const borders = bordered(
      `<w:start w:val="double" w:sz="8"/><w:left w:val="single" w:sz="8"/>`,
    );

    expect(borders.left?.style).toBe("double");
  });

  // An edge switched off and one never mentioned draw the same, so neither is
  // recorded as a border of no width.
  it("leaves an edge of w:val=nil undrawn", () => {
    expect(bordered(`<w:top w:val="nil"/>`).top).toBeUndefined();
  });

  it("reads nothing from a table that declares no borders", () => {
    expect(readTableBorders(table(""))).toEqual({});
  });
});

describe("readCellMargins", () => {
  it("reads the padding in millimetres", () => {
    const margins = readCellMargins(
      table(
        `<w:tblPr><w:tblCellMar>` +
          `<w:top w:w="57" w:type="dxa"/><w:start w:w="108" w:type="dxa"/>` +
          `<w:bottom w:w="57" w:type="dxa"/><w:end w:w="108" w:type="dxa"/>` +
          `</w:tblCellMar></w:tblPr>`,
      ),
    );

    expect(margins).toEqual({
      topMm: 1.01,
      bottomMm: 1.01,
      leftMm: 1.9,
      rightMm: 1.9,
    });
  });

  // Word's default is not zero, and a table generated with zero padding has its
  // text touching its rules.
  it("falls back to Word's own default", () => {
    expect(readCellMargins(table(""))).toEqual(DEFAULT_CELL_MARGINS);
  });
});

describe("readCellProperties", () => {
  it("reads a horizontal span", () => {
    expect(cellProperties(`<w:gridSpan w:val="3"/>`).columnSpan).toBe(3);
  });

  it("treats a cell with no span as covering one column", () => {
    expect(cellProperties("").columnSpan).toBe(1);
  });

  it("tells the start of a vertical merge from its continuation", () => {
    expect(cellProperties(`<w:vMerge w:val="restart"/>`).verticalMerge).toBe(
      "restart",
    );
    expect(cellProperties(`<w:vMerge w:val="continue"/>`).verticalMerge).toBe(
      "continue",
    );
  });

  // An omitted w:val means "continue", per the schema default.
  it("reads a bare w:vMerge as a continuation", () => {
    expect(cellProperties(`<w:vMerge/>`).verticalMerge).toBe("continue");
  });

  it("reads the shading fill", () => {
    expect(
      cellProperties(`<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>`)
        .shadingHex,
    ).toBe("#D9E2F3");
  });

  // "auto" means "pick something readable", which is an instruction rather
  // than a colour.
  it("leaves an automatic fill unshaded", () => {
    expect(cellProperties(`<w:shd w:fill="auto"/>`).shadingHex).toBeUndefined();
  });

  it("reads the vertical alignment, defaulting to the top", () => {
    expect(cellProperties(`<w:vAlign w:val="center"/>`).verticalAlign).toBe(
      "center",
    );
    expect(cellProperties("").verticalAlign).toBe("top");
  });

  it("reads borders declared on the cell itself", () => {
    expect(
      cellProperties(
        `<w:tcBorders><w:bottom w:val="single" w:sz="8"/></w:tcBorders>`,
      ).borders.bottom,
    ).toBeDefined();
  });
});

function cellProperties(properties: string) {
  return readCellProperties(cell(properties));
}

describe("readRowIsHeader", () => {
  it("reads w:tblHeader as a repeating header row", () => {
    expect(
      readRowIsHeader(
        node(`<w:tr><w:trPr><w:tblHeader/></w:trPr></w:tr>`, "w:tr"),
      ),
    ).toBe(true);
  });

  it("reads w:tblHeader switched off as an ordinary row", () => {
    expect(
      readRowIsHeader(
        node(`<w:tr><w:trPr><w:tblHeader w:val="0"/></w:trPr></w:tr>`, "w:tr"),
      ),
    ).toBe(false);
  });

  it("reads a row with no properties as an ordinary row", () => {
    expect(readRowIsHeader(node(`<w:tr/>`, "w:tr"))).toBe(false);
  });
});
