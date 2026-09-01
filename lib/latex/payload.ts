import type { Assets } from "@/lib/extract/media";
import type { SourceFiles } from "./bundle";

/** Guards against a request asking for an archive of arbitrary size. */
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

/**
 * A path segment must begin with something other than a dot. Allowing a dot
 * first would admit `..`, and an entry named `../../etc/passwd` escapes the
 * directory it is written to — whether that is an extraction target on the
 * reader's machine or the compile workspace on the server.
 */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function isSafePath(path: string): boolean {
  const segments = path.split("/");
  return segments.length > 0 && segments.every((s) => SEGMENT.test(s));
}

/**
 * Narrows an untrusted request body to the generated sources, or returns
 * undefined so the caller answers 400. Shared by the packaging and preview
 * endpoints: both accept edited text from the browser and both write it to a
 * filesystem, so both need the same guarantees about the paths.
 */
export function readSources(payload: unknown): SourceFiles | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const raw = (payload as { sources?: unknown }).sources;
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const sources = new Map<string, string>();
  let total = 0;

  for (const [path, content] of Object.entries(raw)) {
    if (typeof content !== "string" || !isSafePath(path)) {
      return undefined;
    }
    total += content.length;
    if (total > MAX_SOURCE_BYTES) {
      return undefined;
    }
    sources.set(path, content);
  }

  return sources.size > 0 ? sources : undefined;
}

/** Pictures compress far less than text, so they get their own, larger cap. */
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;

/**
 * Narrows the pictures a request carries, or returns undefined so the caller
 * answers 400.
 *
 * They travel as base64 because a JSON body has no way to carry bytes. An
 * entry that is not valid base64 is rejected rather than decoded to whatever
 * `Buffer.from` makes of it, which for a malformed string is a shorter buffer
 * and a picture that arrives silently corrupt.
 */
export function readAssets(payload: unknown): Assets | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const raw = (payload as { assets?: unknown }).assets;
  if (raw === undefined) {
    return new Map();
  }
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const assets = new Map<string, Uint8Array>();
  let total = 0;

  for (const [path, encoded] of Object.entries(raw)) {
    if (typeof encoded !== "string" || !isSafePath(path)) {
      return undefined;
    }
    const bytes = decodeBase64(encoded);
    if (!bytes || !isDeclaredFormat(path, bytes)) {
      return undefined;
    }
    total += bytes.byteLength;
    if (total > MAX_ASSET_BYTES) {
      return undefined;
    }
    assets.set(path, bytes);
  }

  return assets;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeBase64(encoded: string): Uint8Array | undefined {
  if (encoded.length % 4 !== 0 || !BASE64.test(encoded)) {
    return undefined;
  }
  return new Uint8Array(Buffer.from(encoded, "base64"));
}

/**
 * How each format the generator may include announces itself in its first
 * bytes. Every one of these is fixed by its specification, so a file that does
 * not open this way is not that format whatever it is named.
 */
const SIGNATURES: ReadonlyMap<string, readonly number[]> = new Map([
  ["png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  // JPEG's fourth byte varies by marker; the first three do not.
  ["jpg", [0xff, 0xd8, 0xff]],
  ["jpeg", [0xff, 0xd8, 0xff]],
  ["pdf", [0x25, 0x50, 0x44, 0x46]],
]);

/**
 * Whether the bytes are the format the name claims.
 *
 * Base64 that decodes cleanly can still be the wrong thing entirely — the
 * failure that prompted this check wrote a picture's *base64 text* into the
 * file, which is well-formed, decodes, and is not an image. TeX answers that
 * with "the requested image couldn't be read because it was not a recognized
 * image format", pointing at the `\includegraphics` line, which reads like a
 * fault in the generated LaTeX rather than in what was sent. Naming it here
 * costs one comparison and puts the message where the mistake is.
 *
 * An extension the generator never emits is left alone rather than guessed at.
 */
function isDeclaredFormat(path: string, bytes: Uint8Array): boolean {
  const signature = SIGNATURES.get(
    path.slice(path.lastIndexOf(".") + 1).toLowerCase(),
  );
  if (!signature) {
    return true;
  }

  return (
    bytes.length >= signature.length &&
    signature.every((byte, index) => bytes[index] === byte)
  );
}

/**
 * The file the engine is pointed at. It has to be one of the sources: a name
 * that is merely well-formed would make the container compile whatever happens
 * to sit at that path.
 */
export function readEntry(
  payload: unknown,
  sources: SourceFiles,
  fallback: string,
): string | undefined {
  const raw =
    typeof payload === "object" && payload !== null
      ? (payload as { entry?: unknown }).entry
      : undefined;

  if (raw === undefined) {
    return sources.has(fallback) ? fallback : undefined;
  }
  if (typeof raw !== "string" || !raw.endsWith(".tex") || !sources.has(raw)) {
    return undefined;
  }
  return raw;
}
