import JSZip from "jszip";

/** Every OOXML wordprocessing package must carry the main document part. */
const MAIN_DOCUMENT_PART = "word/document.xml";

/** Raised when the upload is not a readable OOXML wordprocessing package. */
export class DocxFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocxFormatError";
  }
}

/**
 * An opened `.docx`, which is a ZIP container of XML parts plus binary media.
 * Keeps the underlying archive so later phases can pull `styles.xml`,
 * `theme1.xml` and `word/media/*` without unzipping a second time.
 */
export interface DocxArchive {
  readonly entries: readonly string[];
  readonly zip: JSZip;
}

export async function openDocx(bytes: Uint8Array): Promise<DocxArchive> {
  const zip = await loadZip(bytes);
  const entries = Object.keys(zip.files).sort();

  if (!entries.includes(MAIN_DOCUMENT_PART)) {
    throw new DocxFormatError(
      `Not a Word document: ${MAIN_DOCUMENT_PART} is missing from the package.`,
    );
  }

  return { entries, zip };
}

async function loadZip(bytes: Uint8Array): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(bytes);
  } catch {
    // JSZip throws plain Errors with parser-level wording; restate it in
    // product terms so the boundary has a single error vocabulary.
    throw new DocxFormatError("File is not a valid ZIP container.");
  }
}

/** Reads a part as UTF-8 text, or `undefined` when the part is absent. */
export async function readTextPart(
  archive: DocxArchive,
  path: string,
): Promise<string | undefined> {
  return archive.zip.file(path)?.async("string");
}
