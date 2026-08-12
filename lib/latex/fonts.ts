/** pdfLaTeX offers exactly three family slots, and every face lands in one. */
export type LatexFamily = "rm" | "sf" | "tt";

export interface FontMapping {
  /** Package names to `\RequirePackage`, in load order. */
  readonly packages: readonly string[];
  readonly family: LatexFamily;
  /** Present when nothing matched, to be emitted as a comment in the class. */
  readonly unmatched?: string;
}

/**
 * Word names a typeface; pdfLaTeX needs a package. Where a metric-compatible
 * clone exists the line lengths match the original, so the page breaks land in
 * roughly the same places.
 *
 * Keys are lowercased family names as Word writes them.
 */
const MAPPINGS: Readonly<Record<string, FontMapping>> = {
  "times new roman": { packages: ["newtxtext", "newtxmath"], family: "rm" },
  times: { packages: ["newtxtext", "newtxmath"], family: "rm" },
  arial: { packages: ["helvet"], family: "sf" },
  helvetica: { packages: ["helvet"], family: "sf" },
  // Carlito and Caladea are metric clones of Calibri and Cambria.
  calibri: { packages: ["carlito"], family: "sf" },
  cambria: { packages: ["caladea"], family: "rm" },
  "courier new": { packages: ["courier"], family: "tt" },
  courier: { packages: ["courier"], family: "tt" },
  garamond: { packages: ["ebgaramond"], family: "rm" },
  "eb garamond": { packages: ["ebgaramond"], family: "rm" },
  "book antiqua": { packages: ["newpxtext", "newpxmath"], family: "rm" },
  palatino: { packages: ["newpxtext", "newpxmath"], family: "rm" },
  "palatino linotype": { packages: ["newpxtext", "newpxmath"], family: "rm" },
  "century schoolbook": { packages: ["fouriernc"], family: "rm" },
  "computer modern": { packages: ["lmodern"], family: "rm" },
  "latin modern roman": { packages: ["lmodern"], family: "rm" },
};

/** Used when the document names a face with no free counterpart. */
const FALLBACK: FontMapping = { packages: ["lmodern"], family: "rm" };

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

/**
 * XeLaTeX and LuaLaTeX load system fonts by name through fontspec, so the
 * substitution table does not apply to them. Phase 4 selects between the two
 * paths; this exists so the class generator can already ask.
 */
export function fontspecName(family: string | undefined): string | undefined {
  return family?.trim() || undefined;
}
