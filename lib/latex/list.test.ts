import { describe, expect, it } from "vitest";
import type {
  ListFormat,
  ListLevel,
  ListMarker,
} from "@/lib/extract/numbering";
import { environmentFor, labelFor, listPreamble, optionsFor } from "./list";

function level(index: number, over: Partial<ListLevel> = {}): ListLevel {
  return { index, format: "decimal", lvlText: "%1.", startAt: 1, ...over };
}

function marker(index: number, over: Partial<ListLevel> = {}): ListMarker {
  return {
    numId: "1",
    level: index,
    definition: level(index, over),
    ancestors: [],
  };
}

function nested(
  formats: readonly ListFormat[],
  lvlText: string,
): { readonly marker: ListMarker; readonly stack: readonly ListMarker[] } {
  const levels = formats.map((format, index) => level(index, { format }));
  const stack = levels.slice(0, -1).map((definition, index) => ({
    numId: "1",
    level: index,
    definition,
    ancestors: levels.slice(0, index),
  }));
  const last = formats.length - 1;

  return {
    marker: {
      numId: "1",
      level: last,
      definition: level(last, { format: formats[last] ?? "decimal", lvlText }),
      ancestors: levels.slice(0, last),
    },
    stack,
  };
}

describe("environmentFor", () => {
  const cases: readonly (readonly [ListFormat, string])[] = [
    ["decimal", "enumerate"],
    ["lowerLetter", "enumerate"],
    ["upperRoman", "enumerate"],
    ["bullet", "itemize"],
    ["none", "itemize"],
  ];

  it.each(cases)("puts a %s level in %s", (format, expected) => {
    expect(environmentFor(marker(0, { format }))).toBe(expected);
  });
});

describe("labelFor", () => {
  const counters: readonly (readonly [ListFormat, string])[] = [
    ["decimal", "\\arabic*"],
    ["lowerLetter", "\\alph*"],
    ["upperLetter", "\\Alph*"],
    ["lowerRoman", "\\roman*"],
    ["upperRoman", "\\Roman*"],
  ];

  it.each(counters)("counts a %s level with %s", (format, command) => {
    const label = labelFor(marker(0, { format, lvlText: "%1." }), []);

    expect(label).toBe(`${command}.`);
  });

  it("names the enclosing counters of a multi-level label", () => {
    const { marker: deepest, stack } = nested(
      ["decimal", "lowerLetter", "lowerRoman"],
      "%1.%2.%3.",
    );

    expect(labelFor(deepest, stack)).toBe(
      "\\arabic{enumi}.\\alph{enumii}.\\roman*.",
    );
  });

  // Naming a counter LaTeX never created is a compile error, and the level a
  // bulleted list encloses has no counter at all.
  it("leaves a reference to an unnumbered level as literal text", () => {
    const { marker: deepest, stack } = nested(["bullet", "decimal"], "%1.%2.");

    expect(labelFor(deepest, stack)).toBe("\\%1.\\arabic*.");
  });

  it("escapes the literal text around the counter", () => {
    const label = labelFor(marker(0, { lvlText: "%1 of 100% #" }), []);

    expect(label).toBe("\\arabic* of 100\\% \\#");
  });

  it("falls back to a bare counter where the label references nothing", () => {
    expect(labelFor(marker(0, { lvlText: "Step" }), [])).toBe("\\arabic*");
  });

  const glyphs: readonly (readonly [string, string])[] = [
    ["disc", "\\textbullet"],
    ["circle", "$\\circ$"],
    ["square", "\\rule{0.8ex}{0.8ex}"],
    ["dash", "--"],
    ["asterisk", "\\textasteriskcentered"],
  ];

  it.each(glyphs)("draws the %s bullet as %s", (glyph, command) => {
    const label = labelFor(
      marker(0, { format: "bullet", glyph: glyph as never }),
      [],
    );

    expect(label).toBe(command);
  });

  it("draws a round bullet where the glyph was not recognised", () => {
    const label = labelFor(marker(0, { format: "bullet" }), []);

    expect(label).toBe("\\textbullet");
  });

  it("leaves a level formatted as none unlabelled", () => {
    expect(labelFor(marker(0, { format: "none" }), [])).toBe("{}");
  });
});

describe("optionsFor", () => {
  const plain = { resume: false };

  it("indents a level from the one that encloses it, not from the margin", () => {
    const inner: ListMarker = {
      numId: "1",
      level: 1,
      definition: level(1, { indentLeftMm: 25.4 }),
      ancestors: [level(0, { indentLeftMm: 12.7 })],
    };
    const stack: readonly ListMarker[] = [
      {
        numId: "1",
        level: 0,
        definition: level(0, { indentLeftMm: 12.7 }),
        ancestors: [],
      },
    ];

    expect(optionsFor(inner, stack, plain)).toContain("leftmargin=12.7mm");
  });

  it("carries the start value of a list that does not begin at one", () => {
    expect(optionsFor(marker(0, { startAt: 7 }), [], plain)).toContain(
      "start=7",
    );
  });

  it("says nothing about the start of a list that begins at one", () => {
    expect(optionsFor(marker(0), [], plain)).not.toContain("start=");
  });

  // Word carries on counting after an interruption; LaTeX starts again unless
  // told not to, which is the difference a reader notices first.
  it("resumes a list rather than restarting it", () => {
    const options = optionsFor(marker(0), [], { resume: true });

    expect(options).toContain("resume");
    expect(options).not.toContain("start=");
  });

  it("takes item spacing from the paragraphs in the list", () => {
    const options = optionsFor(marker(0), [], {
      resume: false,
      spaceBeforePt: 6,
      spaceAfterPt: 3,
    });

    expect(options).toContain("topsep=6pt");
    expect(options).toContain("itemsep=3pt");
  });

  it("says nothing about spacing the document does not declare", () => {
    expect(optionsFor(marker(0), [], plain)).not.toContain("itemsep");
  });
});

describe("listPreamble", () => {
  // LaTeX nests four levels; Word nests nine, and \renewlist is what raises it.
  it("raises the nesting limit to the nine Word allows", () => {
    const lines = listPreamble().join("\n");

    expect(lines).toContain("\\setlistdepth{9}");
    expect(lines).toContain("\\renewlist{itemize}{itemize}{9}");
    expect(lines).toContain("\\renewlist{enumerate}{enumerate}{9}");
  });

  // \renewlist clears the labels the original environments came with.
  it("puts a default label back for both environments", () => {
    const lines = listPreamble().join("\n");

    expect(lines).toContain("\\setlist[itemize]{label=\\textbullet}");
    expect(lines).toContain("\\setlist[enumerate]{label=\\arabic*.}");
  });

  it("loads enumitem", () => {
    expect(listPreamble()).toContain("\\RequirePackage{enumitem}");
  });
});
