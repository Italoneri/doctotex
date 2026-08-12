export const DOCX_EXTENSION = ".docx";

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Browsers disagree on the MIME type they attach to a `.docx`: Chrome sends the
 * OOXML type, some send `application/octet-stream`, and drag-and-drop from a
 * few file managers sends nothing at all. Extension plus size is the only
 * reliable client-side gate — the authoritative check is opening the archive.
 */
const ACCEPTED_MIME_TYPES: ReadonlySet<string> = new Set([
  DOCX_MIME_TYPE,
  "application/octet-stream",
  "application/zip",
  "",
]);

export type UploadRejection =
  | { kind: "wrong-extension"; filename: string }
  | { kind: "wrong-mime-type"; mimeType: string }
  | { kind: "empty" }
  | { kind: "too-large"; sizeBytes: number };

export function rejectUpload(file: File): UploadRejection | undefined {
  if (!file.name.toLowerCase().endsWith(DOCX_EXTENSION)) {
    return { kind: "wrong-extension", filename: file.name };
  }
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    return { kind: "wrong-mime-type", mimeType: file.type };
  }
  if (file.size === 0) {
    return { kind: "empty" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { kind: "too-large", sizeBytes: file.size };
  }
  return undefined;
}

export function describeRejection(rejection: UploadRejection): string {
  switch (rejection.kind) {
    case "wrong-extension":
      return `"${rejection.filename}" is not a .docx file.`;
    case "wrong-mime-type":
      return `Unexpected file type "${rejection.mimeType}".`;
    case "empty":
      return "That file is empty.";
    case "too-large":
      return `File is ${formatBytes(rejection.sizeBytes)}; the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  }
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB"] as const;
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = unitIndex === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}
