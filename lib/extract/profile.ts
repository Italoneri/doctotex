import { readTextPart, type DocxArchive } from "@/lib/docx/archive";
import { DocxFormatError } from "@/lib/docx/archive";
import { extractPage } from "./page";
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

/** Word numbers theme parts, and a few generators emit `theme.xml` unnumbered. */
const THEME_PATTERN = /^word\/theme\/theme\d*\.xml$/;

/** Word's built-in style ID for body text, before any localisation. */
const NORMAL_STYLE_ID = "Normal";

export async function extractStyleProfile(
  archive: DocxArchive,
): Promise<StyleProfile> {
  const documentXml = await readTextPart(archive, MAIN_DOCUMENT);
  if (!documentXml) {
    throw new DocxFormatError(`${MAIN_DOCUMENT} could not be read.`);
  }

  const theme = extractTheme(await readThemePart(archive));
  const sheet = parseStyleSheet(await readTextPart(archive, STYLES), theme);

  return {
    page: extractPage(documentXml),
    // Body text is the Normal style resolved against docDefaults, which is what
    // an unstyled paragraph actually renders as.
    defaults: resolveStyle(sheet, normalStyleId(sheet)),
    headings: findHeadingStyles(sheet),
    title: findTitleStyle(sheet),
    theme,
    features: detectFeatures(archive, documentXml),
  };
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
