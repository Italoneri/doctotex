export type Orientation = "portrait" | "landscape";

export type Alignment = "left" | "center" | "right" | "justify";

export interface PageMargins {
  readonly topMm: number;
  readonly bottomMm: number;
  readonly leftMm: number;
  readonly rightMm: number;
  readonly headerMm: number;
  readonly footerMm: number;
}

export interface PageGeometry {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly orientation: Orientation;
  readonly margins: PageMargins;
}

/**
 * Every field is optional because a style declares only what it overrides; the
 * cascade in styles.ts merges the chain before anything is consumed.
 */
export interface TextStyle {
  readonly fontFamily?: string;
  readonly fontSizePt?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly allCaps?: boolean;
  readonly colorHex?: string;
}

/**
 * `w:lineRule` changes what `w:line` means: a 240th-of-a-line multiplier under
 * `auto`, absolute twips under `exact` and `atLeast`. Keeping them in one
 * numeric field would make a 1.5x document indistinguishable from a 1.5pt one.
 */
export type LineSpacing =
  | { readonly kind: "multiple"; readonly value: number }
  | { readonly kind: "exact"; readonly pt: number }
  | { readonly kind: "atLeast"; readonly pt: number };

export interface ParagraphStyle {
  readonly lineSpacing?: LineSpacing;
  readonly spaceBeforePt?: number;
  readonly spaceAfterPt?: number;
  readonly indentLeftMm?: number;
  readonly indentFirstLineMm?: number;
  readonly alignment?: Alignment;
  readonly keepWithNext?: boolean;
  readonly pageBreakBefore?: boolean;
}

export interface EffectiveStyle {
  readonly text: TextStyle;
  readonly paragraph: ParagraphStyle;
}

export interface HeadingStyle extends EffectiveStyle {
  /** 1-based Word outline level. Documents may skip levels entirely. */
  readonly level: number;
  /** Localised in non-English documents: "Titre1" rather than "Heading1". */
  readonly styleId: string;
}

export interface ThemeFonts {
  readonly major?: string;
  readonly minor?: string;
}

export interface DocumentFeatures {
  readonly tables: boolean;
  readonly images: boolean;
  readonly ommlEquations: boolean;
  /** Legacy Equation 3.0 objects, which the OMML walker cannot read. */
  readonly oleObjects: boolean;
  readonly headers: boolean;
  readonly footers: boolean;
  readonly numbering: boolean;
}

/** The single contract between extraction and LaTeX generation. */
export interface StyleProfile {
  readonly page: PageGeometry;
  readonly defaults: EffectiveStyle;
  readonly headings: readonly HeadingStyle[];
  /** Word's "Title" style, which is not part of the heading levels. */
  readonly title?: EffectiveStyle;
  readonly theme: ThemeFonts;
  readonly features: DocumentFeatures;
}
