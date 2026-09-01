import { describe, expect, it } from "vitest";
import { paragraphBlocks, type Paragraph } from "@/lib/extract/body";
import type { StyleProfile, TextStyle } from "@/lib/extract/types";
import { DEFAULT_OPTIONS, type GenerationOptions } from "./options";
import { generateDocument } from "./tex";

const PROFILE: StyleProfile = {
  page: {
    widthMm: 210,
    heightMm: 297,
    orientation: "portrait",
    margins: {
      topMm: 25,
      bottomMm: 25,
      leftMm: 25,
      rightMm: 25,
      headerMm: 12,
      footerMm: 12,
    },
  },
  defaults: { text: {}, paragraph: {} },
  headings: [
    { level: 1, styleId: "Titre1", text: {}, paragraph: {} },
    { level: 3, styleId: "Titre3", text: {}, paragraph: {} },
  ],
  title: { styleId: "Titre", text: {}, paragraph: {} },
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
};

function run(text: string, style: TextStyle = {}): Paragraph["runs"][number] {
  return { kind: "text", text, style };
}

/** A paragraph that asks for nothing beyond the document's own defaults. */
function para(runs: Paragraph["runs"], styleId?: string): Paragraph {
  return { styleId, style: {}, runs };
}

function render(
  paragraphs: readonly Paragraph[],
  options: GenerationOptions = DEFAULT_OPTIONS,
): string {
  return generateDocument({
    profile: PROFILE,
    blocks: paragraphBlocks(paragraphs),
    options,
  });
}

describe("document shell", () => {
  it("loads the generated class and opens a document", () => {
    const tex = render([]);

    expect(tex).toContain("\\documentclass{doctotex}");
    expect(tex).toContain("\\begin{document}");
    expect(tex).toContain("\\end{document}");
  });
});

describe("compile instructions", () => {
  // The archive is opened away from the browser that chose the engine, so the
  // choice has to travel inside the file it applies to.
  it("names the single command when there is nothing else to run", () => {
    const tex = render([]);

    expect(tex).toContain("%% Compile with:");
    expect(tex).toContain("%%   pdflatex main.tex");
  });

  it("warns that a fontspec preamble is not pdfLaTeX's", () => {
    const tex = render([], { ...DEFAULT_OPTIONS, engine: "lualatex" });

    expect(tex).toContain("%%   lualatex main.tex");
    expect(tex).toContain("not interchangeable with pdfLaTeX");
  });

  it("spells out the passes a bibliography needs", () => {
    const tex = render([], {
      ...DEFAULT_OPTIONS,
      bibliography: { backend: "biblatex", style: "apa" },
    });

    expect(tex).toContain("%%   biber main");
    // Three engine passes around the tool, so the first line repeats twice more.
    expect(tex.split("%%   pdflatex main.tex").length - 1).toBe(3);
    // The tool failing on an uncited document is expected, and saying so here
    // saves the reader diagnosing a build that in fact worked.
    expect(tex).toContain("exits");
  });

  it("is in the file that gets compiled, whichever layout is chosen", () => {
    for (const layout of ["multi", "single"] as const) {
      expect(render([], { ...DEFAULT_OPTIONS, layout })).toContain(
        "%% Compile with:",
      );
    }
  });
});

describe("the single-file layout", () => {
  const single = { ...DEFAULT_OPTIONS, layout: "single" } as const;

  // There is no class to load, so everything it would have carried has to be
  // in the preamble instead.
  it("inlines the preamble under a stock class", () => {
    const tex = render([], single);

    expect(tex).toContain("\\documentclass{article}");
    expect(tex).not.toContain("\\documentclass{doctotex}");
    expect(tex).toContain("\\geometry{");
    expect(tex).toContain("\\newcommand{\\doctotextitle}");
  });

  it("spells package loading the way a preamble spells it", () => {
    const tex = render([], single);

    expect(tex).toContain("\\usepackage{geometry}");
    expect(tex).not.toContain("\\RequirePackage");
  });

  it("still renders the body through the same commands", () => {
    const tex = render([para([run("Intro")], "Titre1")], single);

    expect(tex).toContain("\\section*{Intro}");
  });
});

describe("bibliography", () => {
  it("prints nothing when none is asked for", () => {
    const tex = render([]);

    expect(tex).not.toContain("\\printbibliography");
    expect(tex).not.toContain("\\bibliography{");
  });

  it("prints a biblatex list", () => {
    const tex = render([], {
      ...DEFAULT_OPTIONS,
      bibliography: { backend: "biblatex", style: "apa" },
    });

    expect(tex).toContain("\\printbibliography");
  });

  // \bibliographystyle writes to the .aux file, which is not open until the
  // document body has begun.
  it("names the .bst inside the document rather than the preamble", () => {
    const tex = render([], {
      ...DEFAULT_OPTIONS,
      bibliography: { backend: "natbib", style: "ieee" },
    });

    const begin = tex.indexOf("\\begin{document}");
    expect(tex.indexOf("\\bibliographystyle{IEEEtranN}")).toBeGreaterThan(
      begin,
    );
    expect(tex).toContain("\\bibliography{references}");
  });
});

