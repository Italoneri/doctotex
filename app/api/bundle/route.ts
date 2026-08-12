import { buildZip } from "@/lib/latex/bundle";

export const runtime = "nodejs";

/** Guards against a request asking for an archive of arbitrary size. */
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

/**
 * A path segment must begin with something other than a dot. Allowing a dot
 * first would admit `..`, and an archive entry named `../../etc/passwd` escapes
 * the extraction directory on any tool that follows the path — zip slip.
 */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function isSafePath(path: string): boolean {
  const segments = path.split("/");
  return segments.length > 0 && segments.every((s) => SEGMENT.test(s));
}

export interface BundleRequest {
  readonly filename: string;
  readonly sources: Readonly<Record<string, string>>;
}

/**
 * Packages generated sources into a zip. Split from `/api/convert` so the
 * reader can edit the LaTeX and download what they actually see, rather than
 * whatever the converter produced first.
 */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return problem("Request body is not JSON.");
  }

  const sources = readSources(payload);
  if (!sources) {
    return problem("Request must carry a sources object of file text.");
  }

  const zip = await buildZip(sources);
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${downloadName(payload)}"`,
    },
  });
}

function readSources(
  payload: unknown,
): ReadonlyMap<string, string> | undefined {
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

function downloadName(payload: unknown): string {
  const raw =
    typeof payload === "object" && payload !== null
      ? (payload as { filename?: unknown }).filename
      : undefined;

  const base =
    typeof raw === "string" ? raw.replace(/\.docx$/i, "") : "doctotex";

  // The name lands in a header, so anything that could break out of the quoted
  // value is dropped rather than escaped.
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);
  return `${safe || "doctotex"}.zip`;
}

function problem(error: string): Response {
  return Response.json({ ok: false, error }, { status: 400 });
}
