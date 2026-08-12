import { describe, expect, it } from "vitest";
import {
  DOCX_MIME_TYPE,
  MAX_UPLOAD_BYTES,
  formatBytes,
  rejectUpload,
  type UploadRejection,
} from "./upload";

function fakeFile(name: string, type: string, size: number): File {
  const file = new File([], name, { type });
  // File size is derived from its parts; overriding beats allocating 25 MB.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("rejectUpload", () => {
  const cases: ReadonlyArray<{
    name: string;
    file: File;
    expected: UploadRejection | undefined;
  }> = [
    {
      name: "accepts a well-formed docx",
      file: fakeFile("thesis.docx", DOCX_MIME_TYPE, 1024),
      expected: undefined,
    },
    {
      name: "accepts uppercase extensions",
      file: fakeFile("THESIS.DOCX", DOCX_MIME_TYPE, 1024),
      expected: undefined,
    },
    {
      name: "accepts the empty mime type sent by some file managers",
      file: fakeFile("thesis.docx", "", 1024),
      expected: undefined,
    },
    {
      name: "accepts octet-stream sent by some browsers",
      file: fakeFile("thesis.docx", "application/octet-stream", 1024),
      expected: undefined,
    },
    {
      name: "rejects legacy .doc",
      file: fakeFile("thesis.doc", "application/msword", 1024),
      expected: { kind: "wrong-extension", filename: "thesis.doc" },
    },
    {
      name: "rejects a mime type that contradicts the extension",
      file: fakeFile("thesis.docx", "application/pdf", 1024),
      expected: { kind: "wrong-mime-type", mimeType: "application/pdf" },
    },
    {
      name: "rejects an empty file",
      file: fakeFile("thesis.docx", DOCX_MIME_TYPE, 0),
      expected: { kind: "empty" },
    },
    {
      name: "rejects a file over the size limit",
      file: fakeFile("thesis.docx", DOCX_MIME_TYPE, MAX_UPLOAD_BYTES + 1),
      expected: { kind: "too-large", sizeBytes: MAX_UPLOAD_BYTES + 1 },
    },
  ];

  for (const { name, file, expected } of cases) {
    it(name, () => {
      expect(rejectUpload(file)).toEqual(expected);
    });
  }
});

describe("formatBytes", () => {
  const cases: ReadonlyArray<[bytes: number, expected: string]> = [
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KB"],
    [79183, "77.3 KB"],
    [1024 * 1024, "1.0 MB"],
    [MAX_UPLOAD_BYTES, "25.0 MB"],
    // Three-digit values drop the decimal so chips stay a predictable width.
    [150 * 1024 * 1024, "150 MB"],
  ];

  for (const [bytes, expected] of cases) {
    it(`renders ${bytes} as ${expected}`, () => {
      expect(formatBytes(bytes)).toBe(expected);
    });
  }
});
