import { compile } from "@/lib/latex/compile";
import { bibToolFor, readOptions } from "@/lib/latex/options";
import { readEntry, readSources } from "@/lib/latex/payload";
import { MAIN_FILE } from "@/lib/latex/tex";

export const runtime = "nodejs";

/**
 * Each request starts a container, so the number in flight is capped rather
 * than left to whatever the browser sends. The editor debounces, but a debounce
 * is a courtesy from the client and not a limit on the server.
 */
const MAX_CONCURRENT = 2;
let running = 0;

export type PreviewFailure =
  | { readonly ok: false; readonly reason: "invalid"; readonly error: string }
  | { readonly ok: false; readonly reason: "rejected"; readonly log: string }
  | {
      readonly ok: false;
      readonly reason: "unavailable";
      readonly error: string;
    }
  | { readonly ok: false; readonly reason: "busy"; readonly error: string };

/**
 * Compiles edited sources and answers with the PDF itself, so the preview is
 * the same artifact the download produces rather than an approximation of it.
 *
 * Success is the PDF bytes; every failure is JSON, which is what lets the
 * client tell them apart from the content type alone.
 */
export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return invalid("Request body is not JSON.");
  }

  const sources = readSources(payload);
  if (!sources) {
    return invalid("Request must carry a sources object of file text.");
  }

  const entry = readEntry(payload, sources, MAIN_FILE);
  if (!entry) {
    return invalid("The entry must name a .tex file present in the sources.");
  }

  // The engine is not inferred from the sources. A fontspec preamble read by
  // pdfLaTeX fails in a way that looks like the reader's mistake, so the
  // selection that produced the sources travels with them.
  const options = readOptions(
    typeof payload === "object" && payload !== null
      ? (payload as { options?: unknown }).options
      : undefined,
  );
  if (!options) {
    return invalid("The options are not a selection this build offers.");
  }

  if (running >= MAX_CONCURRENT) {
    return failure(
      {
        ok: false,
        reason: "busy",
        error: "Another preview is still compiling.",
      },
      429,
    );
  }

  running += 1;
  try {
    const result = await compile(sources, entry, {
      engine: options.engine,
      bibTool: bibToolFor(options.bibliography),
    });

    if (result.kind === "unavailable") {
      return failure(
        { ok: false, reason: "unavailable", error: result.reason },
        503,
      );
    }
    if (result.kind === "rejected") {
      return failure({ ok: false, reason: "rejected", log: result.log }, 422);
    }

    return new Response(new Uint8Array(result.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        // The preview is derived from the request body, never from a cache.
        "Cache-Control": "no-store",
      },
    });
  } finally {
    running -= 1;
  }
}

function invalid(error: string): Response {
  return failure({ ok: false, reason: "invalid", error }, 400);
}

function failure(body: PreviewFailure, status: number): Response {
  return Response.json(body, { status });
}
