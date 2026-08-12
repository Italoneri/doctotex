import { describe, expect, it } from "vitest";
import {
  findHeadingStyles,
  findTitleStyle,
  parseStyleSheet,
  resolveStyle,
} from "./styles";
import type { ThemeFonts } from "./types";

const THEME: ThemeFonts = { major: "Cambria", minor: "Calibri" };

function stylesXml(body: string, docDefaults = ""): string {
  return `<?xml version="1.0"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${docDefaults}
  ${body}
</w:styles>`;
}

function sheetFrom(body: string, docDefaults = "") {
  return parseStyleSheet(stylesXml(body, docDefaults), THEME);
}

const DOC_DEFAULTS = `
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman"/>
        <w:sz w:val="20"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr><w:spacing w:after="0"/></w:pPr>
    </w:pPrDefault>
  </w:docDefaults>`;

describe("docDefaults", () => {
  it("supplies formatting no style overrides", () => {
    const sheet = sheetFrom("", DOC_DEFAULTS);

    expect(sheet.docDefaults.text.fontFamily).toBe("Times New Roman");
    expect(sheet.docDefaults.text.fontSizePt).toBe(10);
    expect(sheet.docDefaults.paragraph.spaceAfterPt).toBe(0);
  });

  it("is the floor every resolved style starts from", () => {
    const sheet = sheetFrom(
      `<w:style w:type="paragraph" w:styleId="Quote">
         <w:name w:val="Quote"/>
         <w:pPr><w:jc w:val="center"/></w:pPr>
       </w:style>`,
      DOC_DEFAULTS,
    );

    const resolved = resolveStyle(sheet, "Quote");

    expect(resolved.text.fontFamily).toBe("Times New Roman");
    expect(resolved.paragraph.alignment).toBe("center");
  });
});

describe("basedOn cascade", () => {
  const CHAIN = `
    <w:style w:type="paragraph" w:styleId="Normal">
      <w:name w:val="Normal"/>
      <w:rPr><w:rFonts w:ascii="Georgia"/><w:sz w:val="22"/><w:b/></w:rPr>
    </w:style>
    <w:style w:type="paragraph" w:styleId="Base">
      <w:name w:val="Base"/>
      <w:basedOn w:val="Normal"/>
      <w:rPr><w:sz w:val="28"/></w:rPr>
    </w:style>
    <w:style w:type="paragraph" w:styleId="Leaf">
      <w:name w:val="Leaf"/>
      <w:basedOn w:val="Base"/>
      <w:rPr><w:i/></w:rPr>
    </w:style>`;

  it("inherits through a three-link chain", () => {
    const resolved = resolveStyle(sheetFrom(CHAIN), "Leaf");

    expect(resolved.text.fontFamily).toBe("Georgia");
    expect(resolved.text.fontSizePt).toBe(14);
    expect(resolved.text.italic).toBe(true);
  });

  it("lets a descendant switch an inherited toggle back off", () => {
    const sheet = sheetFrom(`
      <w:style w:type="paragraph" w:styleId="Normal">
        <w:name w:val="Normal"/>
        <w:rPr><w:b/></w:rPr>
      </w:style>
      <w:style w:type="paragraph" w:styleId="Plain">
        <w:name w:val="Plain"/>
        <w:basedOn w:val="Normal"/>
        <w:rPr><w:b w:val="0"/></w:rPr>
      </w:style>`);

    expect(resolveStyle(sheet, "Normal").text.bold).toBe(true);
    expect(resolveStyle(sheet, "Plain").text.bold).toBe(false);
  });

  it("survives a basedOn cycle instead of recursing forever", () => {
    const sheet = sheetFrom(`
      <w:style w:type="paragraph" w:styleId="A">
        <w:name w:val="A"/><w:basedOn w:val="B"/>
        <w:rPr><w:sz w:val="20"/></w:rPr>
      </w:style>
      <w:style w:type="paragraph" w:styleId="B">
        <w:name w:val="B"/><w:basedOn w:val="A"/>
        <w:rPr><w:i/></w:rPr>
      </w:style>`);

    const resolved = resolveStyle(sheet, "A");

    expect(resolved.text.fontSizePt).toBe(10);
    expect(resolved.text.italic).toBe(true);
  });

  it("stops at a basedOn pointing to a style that is not defined", () => {
    const sheet = sheetFrom(`
      <w:style w:type="paragraph" w:styleId="Orphan">
        <w:name w:val="Orphan"/><w:basedOn w:val="Missing"/>
        <w:rPr><w:sz w:val="24"/></w:rPr>
      </w:style>`);

    expect(resolveStyle(sheet, "Orphan").text.fontSizePt).toBe(12);
  });

  it("returns docDefaults for a style id that does not exist", () => {
    const sheet = sheetFrom("", DOC_DEFAULTS);

    expect(resolveStyle(sheet, "Nope")).toEqual(sheet.docDefaults);
  });
});

