import JSZip from "jszip";
import { countStyleUsage, paragraphsOf, type Block } from "@/lib/extract/body";
import type { Assets } from "@/lib/extract/media";
import type { ConversionReport } from "@/lib/extract/report";
import type { StyleProfile } from "@/lib/extract/types";
import { BIB_FILE, bibliographyStub } from "./bib";
import { CLASS_NAME, generateClass, type HeaderFooterText } from "./cls";
import { DEFAULT_OPTIONS, type GenerationOptions } from "./options";
import { generateDocument, MAIN_FILE } from "./tex";

export const CLASS_FILE = `${CLASS_NAME}.cls`;

/**
 * The generated sources, keyed by their path inside the archive. Kept as a map
 * rather than written straight to a zip so the same files can be compiled,
 * shown in the editor, and packaged without generating them three times.
 */
export type SourceFiles = ReadonlyMap<string, string>;

export interface GenerateInput {
  readonly profile: StyleProfile;
  readonly blocks: readonly Block[];
  /**
   * The pictures that will travel beside the sources. The generator writes an
   * `\includegraphics` only for a path that is in here, so a picture the
   * package turned out not to hold cannot reach the document as a broken one.
   */
  readonly assets?: Assets;
  readonly headerFooter?: HeaderFooterText;
  readonly options?: GenerationOptions;
  /** What the extraction had to change, written into the generated document. */
  readonly report?: ConversionReport;
}

export function generateSources(input: GenerateInput): SourceFiles {
  const options = input.options ?? DEFAULT_OPTIONS;
  const shared = {
    profile: input.profile,
    blocks: input.blocks,
    headerFooter: input.headerFooter,
    usage: countStyleUsage(paragraphsOf(input.blocks)),
    options,
    report: input.report,
    assets: input.assets ?? EMPTY_ASSETS,
  };

  const sources = new Map<string, string>();

  // The single-file layout inlines the class, so writing one beside it would
  // ship a file nothing loads.
  if (options.layout === "multi") {
    sources.set(CLASS_FILE, generateClass(shared));
  }
  sources.set(MAIN_FILE, generateDocument(shared));

  // A `\bibliography` pointing at a file that is not in the archive is a
  // compile error on the reader's machine, not a missing extra.
  if (options.bibliography.backend !== "none") {
    sources.set(BIB_FILE, bibliographyStub());
  }

  return sources;
}

export const EMPTY_ASSETS: Assets = new Map();

/**
 * The sources and the pictures they refer to, in one archive.
 *
 * The two are separate arguments rather than one map because they are not the
 * same kind of thing: the text is generated and editable, the media is copied
 * out of the `.docx` byte for byte.
 */
export async function buildZip(
  sources: SourceFiles,
  assets: Assets = EMPTY_ASSETS,
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of sources) {
    zip.file(path, content);
  }
  for (const [path, bytes] of assets) {
    zip.file(path, bytes);
  }
  // DEFLATE keeps the download small; these are text files that compress well.
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
}
