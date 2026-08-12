import { describe, expect, it } from "vitest";
import { countStyleUsage, extractParagraphs } from "./body";

function documentXml(body: string): string {
  return `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;
}

function paragraph(inner: string): string {
  return `<w:p>${inner}</w:p>`;
}

function textOf(xml: string): readonly string[] {
  return extractParagraphs(documentXml(xml)).map((p) =>
    p.runs.map((r) => r.text).join(""),
  );
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

    expect(extractParagraphs(documentXml(xml))[0]?.styleId).toBe("Titre1");
  });

  it("reports no style for a paragraph that declares none", () => {
    const xml = paragraph("<w:r><w:t>plain</w:t></w:r>");

    expect(extractParagraphs(documentXml(xml))[0]?.styleId).toBeUndefined();
  });

  it("keeps an empty paragraph, which is a blank line in Word", () => {
    const xml = paragraph("") + paragraph("<w:r><w:t>after</w:t></w:r>");

    expect(textOf(xml)).toEqual(["", "after"]);
  });

  it("returns nothing when there is no body", () => {
    expect(extractParagraphs("<nonsense/>")).toEqual([]);
  });
});

describe("countStyleUsage", () => {
  it("counts the paragraphs that point at each style", () => {
    const usage = countStyleUsage([
      { styleId: "Titre1", runs: [] },
      { styleId: "Titre1", runs: [] },
      { styleId: "Titre3", runs: [] },
    ]);

    expect(usage.get("Titre1")).toBe(2);
    expect(usage.get("Titre3")).toBe(1);
  });

  // A style declared in styles.xml but applied to nothing is the normal case
  // in documents whose headings were formatted by hand.
  it("reports nothing for a style no paragraph uses", () => {
    const usage = countStyleUsage([{ runs: [] }, { runs: [] }]);

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
});

describe("run formatting", () => {
  it("reads bold and italic from the run properties", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>strong</w:t></w:r>`,
    );

    expect(extractParagraphs(documentXml(xml))[0]?.runs[0]).toEqual({
      text: "strong",
      bold: true,
      italic: true,
    });
  });

  it("treats a toggle switched off as off", () => {
    const xml = paragraph(
      `<w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>plain</w:t></w:r>`,
    );

    expect(extractParagraphs(documentXml(xml))[0]?.runs[0]?.bold).toBe(false);
  });

  // Word splits runs on every editing session, so identical formatting repeats.
  it("merges adjacent runs that share formatting", () => {
    const xml = paragraph(`<w:r><w:t>Hel</w:t></w:r><w:r><w:t>lo</w:t></w:r>`);

    expect(extractParagraphs(documentXml(xml))[0]?.runs).toEqual([
      { text: "Hello", bold: false, italic: false },
    ]);
  });

  it("keeps runs apart when their formatting differs", () => {
    const xml = paragraph(
      `<w:r><w:t>plain</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>`,
    );

    expect(extractParagraphs(documentXml(xml))[0]?.runs).toEqual([
      { text: "plain", bold: false, italic: false },
      { text: "bold", bold: true, italic: false },
    ]);
  });
});
