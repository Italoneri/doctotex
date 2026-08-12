import { DocxFormatError, openDocx, readTextPart } from "@/lib/docx/archive";
import { describeRejection, rejectUpload } from "@/lib/docx/upload";
import { extractParagraphs } from "@/lib/extract/body";
import { extractStyleProfile } from "@/lib/extract/profile";
import type { StyleProfile } from "@/lib/extract/types";
import { generateSources } from "@/lib/latex/bundle";

// jszip and the XML parsers are Node-only; pin the runtime so a future edge
// default never silently breaks the parsing pipeline.
export const runtime = "nodejs";

export interface ConvertSuccess {
  readonly ok: true;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly entries: readonly string[];
  readonly profile: StyleProfile;
  /**
   * The generated LaTeX, by filename. Returned as text rather than a zip so the
   * editor can show it and the reader can change it before it is packaged.
   */
  readonly sources: Readonly<Record<string, string>>;
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
    const profile = await extractStyleProfile(archive);
    const documentXml =
      (await readTextPart(archive, "word/document.xml")) ?? "";

    return Response.json({
      ok: true,
      filename: file.name,
      sizeBytes: file.size,
      entries: archive.entries,
      profile,
      sources: Object.fromEntries(
        generateSources(profile, extractParagraphs(documentXml)),
      ),
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
