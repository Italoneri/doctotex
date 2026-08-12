import { describe, expect, it } from "vitest";
import { hasFixture, readFixture } from "@/fixtures/fixture";
import { openDocx } from "@/lib/docx/archive";
import { extractStyleProfile } from "./profile";
import type { StyleProfile } from "./types";

const FIXTURE = "exemplo.docx";

/**
 * Every expectation below was read off exemplo.docx's raw XML first, so this
 * suite checks the extractor against the document rather than against itself.
 * That also means the expectations describe this document specifically and do
 * not transfer to another fixture.
 */
async function profile(): Promise<StyleProfile> {
  return extractStyleProfile(await openDocx(await readFixture(FIXTURE)));
}

const describeFixture = describe.skipIf(!hasFixture(FIXTURE));

describeFixture("page", () => {
  it("reads the A4 geometry from sectPr", async () => {
    const { page } = await profile();

    expect(page.orientation).toBe("portrait");
    expect(page.widthMm).toBe(210.01);
    expect(page.heightMm).toBe(297);
  });

  // This document has two sections: an opening one with a 30mm top margin
  // covering 15 paragraphs, and the body-level one covering the remaining 35.
  // The body-level sectPr is both what the schema designates as the document's
  // section properties and, here, the one governing most of the content.
  it("takes the margins from the body-level section, not the nested one", async () => {
    const { margins } = (await profile()).page;

    expect(margins).toEqual({
      topMm: 25.01,
      rightMm: 25.01,
      bottomMm: 25.01,
      leftMm: 25.01,
      headerMm: 12.7,
      footerMm: 12.7,
    });
  });
});

describeFixture("theme", () => {
  it("reads both latin typefaces from theme1.xml", async () => {
    expect((await profile()).theme).toEqual({
      major: "Cambria",
      minor: "Calibri",
    });
  });
});

describeFixture("defaults", () => {
  it("takes the body font from docDefaults through Normal", async () => {
    expect((await profile()).defaults.text.fontFamily).toBe("Times New Roman");
  });

  // This document declares no w:sz anywhere in docDefaults or Normal, so the
  // LaTeX generator will have to supply a body size of its own.
  it("reports no body size, because the document declares none", async () => {
    expect((await profile()).defaults.text.fontSizePt).toBeUndefined();
  });
});

describeFixture("headings", () => {
  it("finds all three despite the localised style ids", async () => {
    const { headings } = await profile();

    expect(headings.map((h) => h.styleId)).toEqual([
      "Titre1",
      "Titre3",
      "Titre4",
    ]);
  });

  it("keeps the gap where level 2 would be", async () => {
    expect((await profile()).headings.map((h) => h.level)).toEqual([1, 3, 4]);
  });

  it("inherits the body font into a heading that overrides none", async () => {
    const [h1] = (await profile()).headings;

    expect(h1.text.fontFamily).toBe("Times New Roman");
    expect(h1.text.bold).toBe(true);
    expect(h1.text.fontSizePt).toBeUndefined();
    expect(h1.paragraph.alignment).toBe("center");
    expect(h1.paragraph.keepWithNext).toBe(true);
  });

  it("takes the overriding font and size from heading 3", async () => {
    const h3 = (await profile()).headings[1];

    expect(h3.text.fontFamily).toBe("Arial");
    expect(h3.text.fontSizePt).toBe(13);
    expect(h3.paragraph.spaceBeforePt).toBe(12);
    expect(h3.paragraph.spaceAfterPt).toBe(3);
  });

  // Heading 4 is 14pt against heading 3's 13pt. The document really is like
  // that; the extractor reports what is there rather than tidying it.
  it("reports heading 4 as larger than heading 3, as the document has it", async () => {
    const { headings } = await profile();
    const [, h3, h4] = headings;

    expect(h3.text.fontSizePt).toBe(13);
    expect(h4.text.fontSizePt).toBe(14);
  });
});

describeFixture("title", () => {
  it("reads Title separately from the heading levels", async () => {
    const { title, headings } = await profile();

    expect(title?.text.bold).toBe(true);
    expect(title?.text.allCaps).toBe(true);
    expect(title?.paragraph.alignment).toBe("center");
    expect(headings.some((h) => h.styleId === "Titre")).toBe(false);
  });
});

describeFixture("features", () => {
  it("reports what the document actually contains", async () => {
    expect((await profile()).features).toEqual({
      tables: true,
      images: true,
      // Its equations are Equation 3.0 OLE objects, not OMML.
      ommlEquations: false,
      oleObjects: true,
      headers: true,
      footers: true,
      numbering: true,
    });
  });
});
