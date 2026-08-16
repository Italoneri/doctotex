import { describe, expect, it } from "vitest";
import { hasFixture, readFixture } from "@/fixtures/fixture";
import { openDocx, readTextPart } from "@/lib/docx/archive";
import { extractParagraphs, type Paragraph } from "@/lib/extract/body";
import { extractStyleProfile } from "@/lib/extract/profile";
import type { StyleProfile } from "@/lib/extract/types";
import { BIB_FILE } from "./bib";
import { CLASS_FILE, generateSources, type SourceFiles } from "./bundle";
import { compile, type CompileResult, isDockerAvailable } from "./compile";
import {
  bibToolFor,
  DEFAULT_OPTIONS,
  ENGINES,
  type Bibliography,
  type GenerationOptions,
  type Layout,
} from "./options";
import { MAIN_FILE } from "./tex";

const FIXTURE = "exemplo.docx";

/** Compiling needs a daemon; without one the suite skips rather than fails. */
const dockerUp = await isDockerAvailable();

const describeCompiling = describe.skipIf(!dockerUp || !hasFixture(FIXTURE));

/** Generous: a first pass pulls fonts into the container's cache. */
const COMPILE_TIMEOUT = { timeout: 300_000 };

/** Three engine passes and a bibliography tool, on a container that is cold. */
const MATRIX_TIMEOUT = { timeout: 600_000 };

async function sourcesFromFixture(): Promise<SourceFiles> {
  const archive = await openDocx(await readFixture(FIXTURE));
  const documentXml = (await readTextPart(archive, "word/document.xml")) ?? "";

  return generateSources({
    profile: await extractStyleProfile(archive),
    paragraphs: extractParagraphs(documentXml),
  });
}

describeCompiling("generated sources", () => {
  it("contain the class and the document", COMPILE_TIMEOUT, async () => {
    const sources = await sourcesFromFixture();

    expect([...sources.keys()]).toEqual([CLASS_FILE, MAIN_FILE]);
  });

  it("compile under pdfLaTeX without errors", COMPILE_TIMEOUT, async () => {
    const result = await compile(await sourcesFromFixture(), MAIN_FILE);

    // The log is the only place TeX explains itself, so a failure carries it
    // rather than reporting a bare kind.
    if (result.kind !== "compiled") {
      throw new Error(`pdflatex failed:\n${describe_(result)}`);
    }
    expect(result.pdf.length).toBeGreaterThan(1000);
  });
});

/**
 * The option matrix, over a document this file builds rather than a fixture.
 *
 * Every option changes what the generator emits, and the only thing that
 * settles whether the emission is valid LaTeX is TeX. Using a synthetic profile
 * keeps that check running on a machine with no sample .docx to hand — a matrix
 * that skips is a matrix that proves nothing.
 */