describe("theme fonts", () => {
  it("resolves a theme slot to the typeface the theme assigns it", () => {
    const sheet = sheetFrom(`
      <w:style w:type="paragraph" w:styleId="Body">
        <w:name w:val="Body"/>
        <w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr>
      </w:style>`);

    expect(resolveStyle(sheet, "Body").text.fontFamily).toBe("Calibri");
  });

  it("resolves the major slot for heading faces", () => {
    const sheet = sheetFrom(`
      <w:style w:type="paragraph" w:styleId="H">
        <w:name w:val="heading 1"/>
        <w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/></w:rPr>
      </w:style>`);

    expect(resolveStyle(sheet, "H").text.fontFamily).toBe("Cambria");
  });

  it("prefers an explicit typeface over the theme slot", () => {
    const sheet = sheetFrom(`
      <w:style w:type="paragraph" w:styleId="Body">
        <w:name w:val="Body"/>
        <w:rPr><w:rFonts w:ascii="Verdana" w:asciiTheme="minorHAnsi"/></w:rPr>
      </w:style>`);

    expect(resolveStyle(sheet, "Body").text.fontFamily).toBe("Verdana");
  });
});

describe("line spacing", () => {
  const cases: ReadonlyArray<[attrs: string, expected: unknown, note: string]> =
    [
      [
        'w:line="360" w:lineRule="auto"',
        { kind: "multiple", value: 1.5 },
        "auto is a multiplier",
      ],
      [
        'w:line="276"',
        { kind: "multiple", value: 1.15 },
        "a missing lineRule defaults to auto",
      ],
      [
        'w:line="240" w:lineRule="exact"',
        { kind: "exact", pt: 12 },
        "exact is absolute twips",
      ],
      [
        'w:line="300" w:lineRule="atLeast"',
        { kind: "atLeast", pt: 15 },
        "atLeast is absolute twips",
      ],
    ];

  for (const [attrs, expected, note] of cases) {
    it(note, () => {
      const sheet = sheetFrom(`
        <w:style w:type="paragraph" w:styleId="S">
          <w:name w:val="S"/><w:pPr><w:spacing ${attrs}/></w:pPr>
        </w:style>`);

      expect(resolveStyle(sheet, "S").paragraph.lineSpacing).toEqual(expected);
    });
  }

  it("reports no spacing when w:line is absent", () => {
    const sheet = sheetFrom(`
      <w:style w:type="paragraph" w:styleId="S">
        <w:name w:val="S"/><w:pPr><w:spacing w:after="120"/></w:pPr>
      </w:style>`);

    const { lineSpacing, spaceAfterPt } = resolveStyle(sheet, "S").paragraph;

    expect(lineSpacing).toBeUndefined();
    expect(spaceAfterPt).toBe(6);
  });
});

describe("indentation", () => {
  it("reads a first-line indent", () => {
    const sheet = sheetFrom(`
      <w:style w:type="paragraph" w:styleId="S">
        <w:name w:val="S"/><w:pPr><w:ind w:left="720" w:firstLine="567"/></w:pPr>
      </w:style>`);

    const { indentLeftMm, indentFirstLineMm } = resolveStyle(
      sheet,
      "S",
    ).paragraph;

    expect(indentLeftMm).toBe(12.7);
    expect(indentFirstLineMm).toBe(10);
  });

  it("reads a hanging indent as a negative first line", () => {
    const sheet = sheetFrom(`
      <w:style w:type="paragraph" w:styleId="S">
        <w:name w:val="S"/><w:pPr><w:ind w:hanging="567"/></w:pPr>
      </w:style>`);

    expect(resolveStyle(sheet, "S").paragraph.indentFirstLineMm).toBe(-10);
  });

  it("prefers w:start over the older w:left", () => {
    const sheet = sheetFrom(`
      <w:style w:type="paragraph" w:styleId="S">
        <w:name w:val="S"/><w:pPr><w:ind w:left="720" w:start="1440"/></w:pPr>
      </w:style>`);

    expect(resolveStyle(sheet, "S").paragraph.indentLeftMm).toBe(25.4);
  });
});

