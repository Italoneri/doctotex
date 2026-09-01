import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Assets } from "@/lib/extract/media";
import { EMPTY_ASSETS, type SourceFiles } from "./bundle";
import { compileCommands, type BibTool, type Engine } from "./options";

const run = promisify(execFile);

export const TEXLIVE_IMAGE = "texlive/texlive:latest";

/** A first pass on a cold container is slow; a runaway macro is slower. */
const COMPILE_TIMEOUT_MS = 180_000;

const DOCKER_PROBE_TIMEOUT_MS = 10_000;

/** Never prompt, and stop at the first error rather than cascading. */
const UNATTENDED_FLAGS = ["-interaction=nonstopmode", "-halt-on-error"];

const WORKDIR = "/work";

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
  /** Pictures the sources include, written beside them before the engine runs. */
  readonly assets?: Assets;
  /** Runs between the engine passes; `none` means a single pass. */
  readonly bibTool?: BibTool;
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
  const assets = options.assets ?? EMPTY_ASSETS;

  const missing = missingPictures(sources, assets);
  if (missing.length > 0) {
    return {
      kind: "unavailable",
      reason: `The sources include ${missing.join(", ")}, which did not arrive with them. Nothing was compiled, because the engine would report this against the \\includegraphics line rather than against the picture that is absent.`,
    };
  }

  const directory = await mkdtemp(join(tmpdir(), "doctotex-"));

  try {
    await Promise.all([
      ...[...sources].map(([path, content]) =>
        writeFile(join(directory, path), content, "utf8"),
      ),
      // A picture sits in a subdirectory the workspace does not have yet, and
      // `writeFile` will not make one.
      ...[...assets].map(async ([path, bytes]) => {
        const file = join(directory, path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, bytes);
      }),
    ]);

    return await runEngine(directory, entry, options);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Every `\includegraphics` target, as written in the sources. */
const INCLUDED_PICTURE = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;

/**
 * The pictures the sources ask for that are not travelling with them.
 *
 * The generator only writes an `\includegraphics` for a picture it was handed,
 * so this cannot fire on generated output. It fires on what arrives from a
 * browser, where the sources and the pictures are two fields that can disagree
 * — an older page that sends one and not the other, or a request assembled by
 * hand. Left to the engine, that disagreement surfaces as an error against the
 * `\includegraphics` line, which reads as a fault in the LaTeX rather than as
 * a picture that never arrived.
 */
function missingPictures(
  sources: SourceFiles,
  assets: Assets,
): readonly string[] {
  const missing = new Set<string>();

  for (const content of sources.values()) {
    for (const [, target] of content.matchAll(INCLUDED_PICTURE)) {
      // A path the engine resolves for itself, against its own search rules.
      if (target && !target.startsWith("/") && !assets.has(target)) {
        missing.add(target);
      }
    }
  }

  return [...missing];
}

async function runEngine(
  directory: string,
  entry: string,
  { engine = "pdflatex", bibTool = "none", docker = "docker" }: CompileOptions,
): Promise<CompileResult> {
  // Every pass runs inside one container. Starting a fresh one per pass would
  // quadruple the startup cost and lose the .aux files between them.
  const args = [
    "run",
    "--rm",
    // The container writes the .pdf and .log back into the mounted directory.
    "-v",
    `${directory}:${WORKDIR}`,
    "-w",
    WORKDIR,
    TEXLIVE_IMAGE,
    "sh",
    "-c",
    passes(entry, engine, bibTool),
  ];

  const timeoutMs = COMPILE_TIMEOUT_MS * (bibTool === "none" ? 1 : 3);

  try {
    await run(docker, args, { timeout: timeoutMs });
  } catch (error) {
    // A non-zero exit is the normal way TeX reports a bad document, so the log
    // matters more than the exception. The log is also what tells the two
    // failures apart: TeX writes one whenever it runs at all, so its absence
    // means the engine never started.
    const log = await readLog(directory, entry);
    if (isTimeout(error)) {
      return {
        kind: "unavailable",
        reason: `The engine did not finish within ${timeoutMs / 1000}s.`,
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

/**
 * The same command list the generated document advertises, wrapped in the shell
 * that runs it unattended.
 *
 * `entry` arrives from the browser and is checked before it gets here: every
 * segment matches `[A-Za-z0-9._-]` and the name ends in `.tex`, which leaves no
 * character the shell would read as syntax.
 */
function passes(entry: string, engine: Engine, bibTool: BibTool): string {
  const commands = compileCommands(entry, {
    engine,
    bibTool,
    engineFlags: UNATTENDED_FLAGS,
  });
  if (commands.length === 1) {
    return commands[0];
  }

  // biber and bibtex both exit non-zero when the document cites nothing, which
  // is the ordinary state of a freshly generated template. Whether the document
  // is sound is decided by the engine passes, not by them.
  const tolerated = commands.map((command) =>
    command.startsWith(bibTool) ? `${command} || true` : command,
  );
  return ["set -e", ...tolerated].join("; ");
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
