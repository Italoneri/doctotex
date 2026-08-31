import { synthesizeDocx } from "./synthesize.ts";

/**
 * The documents the suite builds when no real `.docx` is on disk.
 *
 * Each one is written for a single question — does a nested list survive, does
 * a merged table, does an inline image — so a failure names the feature rather
 * than pointing at a document that exercises all three at once.
 */

const TWIPS_PER_LEVEL = 720;
const HANGING_TWIPS = 360;

/** Symbol's disc, Word's own default bullet, and the two below it. */
const BULLETS = ["", "o", ""] as const;

export function paragraph(text: string, properties = ""): string {
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

export function listItem(text: string, numId: string, level: number): string {
  return paragraph(
    text,
    `<w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>`,
  );
}

function indent(level: number): string {
  const left = (level + 1) * TWIPS_PER_LEVEL;
  return `<w:pPr><w:ind w:left="${left}" w:hanging="${HANGING_TWIPS}"/></w:pPr>`;
}

function numberedLevel(level: number, format: string, lvlText: string): string {
  return `<w:lvl w:ilvl="${level}">
    <w:start w:val="1"/>
    <w:numFmt w:val="${format}"/>
    <w:lvlText w:val="${lvlText}"/>
    <w:lvlJc w:val="left"/>
    ${indent(level)}
  </w:lvl>`;
}

function bulletLevel(level: number): string {
  return `<w:lvl w:ilvl="${level}">
    <w:start w:val="1"/>
    <w:numFmt w:val="bullet"/>
    <w:lvlText w:val="${BULLETS[level] ?? BULLETS[0]}"/>
    <w:lvlJc w:val="left"/>
    ${indent(level)}
    <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>
  </w:lvl>`;
}

/**
 * Three levels of numbers, three of bullets, and a numbered list interrupted by
 * an ordinary paragraph — which is the case that tells a converter that resumes
 * numbering from one that silently starts again at 1.
 */
export function listsNested(): Promise<Uint8Array> {
  const numbering = `
  <w:abstractNum w:abstractNumId="0">
    ${numberedLevel(0, "decimal", "%1.")}
    ${numberedLevel(1, "lowerLetter", "%2)")}
    ${numberedLevel(2, "lowerRoman", "%1.%2.%3.")}
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    ${bulletLevel(0)}
    ${bulletLevel(1)}
    ${bulletLevel(2)}
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="3">
    <w:abstractNumId w:val="0"/>
    <w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride>
  </w:num>`;

  const body = [
    paragraph("Assembly"),
    listItem("Open the package", "1", 0),
    listItem("Check the seal", "1", 1),
    listItem("Note the batch number", "1", 2),
    listItem("Check the contents", "1", 1),
    listItem("Fit the bracket", "1", 0),
    paragraph("Tighten by hand before reaching for a tool."),
    listItem("Close the package", "1", 0),
    paragraph("Contents"),
    listItem("Bracket", "2", 0),
    listItem("Left arm", "2", 1),
    listItem("Locking pin", "2", 2),
    listItem("Fixings", "2", 0),
    paragraph("Continued from the previous sheet:"),
    listItem("Return the packaging", "3", 0),
    sectionProperties(),
  ].join("");

  return synthesizeDocx({ body, numbering, styles: "" });
}

/**
 * A4 with 25mm margins. Every document needs one: the page reader takes its
 * geometry from the last `w:sectPr` under the body, and a document without one
 * falls back to defaults that say nothing about the file.
 */
export function sectionProperties(): string {
  return `<w:sectPr>
    <w:pgSz w:w="11906" w:h="16838"/>
    <w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="720" w:footer="720"/>
  </w:sectPr>`;
}
