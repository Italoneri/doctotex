import { describe, expect, it } from "vitest";
import { hasFixture, readFixture } from "@/fixtures/fixture";
import { openDocx, readTextPart } from "@/lib/docx/archive";
import { extractParagraphs } from "@/lib/extract/body";
import { extractStyleProfile } from "@/lib/extract/profile";
import { CLASS_FILE, generateSources, type SourceFiles } from "./bundle";
import { compile, type CompileResult, isDockerAvailable } from "./compile";
import { MAIN_FILE } from "./tex";

const FIXTURE = "exemplo.docx";

/** Compiling needs a daemon; without one the suite skips rather than fails. */
const dockerUp = await isDockerAvailable();

const describeCompiling = describe.skipIf(!dockerUp || !hasFixture(FIXTURE));

/** Generous: a first pass pulls fonts into the container's cache. */
const COMPILE_TIMEOUT = { timeout: 300_000 };

async function sourcesFromFixture(): Promise<SourceFiles> {
  const archive = await openDocx(await readFixture(FIXTURE));
  const documentXml = (await readTextPart(archive, "word/document.xml")) ?? "";

  return generateSources(
    await extractStyleProfile(archive),
    extractParagraphs(documentXml),
  );
}

describeCompiling("generated sources", () => {
  it("contain the class and the document", COMPILE_TIMEOUT, async () => {
    const sources = await sourcesFromFixture();

    expect([...sources.keys()]).toEqual([CLASS_FILE, MAIN_FILE]);
  });

  it("compile under pdfLaTeX without errors", COMPILE_TIMEOUT, async () => {
    const result = await compile(await sourcesFromFixture(), MAIN_FILE);

    // The log is the only place TeX explains itself, so a failure carries it
    // rather than reporting a bare kind.
    if (result.kind !== "compiled") {
      throw new Error(`pdflatex failed:\n${describe_(result)}`);
    }
    expect(result.pdf.length).toBeGreaterThan(1000);
  });
});

describe.skipIf(!dockerUp)("compile", () => {
  it("reports the log rather than throwing", COMPILE_TIMEOUT, async () => {
    const broken: SourceFiles = new Map([
      [
        MAIN_FILE,
        "\\documentclass{article}\n\\begin{document}\n\\undefinedmacro\n\\end{document}\n",
      ],
    ]);

    const result = await compile(broken, MAIN_FILE);

    expect(result.kind).toBe("rejected");
    expect(result.kind === "rejected" && result.log).toContain(
      "Undefined control sequence",
    );
  });
});

// Needs no daemon, which is the point: it is the case where there isn't one.
describe("an engine that cannot be reached", () => {
  it("is reported apart from a rejected document", async () => {
    const result = await compile(
      new Map([[MAIN_FILE, "\\documentclass{article}"]]),
      MAIN_FILE,
      { docker: "docker-that-does-not-exist" },
    );

    expect(result.kind).toBe("unavailable");
    expect(result.kind === "unavailable" && result.reason).toContain(
      "was not found",
    );
  });
});

function describe_(result: CompileResult): string {
  return result.kind === "unavailable"
    ? result.reason
    : result.log.slice(-5000);
}
