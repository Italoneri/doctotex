import { describe, expect, it } from "vitest";
import type { StyleProfile } from "@/lib/extract/types";
import { generateClass, type ClassInput } from "./cls";
import { DEFAULT_OPTIONS, type GenerationOptions } from "./options";

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

function generate(
  overrides: Partial<StyleProfile> = {},
  rest: Omit<ClassInput, "profile"> = {},
): string {
  return generateClass({ profile: profile(overrides), ...rest });
}

function withOptions(overrides: Partial<GenerationOptions>): GenerationOptions {
  return { ...DEFAULT_OPTIONS, ...overrides };
}

describe("geometry", () => {
  it("writes the page and margins the document declares", () => {
    const cls = generate();

    expect(cls).toContain("paperwidth=210mm");
    expect(cls).toContain("paperheight=297mm");
    expect(cls).toContain("top=25mm");
  });

  // Word measures the header from the page edge, geometry from the text block.
  it("converts the header offset into a separation", () => {
    expect(generate()).toContain("headsep=7.36mm");
  });

  it("clamps a separation that would come out negative", () => {
    const cls = generate({
      page: {
        ...profile().page,
        margins: { ...profile().page.margins, topMm: 5, headerMm: 20 },
      },
    });

    expect(cls).toContain("headsep=0.1mm");
  });
});

describe("body defaults", () => {
  // Word's defaults for both are zero while LaTeX's are not, so leaving them
  // unset would indent a document that asked for no indent.
  it("pins parindent and parskip even when the document is silent", () => {
    const cls = generate();

    expect(cls).toContain("\\setlength{\\parindent}{0mm}");
    expect(cls).toContain("\\setlength{\\parskip}{0pt}");
  });

  it("falls back to the schema default size when none is declared", () => {
    const cls = generate();

    expect(cls).toContain("\\fontsize{10pt}{12pt}");
    expect(cls).toContain("schema default of 10pt");
  });

  it("uses a declared size instead", () => {
    const cls = generate({
      defaults: { text: { fontSizePt: 12 }, paragraph: {} },
    });

    expect(cls).toContain("\\fontsize{12pt}{14.4pt}");
  });
});

describe("fonts under pdfLaTeX", () => {
  it("loads the package that stands in for the body face", () => {
    const cls = generate({
      defaults: { text: { fontFamily: "Times New Roman" }, paragraph: {} },
    });

    expect(cls).toContain("\\RequirePackage{newtxtext}");
  });

  // Loading only the body font would render every heading in it.
  it("also loads a face used only by a heading", () => {
    const cls = generate({
      defaults: { text: { fontFamily: "Times New Roman" }, paragraph: {} },
      headings: [
        {
          level: 1,
          styleId: "H1",
          text: { fontFamily: "Arial" },
          paragraph: {},
        },
      ],
    });

    expect(cls).toContain("\\RequirePackage{helvet}");
    expect(cls).toContain("\\sffamily");
  });

  it("names an unmapped face in a comment rather than substituting silently", () => {
    const cls = generate({
      defaults: { text: { fontFamily: "Comic Sans MS" }, paragraph: {} },
    });

    expect(cls).toContain("Comic Sans MS");
    expect(cls).toContain("\\RequirePackage{lmodern}");
  });

  it("warns when two faces collapse onto the same LaTeX family", () => {
    const cls = generate({
      defaults: { text: { fontFamily: "Times New Roman" }, paragraph: {} },
      headings: [
        {
          level: 1,
          styleId: "H1",
          text: { fontFamily: "Garamond" },
          paragraph: {},
        },
      ],
    });

    expect(cls).toContain("both map to \\rmfamily");
  });
});

describe("fonts under fontspec", () => {
  const options = withOptions({ engine: "xelatex" });

  it("names a face TeX Live carries rather than the Word original", () => {
    const cls = generate(
      { defaults: { text: { fontFamily: "Times New Roman" }, paragraph: {} } },
      { options },
    );

    expect(cls).toContain("\\RequirePackage{fontspec}");
    expect(cls).toContain("\\setmainfont{TeX Gyre Termes}");
    // The original is still named, so the substitution is visible.
    expect(cls).toContain("Times New Roman");
  });

  // T1 is a pdfTeX encoding; fontspec does its own and clashes with it.
  it("does not load fontenc", () => {
    const cls = generate({}, { options });

    expect(cls).not.toContain("fontenc");
    expect(cls).not.toContain("\\RequirePackage{newtxtext}");
  });

  it("fills one setter per family slot", () => {
    const cls = generate(
      {
        defaults: { text: { fontFamily: "Calibri" }, paragraph: {} },
        headings: [
          {
            level: 1,
            styleId: "H1",
            text: { fontFamily: "Cambria" },
            paragraph: {},
          },
        ],
      },
      { options },
    );

    expect(cls).toContain("\\setsansfont{Carlito}");
    expect(cls).toContain("\\setmainfont{Caladea}");
  });

  it("points at the real face in a comment when nothing matches", () => {
    const cls = generate(
      { defaults: { text: { fontFamily: "Comic Sans MS" }, paragraph: {} } },
      { options },
    );

    expect(cls).toContain("\\setmainfont{Latin Modern Roman}");
    expect(cls).toContain("\\setmainfont{Comic Sans MS} loads it directly");
  });
});

