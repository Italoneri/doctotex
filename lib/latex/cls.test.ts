import { describe, expect, it } from "vitest";
import type { StyleProfile } from "@/lib/extract/types";
import { generateClass } from "./cls";

function profile(overrides: Partial<StyleProfile> = {}): StyleProfile {
  return {
    page: {
      widthMm: 210,
      heightMm: 297,
      orientation: "portrait",
      margins: {
        topMm: 25,
        bottomMm: 25,
        leftMm: 25,
        rightMm: 25,
        headerMm: 12.7,
        footerMm: 12.7,
      },
    },
    defaults: { text: {}, paragraph: {} },
    headings: [],
    theme: {},
    features: {
      tables: false,
      images: false,
      ommlEquations: false,
      oleObjects: false,
      headers: false,
      footers: false,
      numbering: false,
    },
    ...overrides,
  };
}

describe("geometry", () => {
  it("writes the page and margins the document declares", () => {
    const cls = generateClass(profile());

    expect(cls).toContain("paperwidth=210mm");
    expect(cls).toContain("paperheight=297mm");
    expect(cls).toContain("top=25mm");
  });

  // Word measures the header from the page edge, geometry from the text block.
  it("converts the header offset into a separation", () => {
    const cls = generateClass(profile());

    expect(cls).toContain("headsep=7.36mm");
  });

  it("clamps a separation that would come out negative", () => {
    const cls = generateClass(
      profile({
        page: {
          ...profile().page,
          margins: { ...profile().page.margins, topMm: 5, headerMm: 20 },
        },
      }),
    );

    expect(cls).toContain("headsep=0.1mm");
  });
});

describe("body defaults", () => {
  // Word's defaults for both are zero while LaTeX's are not, so leaving them
  // unset would indent a document that asked for no indent.
  it("pins parindent and parskip even when the document is silent", () => {
    const cls = generateClass(profile());

    expect(cls).toContain("\\setlength{\\parindent}{0mm}");
    expect(cls).toContain("\\setlength{\\parskip}{0pt}");
  });

  it("falls back to the schema default size when none is declared", () => {
    const cls = generateClass(profile());

    expect(cls).toContain("\\fontsize{10pt}{12pt}");
    expect(cls).toContain("schema default of 10pt");
  });

  it("uses a declared size instead", () => {
    const cls = generateClass(
      profile({ defaults: { text: { fontSizePt: 12 }, paragraph: {} } }),
    );

    expect(cls).toContain("\\fontsize{12pt}{14.4pt}");
  });
});

describe("fonts", () => {
  it("loads the package that stands in for the body face", () => {
    const cls = generateClass(
      profile({
        defaults: { text: { fontFamily: "Times New Roman" }, paragraph: {} },
      }),
    );

    expect(cls).toContain("\\RequirePackage{newtxtext}");
  });

  // Loading only the body font would render every heading in it.
  it("also loads a face used only by a heading", () => {
    const cls = generateClass(
      profile({
        defaults: { text: { fontFamily: "Times New Roman" }, paragraph: {} },
        headings: [
          {
            level: 1,
            styleId: "H1",
            text: { fontFamily: "Arial" },
            paragraph: {},
          },
        ],
      }),
    );

    expect(cls).toContain("\\RequirePackage{helvet}");
    expect(cls).toContain("\\sffamily");
  });

  it("names an unmapped face in a comment rather than substituting silently", () => {
    const cls = generateClass(
      profile({
        defaults: { text: { fontFamily: "Comic Sans MS" }, paragraph: {} },
      }),
    );

    expect(cls).toContain("Comic Sans MS");
    expect(cls).toContain("\\RequirePackage{lmodern}");
  });

  it("warns when two faces collapse onto the same LaTeX family", () => {
    const cls = generateClass(
      profile({
        defaults: { text: { fontFamily: "Times New Roman" }, paragraph: {} },
        headings: [
          {
            level: 1,
            styleId: "H1",
            text: { fontFamily: "Garamond" },
            paragraph: {},
          },
        ],
      }),
    );

    expect(cls).toContain("both map to \\rmfamily");
  });
});

describe("headings", () => {
  it("maps each declared level to its sectioning command", () => {
    const cls = generateClass(
      profile({
        headings: [
          { level: 1, styleId: "Titre1", text: { bold: true }, paragraph: {} },
          { level: 3, styleId: "Titre3", text: {}, paragraph: {} },
        ],
      }),
    );

    expect(cls).toContain("\\titleformat{\\section}");
    expect(cls).toContain("\\titleformat{\\subsubsection}");
    // Level 2 is never declared, so \subsection is never formatted.
    expect(cls).not.toContain("\\titleformat{\\subsection}");
  });

  it("says so when the document declares no headings", () => {
    expect(generateClass(profile())).toContain("declares no heading styles");
  });

  // Claiming a structure the document does not have would be worse than
  // having none, so the class says which styles nothing uses.
  it("marks a heading style no paragraph applies", () => {
    const cls = generateClass(
      profile({
        headings: [{ level: 1, styleId: "Titre1", text: {}, paragraph: {} }],
      }),
    );

    expect(cls).toContain("declared but applied to no paragraph");
    expect(cls).toContain("None of these styles is applied");
  });

  it("reports how many paragraphs use a style that is applied", () => {
    const cls = generateClass(
      profile({
        headings: [{ level: 1, styleId: "Titre1", text: {}, paragraph: {} }],
      }),
      {},
      new Map([["Titre1", 4]]),
    );

    expect(cls).toContain("applied to 4 paragraphs");
    expect(cls).not.toContain("None of these styles is applied");
  });

  it("reports a level deeper than LaTeX can express", () => {
    const cls = generateClass(
      profile({
        headings: [{ level: 7, styleId: "Titre7", text: {}, paragraph: {} }],
      }),
    );

    expect(cls).toContain("outline level 7");
  });
});

describe("page style", () => {
  // A Word document with no footer prints no page number, so inventing one
  // would put a mark on the page that the original never had.
  it("leaves the footer empty when the document declares none", () => {
    const cls = generateClass(profile());

    expect(cls).toContain("\\fancyhf{}");
    expect(cls).not.toContain("\\fancyfoot");
    expect(cls).not.toContain("\\thepage");
  });

  it("uses the document's own header and footer when given", () => {
    const cls = generateClass(profile(), {
      header: "Conference 2026",
      footer: "\\thepage",
    });

    expect(cls).toContain("\\fancyhead[C]{Conference 2026}");
    expect(cls).toContain("\\fancyfoot[C]{\\thepage}");
  });
});
