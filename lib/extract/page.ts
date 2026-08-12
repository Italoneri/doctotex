import {
  attribute,
  child,
  parseXml,
  toArray,
  type XmlNode,
} from "@/lib/docx/xml";
import { toInteger, twipsToMm } from "./units";
import type { Orientation, PageGeometry, PageMargins } from "./types";

/**
 * Used when a document omits `w:pgSz` or `w:pgMar` entirely. A4 with 25mm
 * margins is Word's default outside en-US locales and a safer guess than Letter
 * for the documents this tool targets.
 */
const FALLBACK: PageGeometry = {
  widthMm: 210,
  heightMm: 297,
  orientation: "portrait",
  margins: {
    topMm: 25,
    bottomMm: 25,
    leftMm: 25,
    rightMm: 25,
    headerMm: 12.5,
    footerMm: 12.5,
  },
};

export function extractPage(documentXml: string): PageGeometry {
  const body = child(child(parseXml(documentXml), "w:document"), "w:body");
  const section = finalSection(body);
  if (!section) {
    return FALLBACK;
  }

  const size = child(section, "w:pgSz");
  const widthMm = twipsAttributeToMm(size, "w:w") ?? FALLBACK.widthMm;
  const heightMm = twipsAttributeToMm(size, "w:h") ?? FALLBACK.heightMm;

  return {
    widthMm,
    heightMm,
    orientation: readOrientation(
      attribute(size, "w:orient"),
      widthMm,
      heightMm,
    ),
    margins: readMargins(child(section, "w:pgMar")),
  };
}

/**
 * A document with section breaks carries several `w:sectPr`, but only the last
 * one sits directly under `w:body` — the earlier ones are nested inside the
 * paragraph that ends their section. That final one describes the document as a
 * whole, which is what a single LaTeX class can express.
 */
function finalSection(body: XmlNode | undefined): XmlNode | undefined {
  const sections = toArray(body?.["w:sectPr"]);
  return sections.at(-1);
}

/**
 * Word already swaps `w:w` and `w:h` for landscape, so `w:orient` is metadata
 * rather than an instruction. When it is missing, the shape tells us.
 */
function readOrientation(
  raw: string | undefined,
  widthMm: number,
  heightMm: number,
): Orientation {
  if (raw === "landscape") {
    return "landscape";
  }
  if (raw === "portrait") {
    return "portrait";
  }
  return widthMm > heightMm ? "landscape" : "portrait";
}

function readMargins(margins: XmlNode | undefined): PageMargins {
  return {
    topMm: twipsAttributeToMm(margins, "w:top") ?? FALLBACK.margins.topMm,
    bottomMm:
      twipsAttributeToMm(margins, "w:bottom") ?? FALLBACK.margins.bottomMm,
    leftMm: twipsAttributeToMm(margins, "w:left") ?? FALLBACK.margins.leftMm,
    rightMm: twipsAttributeToMm(margins, "w:right") ?? FALLBACK.margins.rightMm,
    headerMm:
      twipsAttributeToMm(margins, "w:header") ?? FALLBACK.margins.headerMm,
    footerMm:
      twipsAttributeToMm(margins, "w:footer") ?? FALLBACK.margins.footerMm,
  };
}

function twipsAttributeToMm(
  node: XmlNode | undefined,
  name: string,
): number | undefined {
  const twips = toInteger(attribute(node, name));
  // Word writes negative margins for gutters that bleed off the page; LaTeX's
  // geometry package cannot express those, so they fall back to the default.
  return twips === undefined || twips < 0 ? undefined : twipsToMm(twips);
}
