/**
 * What the reader chooses about the output, as opposed to what the Word file
 * dictates. The style profile decides how the document looks; these decide
 * which LaTeX dialect expresses it.
 */

/** The three engines TeX Live ships. Each changes how fonts are selected. */
export type Engine = "pdflatex" | "xelatex" | "lualatex";

export type CitationStyle = "apa" | "ieee" | "abnt";

/**
 * A backend and a style, never one without the other. Carrying a style
 * alongside `none` would let the panel remember a choice that has no effect,
 * and the class generator would have to decide which field to trust.
 */
export type Bibliography =
  | { readonly backend: "none" }
  | { readonly backend: "biblatex"; readonly style: CitationStyle }
  | { readonly backend: "natbib"; readonly style: CitationStyle };

/** `multi` writes a class beside the document; `single` inlines it. */
export type Layout = "multi" | "single";

export interface GenerationOptions {
  readonly engine: Engine;
  readonly bibliography: Bibliography;
  readonly layout: Layout;
}

export const DEFAULT_OPTIONS: GenerationOptions = {
  engine: "pdflatex",
  bibliography: { backend: "none" },
  layout: "multi",
};

export const ENGINES: readonly Engine[] = ["pdflatex", "xelatex", "lualatex"];

export const CITATION_STYLES: readonly CitationStyle[] = [
  "apa",
  "ieee",
  "abnt",
];

/** How each name is spelled in prose, which is not how the binary is spelled. */
export const ENGINE_LABELS: Readonly<Record<Engine, string>> = {
  pdflatex: "pdfLaTeX",
  xelatex: "XeLaTeX",
  lualatex: "LuaLaTeX",
};

export const CITATION_LABELS: Readonly<Record<CitationStyle, string>> = {
  apa: "APA",
  ieee: "IEEE",
  abnt: "ABNT",
};

/**
 * XeLaTeX and LuaLaTeX load faces by name through fontspec; pdfLaTeX needs a
 * package per face. The two paths share nothing, so the class generator picks
 * one rather than emitting both and hoping.
 */
export function usesFontspec(engine: Engine): boolean {
  return engine !== "pdflatex";
}

/** The program that has to run between the engine passes, if any. */
export type BibTool = "none" | "biber" | "bibtex";

export function bibToolFor(bibliography: Bibliography): BibTool {
  switch (bibliography.backend) {
    case "biblatex":
      return "biber";
    case "natbib":
      return "bibtex";
    case "none":
      return "none";
  }
}

/**
 * Narrows an untrusted value to the options, or returns undefined so the caller
 * answers 400. An absent value is not an error: it means the defaults, which is
 * what a client that predates an option will send.
 *
 * Nothing is coerced. A misspelt engine is a bug in the caller, and quietly
 * substituting pdfLaTeX would hide it behind output that looks plausible.
 */
export function readOptions(value: unknown): GenerationOptions | undefined {
  if (value === undefined || value === null) {
    return DEFAULT_OPTIONS;
  }
  if (typeof value !== "object") {
    return undefined;
  }

  const raw = value as {
    engine?: unknown;
    bibliography?: unknown;
    layout?: unknown;
  };

  const engine = readMember(raw.engine, ENGINES, DEFAULT_OPTIONS.engine);
  const layout = readMember(raw.layout, ["multi", "single"] as const, "multi");
  const bibliography = readBibliography(raw.bibliography);

  if (engine === undefined || layout === undefined || !bibliography) {
    return undefined;
  }
  return { engine, bibliography, layout };
}

function readBibliography(value: unknown): Bibliography | undefined {
  if (value === undefined) {
    return DEFAULT_OPTIONS.bibliography;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const raw = value as { backend?: unknown; style?: unknown };
  const backend = readMember(
    raw.backend,
    ["none", "biblatex", "natbib"] as const,
    "none",
  );
  if (backend === undefined) {
    return undefined;
  }
  if (backend === "none") {
    return { backend };
  }

  const style = readMember(raw.style, CITATION_STYLES, undefined);
  return style === undefined ? undefined : { backend, style };
}

/**
 * Undefined means rejected, so an absent member needs a value to fall back to.
 * A backend without a style has no sensible default, which is why the fallback
 * is a parameter rather than the first entry of the list.
 */
function readMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T | undefined,
): T | undefined {
  if (value === undefined) {
    return fallback;
  }
  return allowed.find((member) => member === value);
}
