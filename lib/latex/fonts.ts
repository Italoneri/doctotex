/** pdfLaTeX offers exactly three family slots, and every face lands in one. */
export type LatexFamily = "rm" | "sf" | "tt";

export interface FontMapping {
  /** Package names to `\RequirePackage`, in load order. Empty under fontspec. */
  readonly packages: readonly string[];
  /**
   * The family name XeLaTeX and LuaLaTeX resolve. Every one of these ships with
   * TeX Live, so the generated template compiles on a machine that has none of
   * the original Word faces installed.
   */
  readonly fontspec: string;
  readonly family: LatexFamily;
  /** Present when nothing matched, to be emitted as a comment in the class. */
  readonly unmatched?: string;
}

/**
 * Word names a typeface; pdfLaTeX needs a package and fontspec needs a family
 * name. Where a metric-compatible clone exists the line lengths match the
 * original, so the page breaks land in roughly the same places.
 *
 * Keys are lowercased family names as Word writes them.
 */
const MAPPINGS: Readonly<Record<string, FontMapping>> = {
  "times new roman": {
    packages: ["newtxtext", "newtxmath"],
    fontspec: "TeX Gyre Termes",
    family: "rm",
  },
  times: {
    packages: ["newtxtext", "newtxmath"],
    fontspec: "TeX Gyre Termes",
    family: "rm",
  },
  arial: {
    packages: ["helvet"],
    fontspec: "TeX Gyre Heros",
    family: "sf",
  },
  helvetica: {
    packages: ["helvet"],
    fontspec: "TeX Gyre Heros",
    family: "sf",
  },
  // Carlito and Caladea are metric clones of Calibri and Cambria.
  calibri: { packages: ["carlito"], fontspec: "Carlito", family: "sf" },
  cambria: { packages: ["caladea"], fontspec: "Caladea", family: "rm" },
  "courier new": {
    packages: ["courier"],
    fontspec: "TeX Gyre Cursor",
    family: "tt",
  },
  courier: {
    packages: ["courier"],
    fontspec: "TeX Gyre Cursor",
    family: "tt",
  },
  garamond: {
    packages: ["ebgaramond"],
    fontspec: "EB Garamond",
    family: "rm",
  },
  "eb garamond": {
    packages: ["ebgaramond"],
    fontspec: "EB Garamond",
    family: "rm",
  },
  "book antiqua": {
    packages: ["newpxtext", "newpxmath"],
    fontspec: "TeX Gyre Pagella",
    family: "rm",
  },
  palatino: {
    packages: ["newpxtext", "newpxmath"],
    fontspec: "TeX Gyre Pagella",
    family: "rm",
  },
  "palatino linotype": {
    packages: ["newpxtext", "newpxmath"],
    fontspec: "TeX Gyre Pagella",
    family: "rm",
  },
  "century schoolbook": {
    packages: ["fouriernc"],
    fontspec: "TeX Gyre Schola",
    family: "rm",
  },
  "computer modern": {
    packages: ["lmodern"],
    fontspec: "Latin Modern Roman",
    family: "rm",
  },
  "latin modern roman": {
    packages: ["lmodern"],
    fontspec: "Latin Modern Roman",
    family: "rm",
  },
};

/** Used when the document names a face with no free counterpart. */
const FALLBACK: FontMapping = {
  packages: ["lmodern"],
  fontspec: "Latin Modern Roman",
  family: "rm",
};

export function mapFont(family: string | undefined): FontMapping {
  if (!family) {
    return FALLBACK;
  }

  const mapping = MAPPINGS[family.trim().toLowerCase()];
  if (mapping) {
    return mapping;
  }

  // Degrading is fine; degrading silently is not. The class carries the name
  // the document asked for so the substitution is visible in the output.
  return { ...FALLBACK, unmatched: family };
}

/** The fontspec setter that fills each of the three slots. */
export const FONTSPEC_SETTER: Readonly<Record<LatexFamily, string>> = {
  rm: "setmainfont",
  sf: "setsansfont",
  tt: "setmonofont",
};

/**
 * Whether the substitution is visible to the reader. A document in Garamond
 * gets Garamond either way, and saying "substituted" about it would be false.
 */
export function isSubstitution(
  requested: string | undefined,
  mapping: FontMapping,
): boolean {
  if (!requested) {
    return false;
  }
  return requested.trim().toLowerCase() !== mapping.fontspec.toLowerCase();
}
