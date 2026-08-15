import { describe, expect, it } from "vitest";
import {
  bibToolFor,
  DEFAULT_OPTIONS,
  readOptions,
  usesFontspec,
  type GenerationOptions,
} from "./options";

describe("readOptions", () => {
  it("returns the defaults when nothing is sent", () => {
    expect(readOptions(undefined)).toEqual(DEFAULT_OPTIONS);
  });

  it("reads a full selection", () => {
    const selection: GenerationOptions = {
      engine: "xelatex",
      bibliography: { backend: "biblatex", style: "abnt" },
      layout: "single",
    };

    expect(readOptions(selection)).toEqual(selection);
  });

  it("fills in members the caller left out", () => {
    expect(readOptions({ engine: "lualatex" })).toEqual({
      ...DEFAULT_OPTIONS,
      engine: "lualatex",
    });
  });

  const rejected: ReadonlyArray<readonly [string, unknown]> = [
    ["a value that is not an object", "xelatex"],
    ["an engine outside the list", { engine: "pdftex" }],
    ["a layout outside the list", { layout: "flat" }],
    ["a backend outside the list", { bibliography: { backend: "bibtex8" } }],
    [
      "a style outside the list",
      { bibliography: { backend: "natbib", style: "mla" } },
    ],
    // The backend decides which package is loaded and the style decides which
    // .bst it asks for; a backend on its own would compile to nothing useful.
    ["a backend with no style", { bibliography: { backend: "biblatex" } }],
  ];

  it.each(rejected)("rejects %s", (_label, payload) => {
    expect(readOptions(payload)).toBeUndefined();
  });

  it("keeps no style alongside a backend of none", () => {
    expect(
      readOptions({ bibliography: { backend: "none", style: "apa" } }),
    ).toEqual(DEFAULT_OPTIONS);
  });
});

describe("bibToolFor", () => {
  it.each([
    ["none", { backend: "none" }, "none"],
    ["biblatex", { backend: "biblatex", style: "apa" }, "biber"],
    ["natbib", { backend: "natbib", style: "ieee" }, "bibtex"],
  ] as const)("runs %s through %s", (_label, bibliography, tool) => {
    expect(bibToolFor(bibliography)).toBe(tool);
  });
});

describe("usesFontspec", () => {
  it.each([
    ["pdflatex", false],
    ["xelatex", true],
    ["lualatex", true],
  ] as const)("answers %s with %s", (engine, expected) => {
    expect(usesFontspec(engine)).toBe(expected);
  });
});