describe("headings", () => {
  it("maps an outline level to its sectioning command", () => {
    const tex = render([para([run("Intro")], "Titre1")]);

    expect(tex).toContain("\\section*{Intro}");
  });

  // Level 3 stays \subsubsection even though level 2 is never used, so the
  // document's own numbering of its levels survives.
  it("keeps the nominal level when the document skips one", () => {
    const tex = render([para([run("Deep")], "Titre3")]);

    expect(tex).toContain("\\subsubsection*{Deep}");
  });

  it("uses the title command for the Title style", () => {
    const tex = render([para([run("The Paper")], "Titre")]);

    expect(tex).toContain("\\doctotextitle{The Paper}");
  });

  it("drops a heading with no text rather than emitting an empty one", () => {
    const tex = render([para([], "Titre1")]);

    expect(tex).not.toContain("\\section*{}");
  });

  it("treats an unknown style as body text", () => {
    const tex = render([para([run("caption")], "Lgende")]);

    expect(tex).toContain("caption");
    expect(tex).not.toContain("\\section");
  });
});

describe("runs", () => {
  it("wraps bold and italic", () => {
    const tex = render([
      para([
        run("plain "),
        run("b", { bold: true }),
        run("i", { italic: true }),
      ]),
    ]);

    expect(tex).toContain("plain \\textbf{b}\\textit{i}");
  });

  it("nests both when a run is bold and italic", () => {
    const tex = render([para([run("both", { bold: true, italic: true })])]);

    expect(tex).toContain("\\textbf{\\textit{both}}");
  });

  it("escapes reserved characters inside a run", () => {
    const tex = render([para([run("50% of A&B")])]);

    expect(tex).toContain("50\\% of A\\&B");
  });
});

describe("breaks", () => {
  it("turns an interior line break into a LaTeX one", () => {
    const tex = render([para([run("first\nsecond")])]);

    expect(tex).toContain("first \\\\\nsecond");
  });

  // `\\` immediately before a paragraph break is a LaTeX error.
  it("drops a trailing line break", () => {
    const tex = render([para([run("only\n")])]);

    expect(tex).toContain("only");
    expect(tex).not.toContain("only \\\\");
  });

  // The break used to be stripped per run, which ate one that in fact
  // separated two runs of the same sentence.
  it("keeps a break that falls between two runs", () => {
    const tex = render([para([run("first\n"), run("second")])]);

    expect(tex).toContain("first \\\\\nsecond");
  });

  it("renders a tab as horizontal space", () => {
    const tex = render([para([run("a\tb")])]);

    expect(tex).toContain("a\\quad{}b");
  });

  it("tells a page break apart from a line break", () => {
    const tex = render([para([run("before\fafter")])]);

    expect(tex).toContain("\\newpage");
    expect(tex).not.toContain("before \\\\");
  });

  it("says a column break cannot be expressed rather than faking one", () => {
    const tex = render([para([run("before\vafter")])]);

    expect(tex).toContain("%% TODO: a column break");
  });

  it("breaks the page before a paragraph that asks for it", () => {
    const tex = render([
      { style: { pageBreakBefore: true }, runs: [run("Chapter two")] },
    ]);

    expect(tex).toContain("\\newpage\nChapter two");
  });

  // A break inside \uline{} is an error, because ulem measures its argument.
  it("puts a break between decorated pieces rather than inside one", () => {
    const tex = render([para([run("a\nb", { underline: true })])]);

    expect(tex).toContain("\\uline{a} \\\\\n\\uline{b}");
  });
});

