import { describe, expect, it } from "vitest";
import type { Paragraph } from "@/lib/extract/body";
import type { StyleProfile } from "@/lib/extract/types";
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

function run(text: string, bold = false, italic = false) {
  return { text, bold, italic };
}

function render(
  paragraphs: readonly Paragraph[],
  options: GenerationOptions = DEFAULT_OPTIONS,
): string {
  return generateDocument({ profile: PROFILE, paragraphs, options });
}

describe("document shell", () => {
  it("loads the generated class and opens a document", () => {
    const tex = render([]);

    expect(tex).toContain("\\documentclass{doctotex}");
    expect(tex).toContain("\\begin{document}");
    expect(tex).toContain("\\end{document}");
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
    const tex = render([{ styleId: "Titre1", runs: [run("Intro")] }], single);

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
    const tex = render([{ styleId: "Titre1", runs: [run("Intro")] }]);

    expect(tex).toContain("\\section*{Intro}");
  });

  // Level 3 stays \subsubsection even though level 2 is never used, so the
  // document's own numbering of its levels survives.
  it("keeps the nominal level when the document skips one", () => {
    const tex = render([{ styleId: "Titre3", runs: [run("Deep")] }]);

    expect(tex).toContain("\\subsubsection*{Deep}");
  });

  it("uses the title command for the Title style", () => {
    const tex = render([{ styleId: "Titre", runs: [run("The Paper")] }]);

    expect(tex).toContain("\\doctotextitle{The Paper}");
  });

  it("drops a heading with no text rather than emitting an empty one", () => {
    const tex = render([{ styleId: "Titre1", runs: [] }]);

    expect(tex).not.toContain("\\section*{}");
  });

  it("treats an unknown style as body text", () => {
    const tex = render([{ styleId: "Lgende", runs: [run("caption")] }]);

    expect(tex).toContain("caption");
    expect(tex).not.toContain("\\section");
  });
});

describe("runs", () => {
  it("wraps bold and italic", () => {
    const tex = render([
      { runs: [run("plain "), run("b", true), run("i", false, true)] },
    ]);

    expect(tex).toContain("plain \\textbf{b}\\textit{i}");
  });

  it("nests both when a run is bold and italic", () => {
    const tex = render([{ runs: [run("both", true, true)] }]);

    expect(tex).toContain("\\textbf{\\textit{both}}");
  });

  it("escapes reserved characters inside a run", () => {
    const tex = render([{ runs: [run("50% of A&B")] }]);

    expect(tex).toContain("50\\% of A\\&B");
  });
});

describe("breaks", () => {
  it("turns an interior line break into a LaTeX one", () => {
    const tex = render([{ runs: [run("first\nsecond")] }]);

    expect(tex).toContain("first \\\\\nsecond");
  });

  // `\\` immediately before a paragraph break is a LaTeX error.
  it("drops a trailing line break", () => {
    const tex = render([{ runs: [run("only\n")] }]);

    expect(tex).toContain("only");
    expect(tex).not.toContain("only \\\\");
  });

  it("renders a tab as horizontal space", () => {
    const tex = render([{ runs: [run("a\tb")] }]);

    expect(tex).toContain("a\\quad{}b");
  });
});
