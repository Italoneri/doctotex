import { describe, expect, it } from "vitest";
import { escapeLatex } from "./escape";

describe("escapeLatex", () => {
  const cases: ReadonlyArray<[input: string, expected: string, note: string]> =
    [
      ["plain text", "plain text", "leaves ordinary text alone"],
      ["100%", "100\\%", "percent"],
      ["A & B", "A \\& B", "ampersand"],
      ["cost $5", "cost \\$5", "dollar"],
      ["#1", "\\#1", "hash"],
      ["snake_case", "snake\\_case", "underscore"],
      ["{braced}", "\\{braced\\}", "braces"],
      ["a~b", "a\\textasciitilde{}b", "tilde"],
      ["2^10", "2\\textasciicircum{}10", "caret"],
      ["C:\\path", "C:\\textbackslash{}path", "backslash"],
      // Accents pass through: the source is UTF-8 and T1 handles them.
      ["ÍNDICE é ação", "ÍNDICE é ação", "accented characters"],
      // A no-break space is an instruction, and LaTeX spells it `~`.
      ["10\u00a0km", "10~km", "no-break space"],
    ];

  for (const [input, expected, note] of cases) {
    it(`escapes ${note}`, () => {
      expect(escapeLatex(input)).toBe(expected);
    });
  }

  // The replacement for a backslash contains braces, so escaping character by
  // character would escape the braces it had just produced.
  it("does not re-escape the braces it introduces", () => {
    expect(escapeLatex("\\")).toBe("\\textbackslash{}");
    expect(escapeLatex("\\{")).toBe("\\textbackslash{}\\{");
  });

  it("escapes every reserved character in one string", () => {
    expect(escapeLatex("#$%&_{}")).toBe("\\#\\$\\%\\&\\_\\{\\}");
  });

  // Paragraph structure is the generator's business, not the escaper's.
  it("leaves tabs and newlines for the generator", () => {
    expect(escapeLatex("a\tb\nc")).toBe("a\tb\nc");
  });

  it("returns an empty string unchanged", () => {
    expect(escapeLatex("")).toBe("");
  });
});
