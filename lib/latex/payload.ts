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
