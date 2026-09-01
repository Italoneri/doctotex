import JSZip from "jszip";

/**
 * Builds a real OOXML package from its parts.
 *
 * The documents this produces are not a substitute for the Word and Google Docs
 * exports in this folder — those carry the quirks a parser trips over, and no
 * generator invents those. What they are for is the other half: a checkout with
 * no `.docx` in it can still prove that a document containing a three-level
 * list, a merged table or an inline image comes out as LaTeX that compiles.
 * Gating that on a file `.gitignore` excludes makes a green suite mean nothing.
 */

const CONTENT_TYPES = "[Content_Types].xml";
const PACKAGE_RELS = "_rels/.rels";
const DOCUMENT = "word/document.xml";
const DOCUMENT_RELS = "word/_rels/document.xml.rels";
const STYLES = "word/styles.xml";
const NUMBERING = "word/numbering.xml";

const OFFICE_DOCUMENT =
  "application/vnd.openxmlformats-officedocument.wordprocessingml";

const RELATIONSHIP_BASE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** The namespaces a wordprocessing part may use, declared on every document. */
const NAMESPACES: readonly string[] = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
];

/** Content types by extension, for the `Default` entries media needs. */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  emf: "image/x-emf",
  wmf: "image/x-wmf",
};

export interface MediaPart {
  /** Bare filename under `word/media/`, e.g. `image1.png`. */
  readonly name: string;
  /** The relationship id `a:blip/@r:embed` points at. */
  readonly relationshipId: string;
  readonly bytes: Uint8Array;
}

export interface DocumentParts {
  /** The children of `w:body`, already written as XML. */
  readonly body: string;
  /** The children of `w:styles`. Omitted where the document declares none. */
  readonly styles?: string;
  /** The children of `w:numbering`. */
  readonly numbering?: string;
  readonly media?: readonly MediaPart[];
}

export async function synthesizeDocx(
  parts: DocumentParts,
): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file(CONTENT_TYPES, contentTypes(parts));
  zip.file(PACKAGE_RELS, packageRelationships());
  zip.file(DOCUMENT, documentPart(parts.body));
  zip.file(DOCUMENT_RELS, documentRelationships(parts));

  if (parts.styles !== undefined) {
    zip.file(STYLES, wrap("w:styles", parts.styles));
  }
  if (parts.numbering !== undefined) {
    zip.file(NUMBERING, wrap("w:numbering", parts.numbering));
  }
  for (const item of parts.media ?? []) {
    zip.file(`word/media/${item.name}`, item.bytes);
  }

  // No compression: these are built on every run and read once, so the time
  // spent deflating a few kilobytes is time the suite does not get back.
  return zip.generateAsync({ type: "uint8array", compression: "STORE" });
}

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function documentPart(body: string): string {
  return `${DECLARATION}
<w:document ${NAMESPACES.join(" ")}>
  <w:body>${body}</w:body>
</w:document>`;
}

function wrap(element: string, inner: string): string {
  return `${DECLARATION}
<${element} ${NAMESPACES.join(" ")}>${inner}</${element}>`;
}

function contentTypes(parts: DocumentParts): string {
  const extensions = new Set(
    (parts.media ?? []).map((item) => extensionOf(item.name)),
  );

  const defaults = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    ...[...extensions].map(
      (extension) =>
        `<Default Extension="${extension}" ContentType="${MEDIA_TYPES[extension] ?? "application/octet-stream"}"/>`,
    ),
  ];

  const overrides = [
    override("/word/document.xml", `${OFFICE_DOCUMENT}.document.main+xml`),
    parts.styles !== undefined &&
      override("/word/styles.xml", `${OFFICE_DOCUMENT}.styles+xml`),
    parts.numbering !== undefined &&
      override("/word/numbering.xml", `${OFFICE_DOCUMENT}.numbering+xml`),
  ].filter((entry): entry is string => typeof entry === "string");

  return `${DECLARATION}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  ${[...defaults, ...overrides].join("\n  ")}
</Types>`;
}

function override(partName: string, contentType: string): string {
  return `<Override PartName="${partName}" ContentType="${contentType}"/>`;
}

function packageRelationships(): string {
  return `${DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${RELATIONSHIP_BASE}/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

/**
 * The document's own relationships. Images are reached through these rather
 * than by name: `a:blip` carries an `r:embed` id and nothing else, so a package
 * whose rels are missing has pictures that cannot be resolved at all.
 */
function documentRelationships(parts: DocumentParts): string {
  const entries = [
    parts.styles !== undefined &&
      relationship("rIdStyles", "styles", "styles.xml"),
    parts.numbering !== undefined &&
      relationship("rIdNumbering", "numbering", "numbering.xml"),
    ...(parts.media ?? []).map((item) =>
      relationship(item.relationshipId, "image", `media/${item.name}`),
    ),
  ].filter((entry): entry is string => typeof entry === "string");

  return `${DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${entries.join("\n  ")}
</Relationships>`;
}

function relationship(id: string, type: string, target: string): string {
  return `<Relationship Id="${id}" Type="${RELATIONSHIP_BASE}/${type}" Target="${target}"/>`;
}

function extensionOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}
