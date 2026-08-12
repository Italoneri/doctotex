import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { DocxFormatError, openDocx, readTextPart } from "./archive";

const FIXTURE = new URL("../../fixtures/exemplo.docx", import.meta.url);

async function zipBytes(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}

describe("openDocx", () => {
  it("lists the parts of a real document", async () => {
    const archive = await openDocx(await readFile(FIXTURE));

    expect(archive.entries).toContain("word/document.xml");
    expect(archive.entries).toContain("word/styles.xml");
  });

  it("returns entries in a stable order", async () => {
    const archive = await openDocx(await readFile(FIXTURE));

    expect(archive.entries).toEqual([...archive.entries].sort());
  });

  it("rejects a zip that carries no main document part", async () => {
    const bytes = await zipBytes({ "hello.txt": "not a document" });

    await expect(openDocx(bytes)).rejects.toThrow(DocxFormatError);
  });

  it("rejects bytes that are not a zip container", async () => {
    const bytes = new TextEncoder().encode("plain text, not a zip");

    await expect(openDocx(bytes)).rejects.toThrow(DocxFormatError);
  });
});

describe("readTextPart", () => {
  it("reads the main document as text", async () => {
    const archive = await openDocx(await readFile(FIXTURE));

    const xml = await readTextPart(archive, "word/document.xml");

    expect(xml).toBeDefined();
    expect(xml).toContain("<w:document");
  });

  it("returns undefined for a part the package does not carry", async () => {
    const archive = await openDocx(await readFile(FIXTURE));

    await expect(
      readTextPart(archive, "word/nonexistent.xml"),
    ).resolves.toBeUndefined();
  });
});