describe("headings", () => {
  it("maps each declared level to its sectioning command", () => {
    const cls = generate({
      headings: [
        { level: 1, styleId: "Titre1", text: { bold: true }, paragraph: {} },
        { level: 3, styleId: "Titre3", text: {}, paragraph: {} },
      ],
    });

    expect(cls).toContain("\\titleformat{\\section}");
    expect(cls).toContain("\\titleformat{\\subsubsection}");
    // Level 2 is never declared, so \subsection is never formatted.
    expect(cls).not.toContain("\\titleformat{\\subsection}");
  });

  it("says so when the document declares no headings", () => {
    expect(generate()).toContain("declares no heading styles");
  });

  // Claiming a structure the document does not have would be worse than
  // having none, so the class says which styles nothing uses.
  it("marks a heading style no paragraph applies", () => {
    const cls = generate({
      headings: [{ level: 1, styleId: "Titre1", text: {}, paragraph: {} }],
    });

    expect(cls).toContain("declared but applied to no paragraph");
    expect(cls).toContain("None of these styles is applied");
  });

  it("reports how many paragraphs use a style that is applied", () => {
    const cls = generate(
      { headings: [{ level: 1, styleId: "Titre1", text: {}, paragraph: {} }] },
      { usage: new Map([["Titre1", 4]]) },
    );

    expect(cls).toContain("applied to 4 paragraphs");
    expect(cls).not.toContain("None of these styles is applied");
  });

  it("reports a level deeper than LaTeX can express", () => {
    const cls = generate({
      headings: [{ level: 7, styleId: "Titre7", text: {}, paragraph: {} }],
    });

    expect(cls).toContain("outline level 7");
  });
});

describe("page style", () => {
  // A Word document with no footer prints no page number, so inventing one
  // would put a mark on the page that the original never had.
  it("leaves the footer empty when the document declares none", () => {
    const cls = generate();

    expect(cls).toContain("\\fancyhf{}");
    expect(cls).not.toContain("\\fancyfoot");
    expect(cls).not.toContain("\\thepage");
  });

  it("uses the document's own header and footer when given", () => {
    const cls = generate(
      {},
      { headerFooter: { header: "Conference 2026", footer: "\\thepage" } },
    );

    expect(cls).toContain("\\fancyhead[C]{Conference 2026}");
    expect(cls).toContain("\\fancyfoot[C]{\\thepage}");
  });
});

describe("bibliography", () => {
  it("loads nothing when none is asked for", () => {
    const cls = generate();

    expect(cls).not.toContain("biblatex");
    expect(cls).not.toContain("natbib");
  });

  it("loads biblatex with biber and the chosen style", () => {
    const cls = generate(
      {},
      {
        options: withOptions({
          bibliography: { backend: "biblatex", style: "ieee" },
        }),
      },
    );

    expect(cls).toContain(
      "\\RequirePackage[backend=biber,style=ieee]{biblatex}",
    );
    expect(cls).toContain("\\addbibresource{references.bib}");
    // biblatex refuses to load without it.
    expect(cls).toContain("\\RequirePackage{csquotes}");
  });

  it("loads natbib for the styles that are .bst files", () => {
    const cls = generate(
      {},
      {
        options: withOptions({
          bibliography: { backend: "natbib", style: "apa" },
        }),
      },
    );

    expect(cls).toContain("\\RequirePackage{natbib}");
    // \bibliographystyle writes to the .aux, which the preamble has not opened.
    expect(cls).not.toContain("\\bibliographystyle");
  });

  // abntex2cite loads natbib itself, with the options ABNT's author-date form
  // needs; loading natbib as well is an option clash.
  it("uses abntex2cite alone for ABNT", () => {
    const cls = generate(
      {},
      {
        options: withOptions({
          bibliography: { backend: "natbib", style: "abnt" },
        }),
      },
    );

    expect(cls).toContain("\\RequirePackage[alf]{abntex2cite}");
    expect(cls).not.toContain("\\RequirePackage{natbib}");
  });
});
