import { describe, expect, it } from "vitest";
import { parseSequence, type SequenceNode } from "@/lib/docx/sequence";
import { parseRelationships, readDrawing } from "./media";
import { collectDegradations } from "./report";

function relsXml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
}

const IMAGE_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

function relationship(id: string, target: string, extra = ""): string {
  return `<Relationship Id="${id}" Type="${IMAGE_TYPE}" Target="${target}"${extra}/>`;
}

/** A `w:drawing` as Word writes one, with the parts the reader looks at. */
function drawing({
  embed = "rId4",
  cx = 1404620,
  cy = 1047115,
  docPr = '<wp:docPr id="2" name="Image 1" descr="a river"/>',
}: {
  embed?: string;
  cx?: number;
  cy?: number;
  docPr?: string;
} = {}): SequenceNode {
  const xml = `<w:drawing
      xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
      xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <wp:inline><wp:extent cx="${cx}" cy="${cy}"/>${docPr}
        <a:graphic><a:graphicData><pic:pic><pic:blipFill>
          <a:blip r:embed="${embed}"/>
        </pic:blipFill></pic:pic></a:graphicData></a:graphic>
      </wp:inline>
    </w:drawing>`;

  const node = parseSequence(xml)[0];
  if (!node) {
    throw new Error("the fixture does not parse");
  }
  return node;
}

describe("parseRelationships", () => {
  it("resolves a target against the part that declares it", () => {
    const rels = parseRelationships(
      relsXml(relationship("rId4", "media/image1.png")),
    );

    expect(rels.get("rId4")).toBe("word/media/image1.png");
  });

  // Word writes `../` to reach the parts that sit beside `word/`.
  it("walks out of the declaring directory on a parent segment", () => {
    const rels = parseRelationships(
      relsXml(relationship("rId1", "../customXml/item1.xml")),
    );

    expect(rels.get("rId1")).toBe("customXml/item1.xml");
  });

  it("omits an external target, which names no part", () => {
    const rels = parseRelationships(
      relsXml(
        relationship(
          "rId9",
          "https://example.com/a.png",
          ' TargetMode="External"',
        ),
      ),
    );

    expect(rels.has("rId9")).toBe(false);
  });

  it("reads attributes whatever their order inside the tag", () => {
    const rels = parseRelationships(
      relsXml(
        `<Relationship Target="media/image2.jpeg" Id="rId7" Type="${IMAGE_TYPE}"/>`,
      ),
    );

    expect(rels.get("rId7")).toBe("word/media/image2.jpeg");
  });

  it("reads a missing part as no relationships at all", () => {
    expect(parseRelationships(undefined).size).toBe(0);
  });
});

describe("readDrawing", () => {
  const relationships = new Map([
    ["rId4", "word/media/image1.png"],
    ["rId5", "word/media/image3.wmf"],
  ]);

  it("resolves the picture and converts its extent to millimetres", () => {
    const image = readDrawing(drawing(), relationships, collectDegradations());

    expect(image).toEqual({
      part: "word/media/image1.png",
      widthMm: 39.02,
      heightMm: 29.09,
      description: "a river",
    });
  });

  it("prefers the alt text a person wrote over the name Word generated", () => {
    const image = readDrawing(
      drawing({ docPr: '<wp:docPr id="2" name="Image 1" descr="a river"/>' }),
      relationships,
      collectDegradations(),
    );

    expect(image?.description).toBe("a river");
  });

  it("falls back to the picture name where there is no alt text", () => {
    const image = readDrawing(
      drawing({ docPr: '<wp:docPr id="2" name="Image 1"/>' }),
      relationships,
      collectDegradations(),
    );

    expect(image?.description).toBe("Image 1");
  });

  it("carries no description where the picture has neither", () => {
    const image = readDrawing(
      drawing({ docPr: "" }),
      relationships,
      collectDegradations(),
    );

    expect(image).not.toHaveProperty("description");
  });

  it("reports a picture whose relationship the document does not declare", () => {
    const degradations = collectDegradations();

    const image = readDrawing(
      drawing({ embed: "rId99" }),
      relationships,
      degradations,
    );

    expect(image).toBeUndefined();
    expect(degradations.report().degradations[0]?.code).toBe(
      "unresolved-image",
    );
  });

  // Word writes WMF for its own drawings and for Equation 3.0 previews, and no
  // engine reads one.
  it("reports a format no engine can include rather than emitting it", () => {
    const degradations = collectDegradations();

    const image = readDrawing(
      drawing({ embed: "rId5" }),
      relationships,
      degradations,
    );

    expect(image).toBeUndefined();
    expect(degradations.report().degradations[0]).toMatchObject({
      code: "unsupported-image-format",
      count: 1,
    });
    expect(degradations.report().degradations[0]?.detail).toContain("WMF");
  });
});
