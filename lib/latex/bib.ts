import {
  CITATION_LABELS,
  type Bibliography,
  type CitationStyle,
} from "./options";

export const BIB_FILE = "references.bib";

/** `\bibliography` and `\addbibresource` name the file without its extension. */
const BIB_BASE = BIB_FILE.replace(/\.bib$/, "");

export interface BibliographySetup {
  /** Package loading, for the class or the inlined preamble. */
  readonly preamble: readonly string[];
  /**
   * The commands that print the list. They belong after `\begin{document}`:
   * `\bibliographystyle` writes to the .aux file, which is not open yet while
   * the preamble runs.
   */
  readonly body: readonly string[];
}

const EMPTY: BibliographySetup = { preamble: [], body: [] };

/** natbib reads a .bst; the author-year styles are the ones each field uses. */
const BST: Readonly<Record<CitationStyle, string>> = {
  apa: "apalike",
  // IEEEtran ships a plain and a natbib variant; only the latter defines the
  // commands natbib installs.
  ieee: "IEEEtranN",
  abnt: "abntex2-alf",
};

export function bibliographySetup(
  bibliography: Bibliography,
): BibliographySetup {
  switch (bibliography.backend) {
    case "none":
      return EMPTY;
    case "biblatex":
      return biblatex(bibliography.style);
    case "natbib":
      return natbib(bibliography.style);
  }
}

function biblatex(style: CitationStyle): BibliographySetup {
  return {
    preamble: [
      `%% Bibliography: biblatex with the biber backend, ${CITATION_LABELS[style]} style.`,
      ...provenance(),
      "\\RequirePackage{csquotes}",
      `\\RequirePackage[backend=biber,style=${style}]{biblatex}`,
      `\\addbibresource{${BIB_FILE}}`,
    ],
    body: ["\\printbibliography"],
  };
}

function natbib(style: CitationStyle): BibliographySetup {
  return {
    preamble: [
      `%% Bibliography: natbib with BibTeX, ${CITATION_LABELS[style]} style.`,
      ...provenance(),
      // abntex2cite loads natbib itself, with the options ABNT's author-date
      // form needs. Loading natbib alongside it is an option clash.
      ...(style === "abnt"
        ? ["\\RequirePackage[alf]{abntex2cite}"]
        : ["\\RequirePackage{natbib}"]),
    ],
    body: [`\\bibliographystyle{${BST[style]}}`, `\\bibliography{${BIB_BASE}}`],
  };
}

/**
 * Said once in the class and again in the .bib, because whoever opens one of
 * the two files is entitled to know why it is empty.
 */
function provenance(): readonly string[] {
  return [
    `%% Entries go in ${BIB_FILE}. They are not carried over from the Word`,
    "%% document: Word stores citations as fields with no BibTeX keys, so there",
    "%% is nothing to translate.",
  ];
}

export function bibliographyStub(): string {
  return [
    "% References for the generated document.",
    "%",
    "% This file is a starting point, not an extraction: the Word document's",
    "% citations, if it had any, are fields in its own format rather than",
    "% BibTeX records. Replace the entry below with your own and cite it from",
    "% main.tex with \\cite{...}.",
    "",
    "@article{doctotex-placeholder,",
    "  author  = {Author, An},",
    "  title   = {Replace this entry with a real reference},",
    "  journal = {Journal Name},",
    "  year    = {2026},",
    "  volume  = {1},",
    "  pages   = {1--10},",
    "}",
    "",
  ].join("\n");
}
