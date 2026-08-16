import { describe, expect, it } from "vitest";
import { countStyleUsage, extractParagraphs, type Paragraph } from "./body";
import { parseStyleSheet, type StyleSheet } from "./styles";

const EMPTY_SHEET = parseStyleSheet(undefined, {});

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
  return extractParagraphs(documentXml(xml), sheet);
}

function textOf(xml: string): readonly string[] {
  return read(xml).map((p) => p.runs.map((r) => r.text).join(""));
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
    expect(extractParagraphs("<nonsense/>", EMPTY_SHEET)).toEqual([]);
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

    expect(read(xml)[0]?.runs[0]?.style).toMatchObject({
      bold: true,
      italic: true,
    });
  });

  it("treats a toggle switched off as off", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>plain</w:t></w:r>`,
    );

    expect(read(xml)[0]?.runs[0]?.style.bold).toBe(false);
  });

  it("leaves a property the run never mentions unset", () => {
    const xml = paragraph(`<w:r><w:t>plain</w:t></w:r>`);

    expect(read(xml)[0]?.runs[0]?.style.bold).toBeUndefined();
  });

  it("reads colour and size", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:color w:val="2E74B5"/><w:sz w:val="32"/></w:rPr><w:t>big</w:t></w:r>`,
    );

    expect(read(xml)[0]?.runs[0]?.style).toMatchObject({
      colorHex: "#2E74B5",
      fontSizePt: 16,
    });
  });

  it("reads any underline kind as underlined, and none as not", () => {
    const xml =
      paragraph(`<w:r><w:rPr><w:u w:val="wave"/></w:rPr><w:t>a</w:t></w:r>`) +
      paragraph(`<w:r><w:rPr><w:u w:val="none"/></w:rPr><w:t>b</w:t></w:r>`);

    const paragraphs = read(xml);
    expect(paragraphs[0]?.runs[0]?.style.underline).toBe(true);
    expect(paragraphs[1]?.runs[0]?.style.underline).toBe(false);
  });

  it("reads a double strike as a strike", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:dstrike/></w:rPr><w:t>gone</w:t></w:r>`,
    );

    expect(read(xml)[0]?.runs[0]?.style.strike).toBe(true);
  });

  it("reads small caps and vertical alignment", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:smallCaps/><w:vertAlign w:val="superscript"/></w:rPr><w:t>1</w:t></w:r>`,
    );

    expect(read(xml)[0]?.runs[0]?.style).toMatchObject({
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

    expect(read(xml)[0]?.runs[0]?.style.fontFamily).toBe("Calibri");
  });

  // Word splits runs on every editing session, so identical formatting repeats.
  it("merges adjacent runs that share formatting", () => {
    const xml = paragraph(`<w:r><w:t>Hel</w:t></w:r><w:r><w:t>lo</w:t></w:r>`);

    expect(read(xml)[0]?.runs).toEqual([{ text: "Hello", style: {} }]);
  });

  it("keeps runs apart when their formatting differs", () => {
    const xml = paragraph(
      `<w:r><w:t>plain</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>`,
    );

    expect(read(xml)[0]?.runs.map((run) => run.text)).toEqual([
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

    expect(read(xml)[0]?.runs.map((run) => run.text)).toEqual(["red", "blue"]);
  });

  it("keeps runs apart when only their size differs", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>small</w:t></w:r>` +
        `<w:r><w:rPr><w:sz w:val="40"/></w:rPr><w:t>large</w:t></w:r>`,
    );

    expect(read(xml)[0]?.runs.map((run) => run.text)).toEqual([
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

    expect(read(xml, sheet)[0]?.runs[0]?.style).toMatchObject({
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

    expect(read(xml, sheet)[0]?.runs[0]?.style.bold).toBe(false);
  });

  it("applies a character style between the paragraph and the run", () => {
    const xml = paragraph(
      `<w:pPr><w:pStyle w:val="Titre1"/></w:pPr>` +
        `<w:r><w:rPr><w:rStyle w:val="Accent"/></w:rPr><w:t>slanted</w:t></w:r>`,
    );

    expect(read(xml, sheet)[0]?.runs[0]?.style).toMatchObject({
      bold: true,
      italic: true,
    });
  });

  // w:pPr/w:rPr formats the paragraph mark itself, not the text inside it.
  it("does not read the paragraph mark's formatting onto its runs", () => {
    const xml = paragraph(
      `<w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>plain</w:t></w:r>`,
    );

    expect(read(xml, sheet)[0]?.runs[0]?.style.bold).toBeUndefined();
  });
});