const PROFILE: StyleProfile = {
  page: {
    widthMm: 210,
    heightMm: 297,
    orientation: "portrait",
    margins: {
      topMm: 30,
      bottomMm: 20,
      leftMm: 30,
      rightMm: 25,
      headerMm: 12.5,
      footerMm: 12.5,
    },
  },
  defaults: {
    text: { fontFamily: "Times New Roman", fontSizePt: 12 },
    paragraph: { lineSpacing: { kind: "multiple", value: 1.5 } },
  },
  headings: [
    {
      level: 1,
      styleId: "Heading1",
      text: { fontFamily: "Arial", fontSizePt: 16, bold: true },
      paragraph: { spaceBeforePt: 12, spaceAfterPt: 6 },
    },
    {
      level: 2,
      styleId: "Heading2",
      text: { fontFamily: "Arial", fontSizePt: 13, bold: true },
      paragraph: { spaceBeforePt: 10, spaceAfterPt: 4 },
    },
  ],
  title: {
    styleId: "Title",
    text: { fontFamily: "Arial", fontSizePt: 24, bold: true },
    paragraph: { alignment: "center" },
  },
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

const PARAGRAPHS: readonly Paragraph[] = [
  { styleId: "Title", runs: [text("A Generated Template")] },
  { styleId: "Heading1", runs: [text("Introduction")] },
  {
    runs: [
      text("Body text with "),
      { text: "bold", bold: true, italic: false },
      text(" and reserved characters: 50% of A&B costs $3_00 #1 {x} ~y ^z."),
    ],
  },
  { styleId: "Heading2", runs: [text("Method")] },
  { runs: [text("A second paragraph, to give the page something to break.")] },
];

function text(value: string): Paragraph["runs"][number] {
  return { text: value, bold: false, italic: false };
}

function sourcesFor(overrides: Partial<GenerationOptions>): {
  readonly sources: SourceFiles;
  readonly options: GenerationOptions;
} {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  return {
    options,
    sources: generateSources({
      profile: PROFILE,
      paragraphs: PARAGRAPHS,
      options,
    }),
  };
}

async function expectCompiles(
  overrides: Partial<GenerationOptions>,
): Promise<void> {
  const { sources, options } = sourcesFor(overrides);
  const result = await compile(sources, MAIN_FILE, {
    engine: options.engine,
    bibTool: bibToolFor(options.bibliography),
  });

  if (result.kind !== "compiled") {
    throw new Error(
      `${JSON.stringify(overrides)} failed:\n${describe_(result)}`,
    );
  }
  expect(result.pdf.length).toBeGreaterThan(1000);
}

const BIBLIOGRAPHIES: readonly Bibliography[] = [
  { backend: "none" },
  { backend: "biblatex", style: "apa" },
  { backend: "biblatex", style: "ieee" },
  { backend: "biblatex", style: "abnt" },
  { backend: "natbib", style: "apa" },
  { backend: "natbib", style: "ieee" },
  { backend: "natbib", style: "abnt" },
];

const LAYOUTS: readonly Layout[] = ["multi", "single"];

/**
 * The whole cross product is 42 compiles, which is minutes of container time on
 * every run of the suite. `DOCTOTEX_MATRIX=full npm test` asks for it; the
 * default is the smaller set below.
 */
const exhaustive = process.env.DOCTOTEX_MATRIX === "full";

/**
 * One case per option, plus the crossings that can actually break.
 *
 * A cover of each option in isolation misses a pair that only fails together,
 * and fontspec beside a bibliography is where that risk sits: both rewrite the
 * preamble, and the tools between the passes read what they leave behind. The
 * rest of the product is independent by construction — the layout decides which
 * file the preamble lands in and nothing else reads that decision.
 */
function matrix(): readonly GenerationOptions[] {
  if (exhaustive) {
    return ENGINES.flatMap((engine) =>
      BIBLIOGRAPHIES.flatMap((bibliography) =>
        LAYOUTS.map((layout) => ({ engine, bibliography, layout })),
      ),
    );
  }

  const perOption: readonly GenerationOptions[] = [
    ...ENGINES.map((engine) => ({ ...DEFAULT_OPTIONS, engine })),
    ...BIBLIOGRAPHIES.map((bibliography) => ({
      ...DEFAULT_OPTIONS,
      bibliography,
    })),
    ...LAYOUTS.map((layout) => ({ ...DEFAULT_OPTIONS, layout })),
  ];

  const crossings: readonly GenerationOptions[] = [
    {
      engine: "xelatex",
      bibliography: { backend: "biblatex", style: "apa" },
      layout: "multi",
    },
    {
      engine: "xelatex",
      bibliography: { backend: "natbib", style: "abnt" },
      layout: "multi",
    },
    {
      engine: "lualatex",
      bibliography: { backend: "biblatex", style: "ieee" },
      layout: "multi",
    },
    {
      engine: "lualatex",
      bibliography: { backend: "natbib", style: "apa" },
      layout: "multi",
    },
    {
      engine: "xelatex",
      bibliography: { backend: "biblatex", style: "apa" },
      layout: "single",
    },
  ];

  return distinct([...perOption, ...crossings]);
}

/**
 * The defaults belong to all three option groups, so covering each option once
 * names pdfLaTeX with no bibliography and a separate class three times. Each
 * repeat is a container start that proves what the first already proved.
 *
 * `label` reads every field, which is what makes it usable as the identity.
 */
function distinct(
  options: readonly GenerationOptions[],
): readonly GenerationOptions[] {
  return [...new Map(options.map((o) => [label(o), o])).values()];
}

function label({ engine, bibliography, layout }: GenerationOptions): string {
  const cites =
    bibliography.backend === "none"
      ? "no bibliography"
      : `${bibliography.backend}/${bibliography.style}`;
  return `${engine}, ${cites}, ${layout}`;
}

// Pure, so it runs whether or not a daemon is up.
describe("the generated file list", () => {
  it("drops the class when the preamble is inlined", () => {
    expect([...sourcesFor({ layout: "single" }).sources.keys()]).toEqual([
      MAIN_FILE,
    ]);
  });

  it("adds the bib file only when something will read it", () => {
    expect([
      ...sourcesFor({
        layout: "single",
        bibliography: { backend: "biblatex", style: "apa" },
      }).sources.keys(),
    ]).toEqual([MAIN_FILE, BIB_FILE]);
  });
});

describe.skipIf(!dockerUp)("every option compiles", () => {
  it.each(matrix().map((options) => [label(options), options] as const))(
    "%s",
    MATRIX_TIMEOUT,
    async (_name, options) => {
      await expectCompiles(options);
    },
  );
});

describe.skipIf(!dockerUp)("compile", () => {
  it("reports the log rather than throwing", COMPILE_TIMEOUT, async () => {
    const broken: SourceFiles = new Map([
      [
        MAIN_FILE,
        "\\documentclass{article}\n\\begin{document}\n\\undefinedmacro\n\\end{document}\n",
      ],
    ]);

    const result = await compile(broken, MAIN_FILE);

    expect(result.kind).toBe("rejected");
    expect(result.kind === "rejected" && result.log).toContain(
      "Undefined control sequence",
    );
  });
});

// Needs no daemon, which is the point: it is the case where there isn't one.
describe("an engine that cannot be reached", () => {
  it("is reported apart from a rejected document", async () => {
    const result = await compile(
      new Map([[MAIN_FILE, "\\documentclass{article}"]]),
      MAIN_FILE,
      { docker: "docker-that-does-not-exist" },
    );

    expect(result.kind).toBe("unavailable");
    expect(result.kind === "unavailable" && result.reason).toContain(
      "was not found",
    );
  });
});

function describe_(result: CompileResult): string {
  return result.kind === "unavailable"
    ? result.reason
    : result.log.slice(-5000);
}
