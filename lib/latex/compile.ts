import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SourceFiles } from "./bundle";

const run = promisify(execFile);

export const TEXLIVE_IMAGE = "texlive/texlive:latest";

/** A first pass on a cold container is slow; a runaway macro is slower. */
const COMPILE_TIMEOUT_MS = 180_000;

const DOCKER_PROBE_TIMEOUT_MS = 10_000;

const WORKDIR = "/work";

export type Engine = "pdflatex" | "xelatex" | "lualatex";

export interface CompileResult {
  readonly ok: boolean;
  /** The TeX log, which is where a compilation failure explains itself. */
  readonly log: string;
  readonly pdf?: Uint8Array;
}

/**
 * Compiles the generated sources in the texlive container.
 *
 * Running the real engine is the only way to know the output compiles; a
 * generator that emits plausible-looking LaTeX can still be wrong in ways only
 * TeX notices.
 */
export async function compile(
  sources: SourceFiles,
  entry: string,
  engine: Engine = "pdflatex",
): Promise<CompileResult> {
  const directory = await mkdtemp(join(tmpdir(), "doctotex-"));

  try {
    await Promise.all(
      [...sources].map(([path, content]) =>
        writeFile(join(directory, path), content, "utf8"),
      ),
    );

    return await runEngine(directory, entry, engine);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runEngine(
  directory: string,
  entry: string,
  engine: Engine,
): Promise<CompileResult> {
  const args = [
    "run",
    "--rm",
    // The container writes the .pdf and .log back into the mounted directory.
    "-v",
    `${directory}:${WORKDIR}`,
    "-w",
    WORKDIR,
    TEXLIVE_IMAGE,
    engine,
    "-interaction=nonstopmode",
    "-halt-on-error",
    entry,
  ];

  try {
    await run("docker", args, { timeout: COMPILE_TIMEOUT_MS });
  } catch {
    // A non-zero exit is the normal way TeX reports a bad document, so the log
    // matters more than the exception.
    return { ok: false, log: await readLog(directory, entry) };
  }

  return {
    ok: true,
    log: await readLog(directory, entry),
    pdf: await readOutput(directory, entry),
  };
}

async function readLog(directory: string, entry: string): Promise<string> {
  return readSafely(join(directory, replaceExtension(entry, "log")), "utf8");
}

async function readOutput(
  directory: string,
  entry: string,
): Promise<Uint8Array | undefined> {
  try {
    return await readFile(join(directory, replaceExtension(entry, "pdf")));
  } catch {
    return undefined;
  }
}

async function readSafely(path: string, encoding: "utf8"): Promise<string> {
  try {
    return await readFile(path, encoding);
  } catch {
    return "";
  }
}

function replaceExtension(entry: string, extension: string): string {
  return entry.replace(/\.tex$/, `.${extension}`);
}

/** Lets callers skip rather than fail where no daemon is reachable. */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await run("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: DOCKER_PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}
