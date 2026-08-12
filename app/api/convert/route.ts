import { DocxFormatError, openDocx } from "@/lib/docx/archive";
import { describeRejection, rejectUpload } from "@/lib/docx/upload";

// jszip and the phase-1 XML parsers are Node-only; pin the runtime so a future
// edge default never silently breaks the parsing pipeline.
export const runtime = "nodejs";

/** Phase 0 response: proves the archive opened, nothing is converted yet. */
export interface ConvertSuccess {
  readonly ok: true;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly entries: readonly string[];
}

export interface ConvertFailure {
  readonly ok: false;
  readonly error: string;
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return failure("No file was included in the request.", 400);
  }

  const rejection = rejectUpload(file);
  if (rejection) {
    return failure(describeRejection(rejection), 415);
  }

  try {
    const archive = await openDocx(new Uint8Array(await file.arrayBuffer()));
    return Response.json({
      ok: true,
      filename: file.name,
      sizeBytes: file.size,
      entries: archive.entries,
    } satisfies ConvertSuccess);
  } catch (error) {
    if (error instanceof DocxFormatError) {
      return failure(error.message, 415);
    }
    throw error;
  }
}

function failure(error: string, status: number): Response {
  return Response.json({ ok: false, error } satisfies ConvertFailure, {
    status,
  });
}
