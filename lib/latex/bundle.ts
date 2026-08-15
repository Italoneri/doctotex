import JSZip from "jszip";
import { countStyleUsage, type Paragraph } from "@/lib/extract/body";
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
  readonly paragraphs: readonly Paragraph[];
  readonly headerFooter?: HeaderFooterText;
  readonly options?: GenerationOptions;
}

export function generateSources(input: GenerateInput): SourceFiles {
  const options = input.options ?? DEFAULT_OPTIONS;
  const shared = {
    profile: input.profile,
    headerFooter: input.headerFooter,
    usage: countStyleUsage(input.paragraphs),
    options,
  };

  const sources = new Map<string, string>();

  // The single-file layout inlines the class, so writing one beside it would
  // ship a file nothing loads.
  if (options.layout === "multi") {
    sources.set(CLASS_FILE, generateClass(shared));
  }
  sources.set(
    MAIN_FILE,
    generateDocument({ ...shared, paragraphs: input.paragraphs }),
  );

  // A `\bibliography` pointing at a file that is not in the archive is a
  // compile error on the reader's machine, not a missing extra.
  if (options.bibliography.backend !== "none") {
    sources.set(BIB_FILE, bibliographyStub());
  }

  return sources;
}

export async function buildZip(sources: SourceFiles): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of sources) {
    zip.file(path, content);
  }
  // DEFLATE keeps the download small; these are text files that compress well.
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
}
