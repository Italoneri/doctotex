import { readTextPart, type DocxArchive } from "@/lib/docx/archive";
import { DocxFormatError } from "@/lib/docx/archive";
import { extractBlocks, imagePartsOf, type Block } from "./body";
import {
  assetPathFor,
  DOCUMENT_RELATIONSHIPS,
  parseRelationships,
  readImages,
  type Assets,
} from "./media";
import { parseNumbering } from "./numbering";
import { extractPage } from "./page";
import {
  collectDegradations,
  type ConversionReport,
  type Degradations,
} from "./report";
import { extractTheme } from "./theme";
import {
  findHeadingStyles,
  findTitleStyle,
  parseStyleSheet,
  resolveStyle,
} from "./styles";
import type { DocumentFeatures, StyleProfile } from "./types";

const MAIN_DOCUMENT = "word/document.xml";
const STYLES = "word/styles.xml";
const NUMBERING = "word/numbering.xml";

/** Word numbers theme parts, and a few generators emit `theme.xml` unnumbered. */
const THEME_PATTERN = /^word\/theme\/theme\d*\.xml$/;

/** Word's built-in style ID for body text, before any localisation. */
const NORMAL_STYLE_ID = "Normal";

/** What one `.docx` yields: how it looks, what it says, and what was lost. */
export interface ExtractedDocument {
  readonly profile: StyleProfile;
  readonly blocks: readonly Block[];
  readonly report: ConversionReport;
  /** The bytes of every picture the blocks include, by their source path. */
  readonly assets: Assets;
}

/**
 * The two halves are extracted together because the second needs the first: a
 * paragraph's own formatting is the last level of the same cascade the
 * stylesheet begins, so resolving it needs the stylesheet in hand. Reading the
 * parts separately also decompressed the largest one twice.
 */
export async function extractDocument(
  archive: DocxArchive,
): Promise<ExtractedDocument> {
  const documentXml = await readTextPart(archive, MAIN_DOCUMENT);
  if (!documentXml) {
    throw new DocxFormatError(`${MAIN_DOCUMENT} could not be read.`);
  }

  const degradations = collectDegradations();
  const theme = extractTheme(await readThemePart(archive));
  const sheet = parseStyleSheet(await readTextPart(archive, STYLES), theme);
  const numbering = parseNumbering(
    await readTextPart(archive, NUMBERING),
    degradations,
  );

  const blocks = extractBlocks(documentXml, {
    sheet,
    numbering,
    degradations,
    // A picture names a relationship id, never a part, so the body cannot be
    // read into anything includable without this map in hand.
    relationships: parseRelationships(
      await readTextPart(archive, DOCUMENT_RELATIONSHIPS),
    ),
  });

  const assets = await readCarriedImages(archive, blocks, degradations);

  return {
    profile: {
      page: extractPage(documentXml),
      // Body text is the Normal style resolved against docDefaults, which is
      // what an unstyled paragraph actually renders as.
      defaults: resolveStyle(sheet, normalStyleId(sheet)),
      headings: findHeadingStyles(sheet),
      title: findTitleStyle(sheet),
      theme,
      features: detectFeatures(archive, documentXml),
    },
    blocks,
    assets,
    // Read after the walk, and after the media: both fill the collector.
    report: degradations.report(),
  };
}

/**
 * The pictures the walk kept, with the ones the package does not actually hold
 * reported instead.
 *
 * A relationship can name a part that is not in the archive — Word writes one
 * for a linked picture whose file lives on the author's disk. Emitting an
 * `\includegraphics` for it would stop the compile on the reader's machine,
 * which is a worse answer than saying the picture is missing.
 */
async function readCarriedImages(
  archive: DocxArchive,
  blocks: readonly Block[],
  degradations: Degradations,
): Promise<Assets> {
  const parts = imagePartsOf(blocks);
  const assets = await readImages(archive, parts);

  for (const part of parts) {
    if (!assets.has(assetPathFor(part))) {
      degradations.note(
        "unresolved-image",
        `The document places a picture from ${part}, which the package does not contain. It is left out rather than written as a file the compile would stop on.`,
      );
    }
  }

  return assets;
}

/**
 * "Normal" is localised in the same way heading IDs are, so it is found by its
 * canonical name first and only then by the English ID.
 */
function normalStyleId(sheet: ReturnType<typeof parseStyleSheet>): string {
  for (const definition of sheet.definitions.values()) {
    if (definition.name === "normal") {
      return definition.styleId;
    }
  }
  return NORMAL_STYLE_ID;
}

async function readThemePart(
  archive: DocxArchive,
): Promise<string | undefined> {
  const path = archive.entries.find((entry) => THEME_PATTERN.test(entry));
  return path ? readTextPart(archive, path) : undefined;
}

/**
 * Feature flags only need to know whether an element occurs at all, so the raw
 * XML is scanned rather than walked. Element-name matching is safe here because
 * OOXML has no CDATA and no comments in the body, and attribute values cannot
 * contain a raw `<`.
 */
function detectFeatures(
  archive: DocxArchive,
  documentXml: string,
): DocumentFeatures {
  const has = (pattern: RegExp) => pattern.test(documentXml);
  const hasEntry = (pattern: RegExp) =>
    archive.entries.some((entry) => pattern.test(entry));

  return {
    tables: has(/<w:tbl[\s>]/),
    images: has(/<w:drawing[\s>]/) || hasEntry(/^word\/media\//),
    ommlEquations: has(/<m:oMath[\s>]/),
    // Equation 3.0 objects predate OMML and carry only a .wmf preview; the
    // phase-5 walker cannot recover LaTeX from them.
    oleObjects: has(/<w:object[\s>]/),
    headers: hasEntry(/^word\/header\d*\.xml$/),
    footers: hasEntry(/^word\/footer\d*\.xml$/),
    numbering: hasEntry(/^word\/numbering\.xml$/),
  };
}
