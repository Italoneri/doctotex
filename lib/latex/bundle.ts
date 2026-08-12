import JSZip from "jszip";
import type { Paragraph } from "@/lib/extract/body";
import type { StyleProfile } from "@/lib/extract/types";
import { CLASS_NAME, generateClass, type HeaderFooterText } from "./cls";
import { generateDocument, MAIN_FILE } from "./tex";

export const CLASS_FILE = `${CLASS_NAME}.cls`;

/**
 * The generated sources, keyed by their path inside the archive. Kept as a map
 * rather than written straight to a zip so the same files can be compiled,
 * shown in the editor, and packaged without generating them three times.
 */
export type SourceFiles = ReadonlyMap<string, string>;

export function generateSources(
  profile: StyleProfile,
  paragraphs: readonly Paragraph[],
  headerFooter: HeaderFooterText = {},
): SourceFiles {
  return new Map([
    [CLASS_FILE, generateClass(profile, headerFooter)],
    [MAIN_FILE, generateDocument(profile, paragraphs)],
  ]);
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
