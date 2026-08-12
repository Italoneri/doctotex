import { mkdir, writeFile } from "node:fs/promises";
import { describe, it } from "vitest";
import { hasFixture, readFixture } from "@/fixtures/fixture";
import { openDocx, readTextPart } from "@/lib/docx/archive";
import { extractParagraphs } from "@/lib/extract/body";
import { extractStyleProfile } from "@/lib/extract/profile";
import { generateSources } from "./bundle";
import { compile } from "./compile";
import { MAIN_FILE } from "./tex";

const FIXTURE = "exemplo.docx";
const OUT = new URL("../../out/", import.meta.url);

/**
 * Opt-in, because a test suite should not leave artifacts behind on every run.
 * `DOCTOTEX_INSPECT=1 npm test` writes the generated sources and the compiled
 * PDF to out/ so the output can be read rather than merely asserted about.
 */
const enabled = process.env.DOCTOTEX_INSPECT === "1" && hasFixture(FIXTURE);

describe.skipIf(!enabled)("inspect", () => {
  it(
    "writes the generated sources and pdf to out/",
    { timeout: 300_000 },
    async () => {
      const archive = await openDocx(await readFixture(FIXTURE));
      const documentXml =
        (await readTextPart(archive, "word/document.xml")) ?? "";
      const sources = generateSources(
        await extractStyleProfile(archive),
        extractParagraphs(documentXml),
      );

      await mkdir(OUT, { recursive: true });
      for (const [name, content] of sources) {
        await writeFile(new URL(name, OUT), content, "utf8");
      }

      const result = await compile(sources, MAIN_FILE);
      if (result.pdf) {
        await writeFile(new URL("main.pdf", OUT), result.pdf);
      }
      await writeFile(new URL("main.log", OUT), result.log, "utf8");
    },
  );
});