describe("run appearance", () => {
  it("colours a run the document colours", () => {
    const tex = render([para([run("blue", { colorHex: "#2E74B5" })])]);

    expect(tex).toContain("\\textcolor[HTML]{2E74B5}{blue}");
  });

  it("sizes a run the document sizes", () => {
    const tex = render([para([run("big", { fontSizePt: 16 })])]);

    expect(tex).toContain("{\\fontsize{16pt}{19.2pt}\\selectfont{}big}");
  });

  // TeX skips every space after a control word, so closing the switch with a
  // space rather than an empty group ate the separator in `Estado  •  (00)`.
  it("keeps the spaces a run begins with", () => {
    const tex = render([para([run("  •  ", { fontSizePt: 10 })])]);

    expect(tex).toContain("\\selectfont{}  •  ");
  });

  it("underlines, strikes, uppercases and raises", () => {
    const tex = render([
      para([
        run("u", { underline: true }),
        run("s", { strike: true }),
        run("c", { allCaps: true }),
        run("k", { smallCaps: true }),
        run("1", { script: "superscript" }),
      ]),
    ]);

    expect(tex).toContain("\\uline{u}");
    expect(tex).toContain("\\sout{s}");
    expect(tex).toContain("\\MakeUppercase{c}");
    expect(tex).toContain("\\textsc{k}");
    expect(tex).toContain("\\textsuperscript{1}");
  });

  // The colour has to wrap the rule, or the line under coloured text is black.
  it("puts the colour outside the underline", () => {
    const tex = render([
      para([run("x", { underline: true, colorHex: "#FF0000" })]),
    ]);

    expect(tex).toContain("\\textcolor[HTML]{FF0000}{\\uline{x}}");
  });

  it("says nothing where the run matches what the class already applies", () => {
    const withBoldHeading: StyleProfile = {
      ...PROFILE,
      headings: [
        { level: 1, styleId: "Titre1", text: { bold: true }, paragraph: {} },
      ],
    };
    const tex = generateDocument({
      profile: withBoldHeading,
      blocks: paragraphBlocks([para([run("Intro", { bold: true })], "Titre1")]),
    });

    expect(tex).toContain("\\section*{Intro}");
  });

  // titlesec has already switched the weight on, so turning it back off is
  // the only way a light word inside a bold heading survives.
  it("turns a property back off against a style that switched it on", () => {
    const withBoldHeading: StyleProfile = {
      ...PROFILE,
      headings: [
        { level: 1, styleId: "Titre1", text: { bold: true }, paragraph: {} },
      ],
    };
    const tex = generateDocument({
      profile: withBoldHeading,
      blocks: paragraphBlocks([
        para([run("light", { bold: false })], "Titre1"),
      ]),
    });

    expect(tex).toContain("{\\mdseries{}light}");
  });
});

describe("paragraph shape", () => {
  it("writes a paragraph that matches the document as plain text", () => {
    const tex = render([para([run("ordinary")])]);

    expect(tex).toContain("\nordinary\n");
    expect(tex).not.toContain("doctotexpara");
  });

  it("wraps one whose spacing or alignment differs", () => {
    const tex = render([
      {
        style: { alignment: "center", spaceBeforePt: 12, spaceAfterPt: 6 },
        runs: [run("Name")],
      },
    ]);

    expect(tex).toContain(
      "\\begin{doctotexpara}{12pt}{6pt}{0mm}{0mm}{\\centering}",
    );
    expect(tex).toContain("\\end{doctotexpara}");
  });

  it("carries the indent Word declared", () => {
    const tex = render([
      {
        style: { indentLeftMm: 12.7, indentFirstLineMm: 6.35 },
        runs: [run("x")],
      },
    ]);

    expect(tex).toContain("{0pt}{0pt}{12.7mm}{6.35mm}{}");
  });

  // A heading's spacing belongs to titlesec, so wrapping it would apply the
  // same gap twice.
  it("leaves a heading to its sectioning command", () => {
    const tex = render([
      { styleId: "Titre1", style: { spaceBeforePt: 20 }, runs: [run("Intro")] },
    ]);

    expect(tex).toContain("\\section*{Intro}");
    expect(tex).not.toContain("doctotexpara");
  });
});

describe("what the template does not carry", () => {
  it("says so where the document has images", () => {
    const withImages: StyleProfile = {
      ...PROFILE,
      features: { ...PROFILE.features, images: true },
    };
    const tex = generateDocument({ profile: withImages, blocks: [] });

    expect(tex).toContain("%% TODO: the source document contains images");
  });

  it("names every missing feature rather than only the first", () => {
    const withBoth: StyleProfile = {
      ...PROFILE,
      features: { ...PROFILE.features, images: true, ommlEquations: true },
    };
    const tex = generateDocument({ profile: withBoth, blocks: [] });

    expect(tex).toContain("images and equations");
  });

  // The numbering part is present in Word documents that have no list in them,
  // and both lists and tables are carried now in any case.
  it("says nothing about lists or tables, which are carried", () => {
    const carried: StyleProfile = {
      ...PROFILE,
      features: { ...PROFILE.features, numbering: true, tables: true },
    };
    const tex = generateDocument({ profile: carried, blocks: [] });

    expect(tex).not.toContain("%% TODO: the source document");
  });

  it("says nothing where there is nothing to say", () => {
    expect(render([])).not.toContain("%% TODO: the source document");
  });
});

describe("what the conversion changed", () => {
  it("names each degradation and why it happened", () => {
    const tex = generateDocument({
      profile: PROFILE,
      blocks: [],
      report: {
        degradations: [
          {
            code: "custom-list-label",
            detail: "Bullet character U+F0FC belongs to a symbol font.",
            count: 3,
          },
        ],
      },
    });

    expect(tex).toContain("Bullet character U+F0FC belongs to a symbol font.");
    expect(tex).toContain("(3 times)");
  });

  it("does not count a degradation that happened once", () => {
    const tex = generateDocument({
      profile: PROFILE,
      blocks: [],
      report: {
        degradations: [
          {
            code: "nested-table",
            detail: "A table sat inside a cell.",
            count: 1,
          },
        ],
      },
    });

    expect(tex).toContain("A table sat inside a cell.");
    expect(tex).not.toContain("times)");
  });
});
