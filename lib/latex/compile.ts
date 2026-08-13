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

/**
 * Three outcomes, not two. A document TeX refuses and a daemon that never
 * answered both used to arrive as `ok: false` with an empty log, which left the
 * caller telling the reader their LaTeX was broken when Docker was simply not
 * running.
 */
export type CompileResult =
  | {
      readonly kind: "compiled";
      readonly log: string;
      readonly pdf: Uint8Array;
    }
  | { readonly kind: "rejected"; readonly log: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface CompileOptions {
  readonly engine?: Engine;
  /** Overridable so a test can point at a command that is certain to be absent. */
  readonly docker?: string;
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
  options: CompileOptions = {},
): Promise<CompileResult> {
  const directory = await mkdtemp(join(tmpdir(), "doctotex-"));

  try {
    await Promise.all(
      [...sources].map(([path, content]) =>
        writeFile(join(directory, path), content, "utf8"),
      ),
    );

    return await runEngine(directory, entry, options);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runEngine(
  directory: string,
  entry: string,
  { engine = "pdflatex", docker = "docker" }: CompileOptions,
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
    await run(docker, args, { timeout: COMPILE_TIMEOUT_MS });
  } catch (error) {
    // A non-zero exit is the normal way TeX reports a bad document, so the log
    // matters more than the exception. The log is also what tells the two
    // failures apart: TeX writes one whenever it runs at all, so its absence
    // means the engine never started.
    const log = await readLog(directory, entry);
    if (isTimeout(error)) {
      return {
        kind: "unavailable",
        reason: `The engine did not finish within ${COMPILE_TIMEOUT_MS / 1000}s.`,
      };
    }
    return log
      ? { kind: "rejected", log }
      : { kind: "unavailable", reason: describeFailure(error) };
  }

  const pdf = await readOutput(directory, entry);
  const log = await readLog(directory, entry);

  // A zero exit with no PDF is not success; nonstopmode can end that way.
  return pdf ? { kind: "compiled", log, pdf } : { kind: "rejected", log };
}

interface ProcessFailure {
  readonly killed?: boolean;
  readonly code?: string | number;
  readonly stderr?: string;
}

function asFailure(error: unknown): ProcessFailure {
  return typeof error === "object" && error !== null ? error : {};
}

function isTimeout(error: unknown): boolean {
  return asFailure(error).killed === true;
}

function describeFailure(error: unknown): string {
  const { code, stderr } = asFailure(error);

  if (code === "ENOENT") {
    return "The docker command was not found on this machine.";
  }
  const detail = stderr?.trim();
  return detail
    ? `Docker could not run the engine: ${detail.slice(0, 500)}`
    : "Docker could not run the engine.";
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
