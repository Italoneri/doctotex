import { describe, expect, it } from "vitest";
import { parseSequence, type SequenceNode } from "@/lib/docx/sequence";
import { readEquation } from "./equations";

const NAMESPACE =
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

function math(inner: string): SequenceNode {
  const node = parseSequence(`<m:oMath ${NAMESPACE}>${inner}</m:oMath>`)[0];
  if (!node) {
    throw new Error("the fixture does not parse");
  }
  return node;
}

/** A run of mathematical text, which is where the symbols actually live. */
function run(text: string): string {
  return `<m:r><m:t>${text}</m:t></m:r>`;
}

function latexOf(inner: string): string | undefined {
  const reading = readEquation(math(inner));
  return reading.kind === "read" ? reading.latex : undefined;
}

describe("readEquation", () => {
  it("reads a run of ordinary mathematical text", () => {
    expect(latexOf(run("x + 1 = 2"))).toBe("x + 1 = 2");
  });

  it("reads a fraction as the command that draws one", () => {
    expect(
      latexOf(
        `<m:f><m:num>${run("a")}</m:num><m:den>${run("b")}</m:den></m:f>`,
      ),
    ).toBe("\\frac{a}{b}");
  });

  it("reads a superscript", () => {
    expect(
      latexOf(
        `<m:sSup><m:e>${run("x")}</m:e><m:sup>${run("2")}</m:sup></m:sSup>`,
      ),
    ).toBe("{x}^{2}");
  });

  it("reads a subscript", () => {
    expect(
      latexOf(
        `<m:sSub><m:e>${run("a")}</m:e><m:sub>${run("i")}</m:sub></m:sSub>`,
      ),
    ).toBe("{a}_{i}");
  });

  it("reads a term carrying both at once", () => {
    expect(
      latexOf(
        `<m:sSubSup><m:e>${run("x")}</m:e><m:sub>${run("i")}</m:sub><m:sup>${run("2")}</m:sup></m:sSubSup>`,
      ),
    ).toBe("{x}_{i}^{2}");
  });

  it("reads a square root", () => {
    expect(latexOf(`<m:rad><m:e>${run("2")}</m:e></m:rad>`)).toBe("\\sqrt{2}");
  });

  // Word writes an empty degree for a square root, which is not an index.
  it("reads an empty degree as no index rather than an empty one", () => {
    expect(latexOf(`<m:rad><m:deg/><m:e>${run("2")}</m:e></m:rad>`)).toBe(
      "\\sqrt{2}",
    );
  });

  it("carries the index of a root that has one", () => {
    expect(
      latexOf(
        `<m:rad><m:deg>${run("3")}</m:deg><m:e>${run("8")}</m:e></m:rad>`,
      ),
    ).toBe("\\sqrt[3]{8}");
  });

  // The brackets have to grow with what they hold, which is the whole reason
  // Word stores this as an element rather than as two more characters.
  it("reads delimiters that grow with their contents", () => {
    expect(latexOf(`<m:d><m:e>${run("x")}</m:e></m:d>`)).toBe(
      "\\left(x\\right)",
    );
  });

  it("reads the brackets the document asked for", () => {
    expect(
      latexOf(
        `<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e>${run("x")}</m:e></m:d>`,
      ),
    ).toBe("\\left[x\\right]");
  });

  it("reads a summation with both its limits", () => {
    expect(
      latexOf(
        `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr>` +
          `<m:sub>${run("i=1")}</m:sub><m:sup>${run("n")}</m:sup><m:e>${run("i")}</m:e></m:nary>`,
      ),
    ).toBe("\\sum_{i=1}^{n}{i}");
  });

  it("reads a big operator that carries no limits", () => {
    expect(
      latexOf(
        `<m:nary><m:naryPr><m:chr m:val="∫"/></m:naryPr><m:e>${run("x")}</m:e></m:nary>`,
      ),
    ).toBe("\\int{x}");
  });

  it("spells a greek letter as the command for it", () => {
    expect(latexOf(run("πr"))).toBe("\\pi r");
  });

  it("spells an operator Word writes as a character", () => {
    expect(latexOf(run("a ≤ b"))).toBe("a \\leq b");
  });

  it("ignores the properties that say how Word drew it", () => {
    expect(latexOf(`<m:ctrlPr/>${run("x")}`)).toBe("x");
  });
});

describe("an equation this build cannot read whole", () => {
  function because(inner: string): string | undefined {
    const reading = readEquation(math(inner));
    return reading.kind === "unreadable" ? reading.because : undefined;
  }

  // Half an equation is the one degradation that cannot be reported honestly:
  // the reader cannot see that a limit went missing.
  it("refuses the whole of it rather than the part it did not read", () => {
    const matrix = `<m:m><m:mr><m:e>${run("1")}</m:e></m:mr></m:m>`;

    expect(latexOf(`${run("A = ")}${matrix}`)).toBeUndefined();
    expect(because(`${run("A = ")}${matrix}`)).toContain("does not read yet");
  });

  it("refuses a symbol it has no command for", () => {
    expect(latexOf(run("x ⨂ y"))).toBeUndefined();
  });

  it("refuses a bracket it cannot draw", () => {
    expect(
      latexOf(
        `<m:d><m:dPr><m:begChr m:val="⌈"/></m:dPr><m:e>${run("x")}</m:e></m:d>`,
      ),
    ).toBeUndefined();
  });

  it("refuses a big operator it has no command for", () => {
    expect(
      latexOf(
        `<m:nary><m:naryPr><m:chr m:val="⨍"/></m:naryPr><m:e>${run("x")}</m:e></m:nary>`,
      ),
    ).toBeUndefined();
  });

  it("refuses an equation with nothing readable in it", () => {
    expect(because("")).toContain("no readable content");
  });
});
