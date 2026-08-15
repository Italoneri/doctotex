import { DocxFormatError, openDocx, readTextPart } from "@/lib/docx/archive";
import { describeRejection, rejectUpload } from "@/lib/docx/upload";
import { countStyleUsage, extractParagraphs } from "@/lib/extract/body";
import { extractStyleProfile } from "@/lib/extract/profile";
import type { StyleProfile } from "@/lib/extract/types";
import { generateSources } from "@/lib/latex/bundle";
import {
  DEFAULT_OPTIONS,
  readOptions,
  type GenerationOptions,
} from "@/lib/latex/options";

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
  /**
   * Paragraph count per style id. A style declared in styles.xml is not
   * necessarily applied to anything, and reporting the declaration alone would
   * claim a structure the document does not have.
   */
  readonly styleUsage: Readonly<Record<string, number>>;
  /**
   * Echoed back so the preview compiles with the engine the sources were
   * written for. A client that guesses would run pdfLaTeX over a fontspec
   * preamble the first time the two fall out of step.
   */
  readonly options: GenerationOptions;
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

  const options = readFormOptions(form.get("options"));
  if (!options) {
    return failure(
      "The options field is not a selection this build offers.",
      400,
    );
  }

  try {
    const archive = await openDocx(new Uint8Array(await file.arrayBuffer()));
    const profile = await extractStyleProfile(archive);
    const documentXml =
      (await readTextPart(archive, "word/document.xml")) ?? "";
    const paragraphs = extractParagraphs(documentXml);

    return Response.json({
      ok: true,
      filename: file.name,
      sizeBytes: file.size,
      entries: archive.entries,
      profile,
      sources: Object.fromEntries(
        generateSources({ profile, paragraphs, options }),
      ),
      styleUsage: Object.fromEntries(countStyleUsage(paragraphs)),
      options,
    } satisfies ConvertSuccess);
  } catch (error) {
    if (error instanceof DocxFormatError) {
      return failure(error.message, 415);
    }
    throw error;
  }
}

/**
 * A multipart field is text or a file, so the selection travels as JSON in a
 * string. An absent field is the defaults; a present one that does not parse is
 * a caller bug and gets said so rather than silently becoming pdfLaTeX.
 */
function readFormOptions(
  field: FormDataEntryValue | null,
): GenerationOptions | undefined {
  if (typeof field !== "string" || field === "") {
    return DEFAULT_OPTIONS;
  }
  try {
    return readOptions(JSON.parse(field));
  } catch {
    return undefined;
  }
}

function failure(error: string, status: number): Response {
  return Response.json({ ok: false, error } satisfies ConvertFailure, {
    status,
  });
}
