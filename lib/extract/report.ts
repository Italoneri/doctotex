/**
 * What the converter could not carry across, and why.
 *
 * `DocumentFeatures` answers "did the document have tables"; this answers what
 * happened to them. The two are not the same question, and the second is the
 * one a reader comparing the PDF against the original actually asks.
 */
export type DegradationCode =
  | "custom-list-label"
  | "unresolved-list"
  | "nested-table"
  | "table-borders"
  | "unresolved-image"
  | "unsupported-image-format";

export interface Degradation {
  readonly code: DegradationCode;
  /** A specific sentence about this document, not a template to fill in. */
  readonly detail: string;
  /** How many times it happened; the same cause rarely strikes once. */
  readonly count: number;
}

export interface ConversionReport {
  readonly degradations: readonly Degradation[];
}

export const EMPTY_REPORT: ConversionReport = { degradations: [] };

/**
 * Collects degradations over one extraction.
 *
 * Extraction is a walk, so what it finds arrives one node at a time and cannot
 * be returned up the tree without every reader growing a second return value.
 * The state is created per call rather than per module: two conversions running
 * at once must not see each other's findings.
 */
export interface Degradations {
  readonly note: (code: DegradationCode, detail: string) => void;
  readonly report: () => ConversionReport;
}

export function collectDegradations(): Degradations {
  // Keyed by cause, not by occurrence: a bullet glyph this build cannot map
  // appears once per list item, and forty identical lines in the report say
  // less than one line and a count.
  const found = new Map<string, Degradation>();

  return {
    note(code, detail) {
      const key = `${code} ${detail}`;
      const previous = found.get(key);
      found.set(key, { code, detail, count: (previous?.count ?? 0) + 1 });
    },
    report() {
      return { degradations: [...found.values()] };
    },
  };
}
