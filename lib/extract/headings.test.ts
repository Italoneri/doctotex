import { describe, expect, it } from "vitest";
import type { Block, Paragraph, Run } from "./body";
import { inferHeadings } from "./headings";
import { collectDegradations, type Degradations } from "./report";
import { DEFAULT_CELL_MARGINS } from "./table";
import type { EffectiveStyle, TextStyle } from "./types";

const BODY: EffectiveStyle = {
  text: { fontFamily: "Times New Roman" },
  paragraph: {},
};

function run(text: string, style: TextStyle = BODY.text): Run {
  return { kind: "text", text, style };
}

function centred(text: string, runs: readonly Run[] = [run(text)]): Block {
  return {
    kind: "paragraph",
    paragraph: { style: { alignment: "center" }, runs },
  };
}

function infer(
  blocks: readonly Block[],
  degradations: Degradations = collectDegradations(),
  body: EffectiveStyle = BODY,
  declared: ReadonlySet<string> = new Set(),
): readonly Block[] {
  return inferHeadings(blocks, body, declared, degradations);
}

function promoted(blocks: readonly Block[]): readonly string[] {
  return blocks
    .filter(
      (block): block is Extract<Block, { kind: "paragraph" }> =>
        block.kind === "paragraph" && block.paragraph.inferredHeading === true,
    )
    .map((block) => textOf(block.paragraph));
}

function textOf(paragraph: Paragraph): string {
  return paragraph.runs.map((r) => (r.kind === "text" ? r.text : "")).join("");
}

describe("inferHeadings", () => {
  it("reads a centred, upper case, short paragraph as a section", () => {
    expect(promoted(infer([centred("INTRODUÇÃO")]))).toEqual(["INTRODUÇÃO"]);
  });

  it("says so in the report rather than promoting silently", () => {
    const degradations = collectDegradations();

    infer([centred("INTRODUÇÃO"), centred("CONCLUSÃO")], degradations);

    expect(degradations.report().degradations[0]).toMatchObject({
      code: "inferred-heading",
      count: 2,
    });
  });

  // A sentence in capitals ends in a full stop; a heading does not.
  it("leaves a capitalised sentence alone", () => {
    expect(promoted(infer([centred("THIS IS A SHOUTED SENTENCE.")]))).toEqual(
      [],
    );
  });

  it("leaves a paragraph that is not upper case", () => {
    expect(promoted(infer([centred("Figura 1")]))).toEqual([]);
  });

  it("leaves a paragraph too long to be a title", () => {
    const long = "A".repeat(61);

    expect(promoted(infer([centred(long)]))).toEqual([]);
  });

  it("leaves a paragraph with no letters in it", () => {
    expect(promoted(infer([centred("1234 —")]))).toEqual([]);
  });

  // A line that is also bigger or bolder is doing something else, and a
  // section's formatting would take that away.
  it("leaves a line typed differently from the body", () => {
    const title = centred("TÍTULO DO TRABALHO", [
      run("TÍTULO DO TRABALHO", {
        fontFamily: "Times New Roman",
        fontSizePt: 14,
        bold: true,
      }),
    ]);

    expect(promoted(infer([title]))).toEqual([]);
  });

  it("leaves a paragraph that already carries a heading style", () => {
    const styled: Block = {
      kind: "paragraph",
      paragraph: {
        styleId: "Titre1",
        style: { alignment: "center" },
        runs: [run("INTRODUÇÃO")],
      },
    };

    expect(
      promoted(infer([styled], undefined, BODY, new Set(["Titre1"]))),
    ).toEqual([]);
  });

  it("leaves a list item alone", () => {
    const item: Block = {
      kind: "paragraph",
      paragraph: {
        style: { alignment: "center" },
        runs: [run("FIRST STEP")],
        list: {
          numId: "1",
          level: 0,
          definition: {
            index: 0,
            format: "bullet",
            lvlText: "",
            startAt: 1,
          },
          ancestors: [],
        },
      },
    };

    expect(promoted(infer([item]))).toEqual([]);
  });

  // Being centred says nothing where everything is.
  it("reads nothing in a document whose body is centred", () => {
    const body: EffectiveStyle = {
      text: BODY.text,
      paragraph: { alignment: "center" },
    };

    expect(
      promoted(infer([centred("INTRODUÇÃO")], collectDegradations(), body)),
    ).toEqual([]);
  });

  it("leaves a picture out of the reading", () => {
    const withPicture = centred("", [
      {
        kind: "image",
        image: { part: "word/media/image1.png", widthMm: 40, heightMm: 30 },
      },
    ]);

    expect(promoted(infer([withPicture]))).toEqual([]);
  });

  // A centred line in a cell is a column heading, and \section inside a
  // tabularx is an error rather than a structure.
  it("does not reach into a table's cells", () => {
    const table: Block = {
      kind: "table",
      table: {
        columns: [{ kind: "auto" }],
        rows: [
          {
            repeatsAsHeader: false,
            cells: [
              {
                columnSpan: 1,
                rowSpan: 1,
                verticalMerge: "none",
                verticalAlign: "top",
                borders: {},
                blocks: [centred("HEADER")],
              },
            ],
          },
        ],
        borders: {},
        cellMargins: DEFAULT_CELL_MARGINS,
      },
    };

    expect(infer([table])).toEqual([table]);
  });
});
