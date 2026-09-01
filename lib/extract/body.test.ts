import { describe, expect, it } from "vitest";
import {
  countStyleUsage,
  extractBlocks,
  paragraphsOf,
  type BodyContext,
  type Paragraph,
  type TextRun,
} from "./body";
import { parseRelationships, type Relationships } from "./media";
import { parseNumbering, type Numbering } from "./numbering";
import { collectDegradations, type Degradations } from "./report";
import { parseStyleSheet, type StyleSheet } from "./styles";

const EMPTY_SHEET = parseStyleSheet(undefined, {});

function context(
  sheet: StyleSheet = EMPTY_SHEET,
  numbering: Numbering = new Map(),
  degradations: Degradations = collectDegradations(),
  relationships: Relationships = new Map(),
): BodyContext {
  return { sheet, numbering, degradations, relationships };
}

/** The text runs of a paragraph, which is what most of these assertions read. */
function textRuns(paragraph: Paragraph | undefined): readonly TextRun[] {
  return (paragraph?.runs ?? []).filter((run) => run.kind === "text");
}

const NUMBERING = parseNumbering(
  `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:abstractNum w:abstractNumId="0">
      <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
      <w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  </w:numbering>`,
  collectDegradations(),
);

function documentXml(body: string): string {
  return `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;
}

function stylesXml(inner: string): string {
  return `<?xml version="1.0"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${inner}</w:styles>`;
}

function paragraph(inner: string): string {
  return `<w:p>${inner}</w:p>`;
}

function read(
  xml: string,
  sheet: StyleSheet = EMPTY_SHEET,
): readonly Paragraph[] {
  return paragraphsOf(extractBlocks(documentXml(xml), context(sheet)));
}

function textOf(xml: string): readonly string[] {
  return read(xml).map((p) =>
    textRuns(p)
      .map((r) => r.text)
      .join(""),
  );
}

function blank(styleId?: string): Paragraph {
  return { styleId, style: {}, runs: [] };
}

describe("extractParagraphs", () => {
  it("reads paragraphs in document order", () => {
    const xml = [
      paragraph("<w:r><w:t>first</w:t></w:r>"),
      paragraph("<w:r><w:t>second</w:t></w:r>"),
      paragraph("<w:r><w:t>third</w:t></w:r>"),
    ].join("");

    expect(textOf(xml)).toEqual(["first", "second", "third"]);
  });

  it("reads the paragraph style id", () => {
    const xml = paragraph(
      `<w:pPr><w:pStyle w:val="Titre1"/></w:pPr><w:r><w:t>Heading</w:t></w:r>`,
    );

    expect(read(xml)[0]?.styleId).toBe("Titre1");
  });

  it("reports no style for a paragraph that declares none", () => {
    const xml = paragraph("<w:r><w:t>plain</w:t></w:r>");

    expect(read(xml)[0]?.styleId).toBeUndefined();
  });

  it("keeps an empty paragraph, which is a blank line in Word", () => {
    const xml = paragraph("") + paragraph("<w:r><w:t>after</w:t></w:r>");

    expect(textOf(xml)).toEqual(["", "after"]);
  });

  it("returns nothing when there is no body", () => {
    expect(extractBlocks("<nonsense/>", context())).toEqual([]);
  });
});

describe("countStyleUsage", () => {
  it("counts the paragraphs that point at each style", () => {
    const usage = countStyleUsage([
      blank("Titre1"),
      blank("Titre1"),
      blank("Titre3"),
    ]);

    expect(usage.get("Titre1")).toBe(2);
    expect(usage.get("Titre3")).toBe(1);
  });

  // A style declared in styles.xml but applied to nothing is the normal case
  // in documents whose headings were formatted by hand.
  it("reports nothing for a style no paragraph uses", () => {
    const usage = countStyleUsage([blank(), blank()]);

    expect(usage.get("Titre1")).toBeUndefined();
    expect(usage.size).toBe(0);
  });
});

describe("whitespace", () => {
  // Trimming this would weld the next run onto the previous word.
  it("preserves trailing space under xml:space=preserve", () => {
    const xml = paragraph(
      `<w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:t>world</w:t></w:r>`,
    );

    expect(textOf(xml)).toEqual(["Hello world"]);
  });

  it("preserves a leading space", () => {
    const xml = paragraph(
      `<w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r>`,
    );

    expect(textOf(xml)).toEqual(["Hello world"]);
  });

  it("reads a tab and a line break as characters", () => {
    const xml = paragraph(
      `<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r>`,
    );

    expect(textOf(xml)).toEqual(["a\tb\nc"]);
  });
});

describe("breaks", () => {
  it("tells a page break apart from a line break", () => {
    const xml = paragraph(
      `<w:r><w:t>a</w:t><w:br w:type="page"/><w:t>b</w:t></w:r>`,
    );

    expect(textOf(xml)).toEqual(["a\fb"]);
  });

  it("tells a column break apart from both", () => {
    const xml = paragraph(
      `<w:r><w:t>a</w:t><w:br w:type="column"/><w:t>b</w:t></w:r>`,
    );

    expect(textOf(xml)).toEqual(["a\vb"]);
  });

  it("reads a break with no type as a line break, per the schema default", () => {
    const xml = paragraph(
      `<w:r><w:t>a</w:t><w:br w:type=""/><w:t>b</w:t></w:r>`,
    );

    expect(textOf(xml)).toEqual(["a\nb"]);
  });
});

describe("run order", () => {
  // Reading w:r and w:hyperlink as separate collections reorders the sentence.
  it("keeps hyperlink text in place between surrounding runs", () => {
    const xml = paragraph(`
      <w:r><w:t xml:space="preserve">see </w:t></w:r>
      <w:hyperlink r:id="rId1"><w:r><w:t>the docs</w:t></w:r></w:hyperlink>
      <w:r><w:t xml:space="preserve"> for more</w:t></w:r>`);

    expect(textOf(xml)).toEqual(["see the docs for more"]);
  });

  it("descends through smartTag and ins wrappers", () => {
    const xml = paragraph(`
      <w:r><w:t xml:space="preserve">a </w:t></w:r>
      <w:smartTag><w:r><w:t xml:space="preserve">b </w:t></w:r></w:smartTag>
      <w:ins><w:r><w:t>c</w:t></w:r></w:ins>`);

    expect(textOf(xml)).toEqual(["a b c"]);
  });

  it("keeps text that was moved rather than inserted", () => {
    const xml = paragraph(`<w:moveTo><w:r><w:t>moved</w:t></w:r></w:moveTo>`);

    expect(textOf(xml)).toEqual(["moved"]);
  });
});

describe("run formatting", () => {
  it("reads bold and italic from the run properties", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>strong</w:t></w:r>`,
    );

    expect(textRuns(read(xml)[0])[0]?.style).toMatchObject({
      bold: true,
      italic: true,
    });
  });

  it("treats a toggle switched off as off", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>plain</w:t></w:r>`,
    );

    expect(textRuns(read(xml)[0])[0]?.style.bold).toBe(false);
  });

  it("leaves a property the run never mentions unset", () => {
    const xml = paragraph(`<w:r><w:t>plain</w:t></w:r>`);

    expect(textRuns(read(xml)[0])[0]?.style.bold).toBeUndefined();
  });

  it("reads colour and size", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:color w:val="2E74B5"/><w:sz w:val="32"/></w:rPr><w:t>big</w:t></w:r>`,
    );

    expect(textRuns(read(xml)[0])[0]?.style).toMatchObject({
      colorHex: "#2E74B5",
      fontSizePt: 16,
    });
  });

  it("reads any underline kind as underlined, and none as not", () => {
    const xml =
      paragraph(`<w:r><w:rPr><w:u w:val="wave"/></w:rPr><w:t>a</w:t></w:r>`) +
      paragraph(`<w:r><w:rPr><w:u w:val="none"/></w:rPr><w:t>b</w:t></w:r>`);

    const paragraphs = read(xml);
    expect(textRuns(paragraphs[0])[0]?.style.underline).toBe(true);
    expect(textRuns(paragraphs[1])[0]?.style.underline).toBe(false);
  });

  it("reads a double strike as a strike", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:dstrike/></w:rPr><w:t>gone</w:t></w:r>`,
    );

    expect(textRuns(read(xml)[0])[0]?.style.strike).toBe(true);
  });

  it("reads small caps and vertical alignment", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:smallCaps/><w:vertAlign w:val="superscript"/></w:rPr><w:t>1</w:t></w:r>`,
    );

    expect(textRuns(read(xml)[0])[0]?.style).toMatchObject({
      smallCaps: true,
      script: "superscript",
    });
  });

  // Word writes w:ascii and w:hAnsi together; Google Docs often writes only
  // the second, and reading the first alone reports no font at all.
  it("falls back to the high-ANSI font name", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:rFonts w:hAnsi="Calibri"/></w:rPr><w:t>a</w:t></w:r>`,
    );

    expect(textRuns(read(xml)[0])[0]?.style.fontFamily).toBe("Calibri");
  });

  // Word splits runs on every editing session, so identical formatting repeats.
  it("merges adjacent runs that share formatting", () => {
    const xml = paragraph(`<w:r><w:t>Hel</w:t></w:r><w:r><w:t>lo</w:t></w:r>`);

    expect(textRuns(read(xml)[0])).toEqual([
      { kind: "text", text: "Hello", style: {} },
    ]);
  });

  it("keeps runs apart when their formatting differs", () => {
    const xml = paragraph(
      `<w:r><w:t>plain</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>`,
    );

    expect(textRuns(read(xml)[0]).map((run) => run.text)).toEqual([
      "plain",
      "bold",
    ]);
  });

  // Merging erases the boundary for good, so a property the comparison cannot
  // see is a property silently lost.
  it("keeps runs apart when only their colour differs", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>red</w:t></w:r>` +
        `<w:r><w:rPr><w:color w:val="0000FF"/></w:rPr><w:t>blue</w:t></w:r>`,
    );

    expect(textRuns(read(xml)[0]).map((run) => run.text)).toEqual([
      "red",
      "blue",
    ]);
  });

  it("keeps runs apart when only their size differs", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>small</w:t></w:r>` +
        `<w:r><w:rPr><w:sz w:val="40"/></w:rPr><w:t>large</w:t></w:r>`,
    );

    expect(textRuns(read(xml)[0]).map((run) => run.text)).toEqual([
      "small",
      "large",
    ]);
  });
});

describe("paragraph formatting", () => {
  it("reads alignment, spacing and indentation the paragraph sets itself", () => {
    const xml = paragraph(
      `<w:pPr>
         <w:jc w:val="center"/>
         <w:spacing w:before="240" w:after="120"/>
         <w:ind w:left="720" w:firstLine="360"/>
       </w:pPr><w:r><w:t>a</w:t></w:r>`,
    );

    expect(read(xml)[0]?.style).toMatchObject({
      alignment: "center",
      spaceBeforePt: 12,
      spaceAfterPt: 6,
      indentLeftMm: 12.7,
      indentFirstLineMm: 6.35,
    });
  });

  it("reads a page break before the paragraph", () => {
    const xml = paragraph(
      `<w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>a</w:t></w:r>`,
    );

    expect(read(xml)[0]?.style.pageBreakBefore).toBe(true);
  });
});

describe("the cascade", () => {
  const sheet = parseStyleSheet(
    stylesXml(`
      <w:docDefaults>
        <w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault>
      </w:docDefaults>
      <w:style w:styleId="Titre1">
        <w:name w:val="heading 1"/>
        <w:rPr><w:b/><w:color w:val="2E74B5"/></w:rPr>
        <w:pPr><w:jc w:val="center"/></w:pPr>
      </w:style>
      <w:style w:styleId="Accent"><w:name w:val="accent"/><w:rPr><w:i/></w:rPr></w:style>`),
    {},
  );

  it("gives a run the style its paragraph points at", () => {
    const xml = paragraph(
      `<w:pPr><w:pStyle w:val="Titre1"/></w:pPr><w:r><w:t>Heading</w:t></w:r>`,
    );

    expect(textRuns(read(xml, sheet)[0])[0]?.style).toMatchObject({
      bold: true,
      colorHex: "#2E74B5",
      fontSizePt: 10,
    });
  });

  // The whole point of completing the cascade: a paragraph's own w:pPr is the
  // level Word writes most, and it used to be dropped.
  it("lets the paragraph's own properties override its style", () => {
    const xml = paragraph(
      `<w:pPr><w:pStyle w:val="Titre1"/><w:jc w:val="right"/></w:pPr>` +
        `<w:r><w:t>Heading</w:t></w:r>`,
    );

    expect(read(xml, sheet)[0]?.style.alignment).toBe("right");
  });

  it("lets a run turn off a property its paragraph style switched on", () => {
    const xml = paragraph(
      `<w:pPr><w:pStyle w:val="Titre1"/></w:pPr>` +
        `<w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>light</w:t></w:r>`,
    );

    expect(textRuns(read(xml, sheet)[0])[0]?.style.bold).toBe(false);
  });

  it("applies a character style between the paragraph and the run", () => {
    const xml = paragraph(
      `<w:pPr><w:pStyle w:val="Titre1"/></w:pPr>` +
        `<w:r><w:rPr><w:rStyle w:val="Accent"/></w:rPr><w:t>slanted</w:t></w:r>`,
    );

    expect(textRuns(read(xml, sheet)[0])[0]?.style).toMatchObject({
      bold: true,
      italic: true,
    });
  });

  // w:pPr/w:rPr formats the paragraph mark itself, not the text inside it.
  it("does not read the paragraph mark's formatting onto its runs", () => {
    const xml = paragraph(
      `<w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>plain</w:t></w:r>`,
    );

    expect(textRuns(read(xml, sheet)[0])[0]?.style.bold).toBeUndefined();
  });
});

describe("list membership", () => {
  function listed(xml: string, sheet: StyleSheet = EMPTY_SHEET) {
    return paragraphsOf(
      extractBlocks(
        documentXml(xml),
        context(sheet, NUMBERING, collectDegradations()),
      ),
    );
  }

  function item(text: string, numId: string, level: number): string {
    return paragraph(
      `<w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
        `<w:r><w:t>${text}</w:t></w:r>`,
    );
  }

  it("attaches the resolved level to a numbered paragraph", () => {
    expect(listed(item("one", "1", 0))[0]?.list).toMatchObject({
      numId: "1",
      level: 0,
      definition: { format: "decimal", lvlText: "%1." },
    });
  });

  it("keeps the nesting level a paragraph declares", () => {
    const xml = item("one", "1", 0) + item("deeper", "1", 1);

    expect(listed(xml).map((p) => p.list?.level)).toEqual([0, 1]);
  });

  it("defaults to the first level where w:ilvl is absent", () => {
    const xml = paragraph(
      `<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>` +
        `<w:r><w:t>one</w:t></w:r>`,
    );

    expect(listed(xml)[0]?.list?.level).toBe(0);
  });

  it("leaves an ordinary paragraph out of any list", () => {
    expect(
      listed(paragraph("<w:r><w:t>plain</w:t></w:r>"))[0]?.list,
    ).toBeUndefined();
  });

  // Word writes numId 0 to take a paragraph back out of the list it inherited.
  it("treats numId 0 as leaving the list", () => {
    expect(listed(item("out", "0", 0))[0]?.list).toBeUndefined();
  });

  it("reads a list the paragraph inherits from its style", () => {
    const sheet = parseStyleSheet(
      stylesXml(
        `<w:style w:styleId="ListPara"><w:name w:val="list paragraph"/>` +
          `<w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
          `</w:style>`,
      ),
      {},
    );
    const xml = paragraph(
      `<w:pPr><w:pStyle w:val="ListPara"/></w:pPr><w:r><w:t>inherited</w:t></w:r>`,
    );

    expect(listed(xml, sheet)[0]?.list).toMatchObject({ numId: "1", level: 1 });
  });

  it("reports a paragraph pointing at a list the document never defined", () => {
    const degradations = collectDegradations();
    extractBlocks(
      documentXml(item("orphan", "42", 0)),
      context(EMPTY_SHEET, NUMBERING, degradations),
    );

    expect(degradations.report().degradations[0]).toMatchObject({
      code: "unresolved-list",
    });
  });
});

describe("tables", () => {
  function blocks(xml: string, degradations = collectDegradations()) {
    return extractBlocks(
      documentXml(xml),
      context(EMPTY_SHEET, NUMBERING, degradations),
    );
  }

  function cell(text: string, properties = ""): string {
    return `<w:tc><w:tcPr>${properties}</w:tcPr>${paragraph(
      `<w:r><w:t>${text}</w:t></w:r>`,
    )}</w:tc>`;
  }

  function table(rows: string): string {
    return `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`;
  }

  function row(cells: string, properties = ""): string {
    return `<w:tr>${properties}${cells}</w:tr>`;
  }

  it("keeps a table in document order between the paragraphs around it", () => {
    const xml =
      paragraph("<w:r><w:t>before</w:t></w:r>") +
      table(row(cell("a") + cell("b"))) +
      paragraph("<w:r><w:t>after</w:t></w:r>");

    expect(blocks(xml).map((block) => block.kind)).toEqual([
      "paragraph",
      "table",
      "paragraph",
    ]);
  });

  it("reads the cells of each row", () => {
    const found = blocks(table(row(cell("a") + cell("b"))))[0];

    expect(found?.kind === "table" && found.table.rows[0]?.cells.length).toBe(
      2,
    );
    expect(
      found?.kind === "table" && found.table.rows[0]?.cells[0]?.blocks.length,
    ).toBe(1);
  });

  it("counts how many rows a vertical merge covers", () => {
    const found = blocks(
      table(
        row(cell("top", `<w:vMerge w:val="restart"/>`) + cell("x")) +
          row(cell("", `<w:vMerge/>`) + cell("y")) +
          row(cell("", `<w:vMerge/>`) + cell("z")),
      ),
    )[0];

    expect(
      found?.kind === "table" && found.table.rows[0]?.cells[0],
    ).toMatchObject({ verticalMerge: "restart", rowSpan: 3 });
  });

  // A cell spanning two columns shifts every cell to its right out of step
  // with the row above, so the extent is counted by grid column, not by index.
  it("counts a merge under a cell that spans columns", () => {
    const found = blocks(
      table(
        row(cell("wide", `<w:gridSpan w:val="2"/>`)) +
          row(cell("a") + cell("b", `<w:vMerge w:val="restart"/>`)) +
          row(cell("c") + cell("", `<w:vMerge/>`)),
      ),
    )[0];

    expect(
      found?.kind === "table" && found.table.rows[1]?.cells[1],
    ).toMatchObject({ rowSpan: 2 });
  });

  it("leaves an unmerged cell covering one row", () => {
    const found = blocks(table(row(cell("a") + cell("b"))))[0];

    expect(
      found?.kind === "table" && found.table.rows[0]?.cells[0],
    ).toMatchObject({ verticalMerge: "none", rowSpan: 1 });
  });

  it("reads a repeating header row", () => {
    const found = blocks(
      table(row(cell("h"), `<w:trPr><w:tblHeader/></w:trPr>`) + row(cell("d"))),
    )[0];

    expect(
      found?.kind === "table" && found.table.rows.map((r) => r.repeatsAsHeader),
    ).toEqual([true, false]);
  });

  it("reads a list inside a cell as a list", () => {
    const item = `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>`;
    const found = blocks(table(row(`<w:tc><w:tcPr/>${item}</w:tc>`)))[0];

    expect(
      found?.kind === "table" &&
        found.table.rows[0]?.cells[0]?.blocks[0]?.kind === "paragraph" &&
        found.table.rows[0]?.cells[0]?.blocks[0]?.paragraph.list?.numId,
    ).toBe("1");
  });

  // A tabularx inside a cell of another, inside a longtable that may contain
  // neither, is where the generated document stops compiling.
  it("flattens a nested table to its paragraphs and says so", () => {
    const degradations = collectDegradations();
    const inner = table(row(cell("deep")));
    const found = blocks(
      table(row(`<w:tc><w:tcPr/>${inner}</w:tc>`)),
      degradations,
    )[0];

    const cells = found?.kind === "table" ? found.table.rows[0]?.cells : [];
    expect(cells?.[0]?.blocks.every((b) => b.kind === "paragraph")).toBe(true);
    expect(degradations.report().degradations[0]).toMatchObject({
      code: "nested-table",
    });
  });

  it("reports a cell that asks to sit anywhere but the top", () => {
    const degradations = collectDegradations();
    blocks(table(row(cell("a", `<w:vAlign w:val="center"/>`))), degradations);

    expect(degradations.report().degradations[0]).toMatchObject({
      code: "table-cell-alignment",
    });
  });

  it("descends into a content control, which wraps ordinary content", () => {
    const xml = `<w:sdt><w:sdtContent>${paragraph(
      "<w:r><w:t>inside</w:t></w:r>",
    )}</w:sdtContent></w:sdt>`;

    expect(paragraphsOf(blocks(xml)).map((p) => textRuns(p)[0]?.text)).toEqual([
      "inside",
    ]);
  });
});

describe("paragraphsOf", () => {
  it("reaches the paragraphs inside table cells", () => {
    const xml =
      paragraph("<w:r><w:t>outside</w:t></w:r>") +
      `<w:tbl><w:tr><w:tc>${paragraph("<w:r><w:t>inside</w:t></w:r>")}</w:tc></w:tr></w:tbl>`;

    const found = extractBlocks(
      documentXml(xml),
      context(EMPTY_SHEET, NUMBERING, collectDegradations()),
    );

    expect(paragraphsOf(found).map((p) => textRuns(p)[0]?.text)).toEqual([
      "outside",
      "inside",
    ]);
  });
});

describe("pictures", () => {
  const RELATIONSHIPS = parseRelationships(
    `<Relationships><Relationship Id="rId4" Target="media/image1.png"/></Relationships>`,
  );

  function drawing(embed = "rId4"): string {
    return `<w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/>
      <wp:docPr id="1" name="Image 1"/>
      <a:blip r:embed="${embed}"/>
    </wp:inline></w:drawing>`;
  }

  function readWithMedia(xml: string): readonly Paragraph[] {
    return paragraphsOf(
      extractBlocks(
        documentXml(xml),
        context(EMPTY_SHEET, new Map(), collectDegradations(), RELATIONSHIPS),
      ),
    );
  }

  it("reads a picture as a run of its own", () => {
    const paragraphs = readWithMedia(paragraph(`<w:r>${drawing()}</w:r>`));

    expect(paragraphs[0]?.runs).toEqual([
      {
        kind: "image",
        image: {
          part: "word/media/image1.png",
          widthMm: 25.4,
          heightMm: 12.7,
          description: "Image 1",
        },
      },
    ]);
  });

  // A picture between two words belongs between them, not before or after both.
  it("keeps a picture in its place within the run's text", () => {
    const xml = paragraph(
      `<w:r><w:t>before</w:t>${drawing()}<w:t>after</w:t></w:r>`,
    );

    expect(readWithMedia(xml)[0]?.runs.map((run) => run.kind)).toEqual([
      "text",
      "image",
      "text",
    ]);
  });

  it("leaves the surrounding text unmerged across a picture", () => {
    const xml = paragraph(
      `<w:r><w:t>before</w:t>${drawing()}<w:t>after</w:t></w:r>`,
    );

    expect(textRuns(readWithMedia(xml)[0]).map((run) => run.text)).toEqual([
      "before",
      "after",
    ]);
  });

  it("keeps the paragraph's text when the picture cannot be resolved", () => {
    const xml = paragraph(`<w:r><w:t>caption</w:t>${drawing("rId99")}</w:r>`);

    expect(readWithMedia(xml)[0]?.runs).toEqual([
      { kind: "text", text: "caption", style: {} },
    ]);
  });
});
