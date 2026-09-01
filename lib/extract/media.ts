import type { DocxArchive } from "@/lib/docx/archive";
import {
  attributeOf,
  findDescendant,
  type SequenceNode,
} from "@/lib/docx/sequence";
import type { Degradations } from "./report";
import { emuToMm, toInteger } from "./units";

/**
 * The generated files that are not text, by the path the sources refer to them
 * by. Kept apart from the sources rather than mixed in: the editor shows text
 * and a reader edits it, and neither is true of a JPEG.
 */
export type Assets = ReadonlyMap<string, Uint8Array>;

/** The part a relationship id points at, as a path inside the package. */
export type Relationships = ReadonlyMap<string, string>;

export const DOCUMENT_RELATIONSHIPS = "word/_rels/document.xml.rels";

/** Relationship targets are relative to the part that declares them. */
const RELATIONSHIP_BASE = "word";

/**
 * Everything about a picture except its bytes, which stay in the archive until
 * something asks for them. A block list is passed around, compared and held in
 * component state; carrying a megabyte of JPEG inside it would make every one
 * of those operations pay for the image.
 */
export interface ImageRef {
  /** The part that holds it, e.g. `word/media/image2.jpeg`. */
  readonly part: string;
  readonly widthMm: number;
  readonly heightMm: number;
  /** Word's picture name or alt text, repeated in the generated source. */
  readonly description?: string;
}

/**
 * The formats a LaTeX engine can include without a conversion step.
 *
 * pdfLaTeX, XeLaTeX and LuaLaTeX agree on these three. WMF and EMF are the
 * ones Word writes for its own drawings and for Equation 3.0 previews, and no
 * engine reads either — they are reported rather than emitted, because a
 * `\includegraphics` of a file TeX cannot read stops the compile.
 */
const INCLUDABLE_FORMATS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "pdf",
]);

export function parseRelationships(xml: string | undefined): Relationships {
  if (!xml) {
    return new Map();
  }

  const relationships = new Map<string, string>();

  for (const [element] of xml.matchAll(RELATIONSHIP_PATTERN)) {
    const id = attribute(element, "Id");
    const target = attribute(element, "Target");

    // An external target is a URL rather than a part, and nothing in the
    // package holds it.
    if (id && target && attribute(element, "TargetMode") !== "External") {
      relationships.set(id, resolvePart(target));
    }
  }

  return relationships;
}

/**
 * The rels part is a flat list of empty elements whose order carries nothing,
 * so it is read by pattern rather than parsed into a tree. Each element is
 * matched whole and its attributes read from it, because their order inside
 * the tag is not fixed.
 */
const RELATIONSHIP_PATTERN = /<Relationship\b[^>]*>/g;

function attribute(element: string, name: string): string | undefined {
  return element.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

/**
 * A target is relative to the declaring part's directory, so `media/image1.png`
 * inside `word/_rels/` names `word/media/image1.png`. Word also writes `../` to
 * reach parts outside `word/`, which is why the segments are walked rather than
 * concatenated.
 */
function resolvePart(target: string): string {
  const segments = RELATIONSHIP_BASE.split("/");

  for (const segment of target.split("/")) {
    if (segment === "..") {
      segments.pop();
    } else if (segment !== "." && segment !== "") {
      segments.push(segment);
    }
  }

  return segments.join("/");
}

/**
 * The picture a `w:drawing` places, or nothing when it places one this build
 * cannot carry. Both outcomes are recorded: an image that disappears without a
 * word is the failure this report exists to prevent.
 *
 * `wp:inline` and `wp:anchor` differ in how the text flows around the picture,
 * not in which picture it is, so both are read the same way. Where the anchor
 * floats is lost, and said so.
 */
export function readDrawing(
  node: SequenceNode,
  relationships: Relationships,
  degradations: Degradations,
): ImageRef | undefined {
  const embed = attributeOf(findDescendant([node], "a:blip"), "r:embed");
  const part = embed ? relationships.get(embed) : undefined;

  if (!part) {
    degradations.note(
      "unresolved-image",
      "A picture points at a relationship the document does not declare, so there is nothing to include.",
    );
    return undefined;
  }

  const format = formatOf(part);
  if (!INCLUDABLE_FORMATS.has(format)) {
    degradations.note(
      "unsupported-image-format",
      `A picture is stored as ${format.toUpperCase()}, which no LaTeX engine can include. It is left out rather than emitted as a file the compile would stop on.`,
    );
    return undefined;
  }

  const extent = findDescendant([node], "wp:extent");
  const description = describe(node);

  return {
    part,
    widthMm: emuToMm(toInteger(attributeOf(extent, "cx")) ?? 0),
    heightMm: emuToMm(toInteger(attributeOf(extent, "cy")) ?? 0),
    ...(description ? { description } : {}),
  };
}

/**
 * Word keeps the picture's name and its alt text in `wp:docPr`. The alt text is
 * the one a person wrote, so it wins over the name Word generated.
 */
function describe(node: SequenceNode): string | undefined {
  const properties = findDescendant([node], "wp:docPr");
  const description =
    attributeOf(properties, "descr") ?? attributeOf(properties, "name");
  return description?.trim() || undefined;
}

function formatOf(part: string): string {
  return part.slice(part.lastIndexOf(".") + 1).toLowerCase();
}

/**
 * What the generated sources call a picture, derived from where it sat in the
 * package. Word already names its media uniquely within a document, so keeping
 * that name means the archive a reader unpacks matches what the `.tex` refers
 * to without a second mapping anyone has to keep in step.
 */
export function assetPathFor(part: string): string {
  return part.replace(/^word\//, "");
}

/**
 * The bytes behind the given parts, keyed by the path the sources use.
 *
 * Read on demand rather than during the body walk: most of what a `.docx`
 * weighs is its media, and a conversion that only reports on the document
 * should not decompress a 20 MB photograph to do it.
 */
export async function readImages(
  archive: DocxArchive,
  parts: readonly string[],
): Promise<Assets> {
  const entries = await Promise.all(
    parts.map(async (part) => {
      const bytes = await archive.zip.file(part)?.async("uint8array");
      return bytes ? ([assetPathFor(part), bytes] as const) : undefined;
    }),
  );

  return new Map(entries.filter((entry) => entry !== undefined));
}