describe("findHeadingStyles", () => {
  // Style IDs here are the French ones Word actually writes; only w:name is
  // canonical, which is exactly the trap this function exists to avoid.
  const LOCALISED = `
    <w:style w:type="paragraph" w:styleId="Titre4">
      <w:name w:val="heading 4"/><w:rPr><w:sz w:val="20"/></w:rPr>
    </w:style>
    <w:style w:type="paragraph" w:styleId="Titre1">
      <w:name w:val="heading 1"/><w:rPr><w:sz w:val="32"/></w:rPr>
    </w:style>
    <w:style w:type="paragraph" w:styleId="Titre3">
      <w:name w:val="heading 3"/><w:rPr><w:sz w:val="24"/></w:rPr>
    </w:style>
    <w:style w:type="paragraph" w:styleId="Titre">
      <w:name w:val="Title"/><w:rPr><w:sz w:val="56"/></w:rPr>
    </w:style>`;

  it("finds headings by name even when the ids are localised", () => {
    const headings = findHeadingStyles(sheetFrom(LOCALISED));

    expect(headings.map((h) => h.styleId)).toEqual([
      "Titre1",
      "Titre3",
      "Titre4",
    ]);
  });

  it("keeps levels sparse rather than filling the gaps", () => {
    const headings = findHeadingStyles(sheetFrom(LOCALISED));

    expect(headings.map((h) => h.level)).toEqual([1, 3, 4]);
  });

  it("resolves each heading through its own cascade", () => {
    const headings = findHeadingStyles(sheetFrom(LOCALISED));

    expect(headings.map((h) => h.text.fontSizePt)).toEqual([16, 12, 10]);
  });

  it("does not treat Title as a heading level", () => {
    const headings = findHeadingStyles(sheetFrom(LOCALISED));

    expect(headings.some((h) => h.styleId === "Titre")).toBe(false);
  });

  it("returns nothing when the document declares no headings", () => {
    const sheet = sheetFrom(
      `<w:style w:type="paragraph" w:styleId="Normal">
         <w:name w:val="Normal"/>
       </w:style>`,
    );

    expect(findHeadingStyles(sheet)).toEqual([]);
  });
});

describe("findTitleStyle", () => {
  it("finds Title by canonical name", () => {
    const sheet = sheetFrom(`
      <w:style w:type="paragraph" w:styleId="Titre">
        <w:name w:val="Title"/><w:rPr><w:sz w:val="56"/></w:rPr>
      </w:style>`);

    expect(findTitleStyle(sheet)?.text.fontSizePt).toBe(28);
  });

  it("returns undefined when the document has no Title style", () => {
    expect(findTitleStyle(sheetFrom(""))).toBeUndefined();
  });
});

describe("colour", () => {
  it("reads an explicit colour", () => {
    const sheet = sheetFrom(`
      <w:style w:type="paragraph" w:styleId="S">
        <w:name w:val="S"/><w:rPr><w:color w:val="1F4E79"/></w:rPr>
      </w:style>`);

    expect(resolveStyle(sheet, "S").text.colorHex).toBe("#1F4E79");
  });

  it("lets w:val=auto inherit rather than collapsing to black", () => {
    const sheet = sheetFrom(`
      <w:style w:type="paragraph" w:styleId="Normal">
        <w:name w:val="Normal"/><w:rPr><w:color w:val="C00000"/></w:rPr>
      </w:style>
      <w:style w:type="paragraph" w:styleId="Auto">
        <w:name w:val="Auto"/><w:basedOn w:val="Normal"/>
        <w:rPr><w:color w:val="auto"/></w:rPr>
      </w:style>`);

    expect(resolveStyle(sheet, "Auto").text.colorHex).toBe("#C00000");
  });
});

describe("parseStyleSheet", () => {
  it("returns an empty sheet when styles.xml is absent", () => {
    const sheet = parseStyleSheet(undefined, THEME);

    expect(sheet.definitions.size).toBe(0);
    expect(sheet.docDefaults).toEqual({ text: {}, paragraph: {} });
  });

  it("skips a style that declares no id", () => {
    const sheet = sheetFrom(
      `<w:style w:type="paragraph"><w:name w:val="Nameless"/></w:style>`,
    );

    expect(sheet.definitions.size).toBe(0);
  });

  it("reads a single style even though the parser does not array it", () => {
    const sheet = sheetFrom(
      `<w:style w:type="paragraph" w:styleId="Only"><w:name w:val="Only"/></w:style>`,
    );

    expect(sheet.definitions.get("Only")?.name).toBe("only");
  });
});
