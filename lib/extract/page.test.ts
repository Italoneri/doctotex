import { describe, expect, it } from "vitest";
import { extractPage } from "./page";

function documentXml(body: string): string {
  return `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;
}

/** The opening section of exemplo.docx, which has a wider top margin. */
const A4_SECTION = `
  <w:sectPr>
    <w:pgSz w:w="11906" w:h="16838"/>
    <w:pgMar w:top="1701" w:right="1418" w:bottom="1418" w:left="1418"
             w:header="567" w:footer="709" w:gutter="0"/>
  </w:sectPr>`;

describe("extractPage", () => {
  it("reads A4 dimensions from w:pgSz", () => {
    const page = extractPage(documentXml(A4_SECTION));

    expect(page.widthMm).toBe(210.01);
    expect(page.heightMm).toBe(297);
  });

  it("reads every margin from w:pgMar", () => {
    expect(extractPage(documentXml(A4_SECTION)).margins).toEqual({
      topMm: 30,
      rightMm: 25.01,
      bottomMm: 25.01,
      leftMm: 25.01,
      headerMm: 10,
      footerMm: 12.51,
    });
  });
});

describe("orientation", () => {
  it("reads an explicit landscape orientation", () => {
    const page = extractPage(
      documentXml(
        `<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/></w:sectPr>`,
      ),
    );

    expect(page.orientation).toBe("landscape");
  });

  // Word already swaps the dimensions for landscape, so the shape is a reliable
  // fallback when w:orient is omitted.
  it("infers landscape from a page wider than it is tall", () => {
    const page = extractPage(
      documentXml(`<w:sectPr><w:pgSz w:w="16838" w:h="11906"/></w:sectPr>`),
    );

    expect(page.orientation).toBe("landscape");
  });

  it("infers portrait from a page taller than it is wide", () => {
    expect(extractPage(documentXml(A4_SECTION)).orientation).toBe("portrait");
  });

  it("trusts an explicit portrait over the dimensions", () => {
    const page = extractPage(
      documentXml(
        `<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="portrait"/></w:sectPr>`,
      ),
    );

    expect(page.orientation).toBe("portrait");
  });
});

describe("fallbacks", () => {
  it("falls back to A4 when the body carries no section properties", () => {
    const page = extractPage(documentXml("<w:p/>"));

    expect(page.widthMm).toBe(210);
    expect(page.heightMm).toBe(297);
    expect(page.margins.topMm).toBe(25);
  });

  it("falls back when the document is not wordprocessing xml at all", () => {
    expect(extractPage("<nonsense/>").widthMm).toBe(210);
  });

  it("keeps the margins it can read when w:pgSz is missing", () => {
    const page = extractPage(
      documentXml(`<w:sectPr><w:pgMar w:top="2880"/></w:sectPr>`),
    );

    expect(page.widthMm).toBe(210);
    expect(page.margins.topMm).toBe(50.8);
    expect(page.margins.leftMm).toBe(25);
  });

  // geometry cannot express a margin that bleeds off the page.
  it("ignores a negative margin", () => {
    const page = extractPage(
      documentXml(`<w:sectPr><w:pgMar w:top="-720" w:left="1440"/></w:sectPr>`),
    );

    expect(page.margins.topMm).toBe(25);
    expect(page.margins.leftMm).toBe(25.4);
  });
});

describe("multiple sections", () => {
  // Only the last sectPr sits directly under w:body; the earlier ones are
  // nested inside the paragraph that closes their section.
  it("uses the body-level section, not one nested in a paragraph", () => {
    const page = extractPage(
      documentXml(`
        <w:p>
          <w:pPr>
            <w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/></w:sectPr>
          </w:pPr>
        </w:p>
        ${A4_SECTION}`),
    );

    expect(page.orientation).toBe("portrait");
    expect(page.widthMm).toBe(210.01);
  });

  it("takes the last of several body-level sections", () => {
    const page = extractPage(
      documentXml(`
        <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
        ${A4_SECTION}`),
    );

    expect(page.widthMm).toBe(210.01);
  });
});
