import { buildZip } from "@/lib/latex/bundle";
import { readSources } from "@/lib/latex/payload";

export const runtime = "nodejs";

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
