import { findChild, textOf, type SequenceNode } from "@/lib/docx/sequence";

/**
 * An equation, read whole or not at all.
 *
 * Partial mathematics is the one degradation that cannot be reported honestly.
 * A paragraph that loses its italics still says what it said; an integral that
 * loses its limits says something else, and says it in a form the reader has no
 * way to tell apart from what the author wrote. So a construct this build does
 * not cover fails the whole equation rather than the piece — the report then
 * names an equation that is missing, which is true, instead of showing one that
 * is wrong, which is not.
 */
export type EquationReading =
  | { readonly kind: "read"; readonly latex: string }
  | { readonly kind: "unreadable"; readonly because: string };

/**
 * Word's own equations, in Office MathML.
 *
 * `m:oMathPara` wraps one or more `m:oMath` for display; the equations inside
 * it are read individually, because that is the unit the document numbers and
 * the unit a reader points at.
 */
export function readEquation(node: SequenceNode): EquationReading {
  const latex = readNodes(node.children);

  if (latex === undefined) {
    return {
      kind: "unreadable",
      because: "it uses mathematics this build does not read yet",
    };
  }
  if (latex.trim() === "") {
    return { kind: "unreadable", because: "it carries no readable content" };
  }
  return { kind: "read", latex: latex.trim() };
}

/** Undefined anywhere below means the whole equation is refused. */
function readNodes(nodes: readonly SequenceNode[]): string | undefined {
  let latex = "";

  for (const node of nodes) {
    const piece = readNode(node);
    if (piece === undefined) {
      return undefined;
    }
    latex += piece;
  }

  return latex;
}

function readNode(node: SequenceNode): string | undefined {
  const reader = READERS[node.name];
  return reader ? reader(node) : undefined;
}

/** The child of `name`, read as LaTeX; undefined if absent or unreadable. */
function readPart(node: SequenceNode, name: string): string | undefined {
  const child = findChild(node, name);
  return child ? readNodes(child.children) : undefined;
}

/**
 * A part that may legitimately be absent — a radical without a degree, a
 * summation without an upper limit. Missing reads as empty; present but
 * unreadable still refuses.
 */
function readOptionalPart(
  node: SequenceNode,
  name: string,
): string | undefined | null {
  const child = findChild(node, name);
  if (!child) {
    return null;
  }
  return readNodes(child.children);
}

type Reader = (node: SequenceNode) => string | undefined;

/**
 * Every OMML element this build reads, and nothing else.
 *
 * A map rather than a switch so that the set is a value: what is covered can be
 * listed, tested and extended without touching the walk.
 */
const READERS: Readonly<Record<string, Reader>> = {
  // Properties describe how Word drew the element; the reading is of what it
  // says, and every reader that needs them looks at them directly.
  "m:argPr": () => "",
  "m:ctrlPr": () => "",
  "m:fPr": () => "",
  "m:dPr": () => "",
  "m:radPr": () => "",
  "m:naryPr": () => "",
  "m:sSupPr": () => "",
  "m:sSubPr": () => "",
  "m:sSubSupPr": () => "",

  "m:oMath": (node) => readNodes(node.children),
  "m:e": (node) => readNodes(node.children),
  "m:r": readRun,
  "m:f": readFraction,
  "m:sSup": readSuperscript,
  "m:sSub": readSubscript,
  "m:sSubSup": readSubSuperscript,
  "m:rad": readRadical,
  "m:d": readDelimiter,
  "m:nary": readNary,
  "#text": () => "",
};

/** A run of mathematical text, which is where the actual symbols live. */
function readRun(node: SequenceNode): string | undefined {
  const text = node.children
    .filter((child) => child.name === "m:t")
    .map(textOf)
    .join("");

  return translate(text);
}

function readFraction(node: SequenceNode): string | undefined {
  const numerator = readPart(node, "m:num");
  const denominator = readPart(node, "m:den");

  if (numerator === undefined || denominator === undefined) {
    return undefined;
  }
  return `\\frac{${numerator}}{${denominator}}`;
}

function readSuperscript(node: SequenceNode): string | undefined {
  const base = readPart(node, "m:e");
  const sup = readPart(node, "m:sup");

  if (base === undefined || sup === undefined) {
    return undefined;
  }
  return `{${base}}^{${sup}}`;
}

function readSubscript(node: SequenceNode): string | undefined {
  const base = readPart(node, "m:e");
  const sub = readPart(node, "m:sub");

  if (base === undefined || sub === undefined) {
    return undefined;
  }
  return `{${base}}_{${sub}}`;
}

function readSubSuperscript(node: SequenceNode): string | undefined {
  const base = readPart(node, "m:e");
  const sub = readPart(node, "m:sub");
  const sup = readPart(node, "m:sup");

  if (base === undefined || sub === undefined || sup === undefined) {
    return undefined;
  }
  return `{${base}}_{${sub}}^{${sup}}`;
}

/** `\sqrt` with an index, or without one where Word hides the degree. */
function readRadical(node: SequenceNode): string | undefined {
  const radicand = readPart(node, "m:e");
  const degree = readOptionalPart(node, "m:deg");

  if (radicand === undefined || degree === undefined) {
    return undefined;
  }
  // Word writes an empty m:deg for a square root, which is not an index.
  const index = degree && degree.trim() !== "" ? `[${degree}]` : "";
  return `\\sqrt${index}{${radicand}}`;
}

/**
 * Word stores the brackets as the characters to draw, defaulting to parentheses
 * when it says nothing. `\left`/`\right` is what makes them grow with what they
 * hold, which is the whole reason the element exists rather than two runs.
 */
const DELIMITERS: Readonly<Record<string, string>> = {
  "(": "(",
  ")": ")",
  "[": "[",
  "]": "]",
  "{": "\\{",
  "}": "\\}",
  "|": "|",
  "⟨": "\\langle",
  "⟩": "\\rangle",
};

function readDelimiter(node: SequenceNode): string | undefined {
  const properties = findChild(node, "m:dPr");
  const open = delimiterFor(properties, "m:begChr", "(");
  const close = delimiterFor(properties, "m:endChr", ")");
  const body = readNodes(node.children);

  if (open === undefined || close === undefined || body === undefined) {
    return undefined;
  }
  return `\\left${open}${body}\\right${close}`;
}

function delimiterFor(
  properties: SequenceNode | undefined,
  name: string,
  fallback: string,
): string | undefined {
  const declared = findChild(properties, name)?.attributes["m:val"];
  return DELIMITERS[declared ?? fallback];
}

/**
 * A big operator: sum, product, integral and their relatives, with the limits
 * Word attached to them.
 *
 * The operator itself is a character in `m:chr`, defaulting to the integral
 * sign when absent. One this build has no command for refuses the equation
 * rather than substituting the nearest-looking one.
 */
const NARY_OPERATORS: Readonly<Record<string, string>> = {
  "∑": "\\sum",
  "∏": "\\prod",
  "∐": "\\coprod",
  "∫": "\\int",
  "∬": "\\iint",
  "∭": "\\iiint",
  "∮": "\\oint",
  "⋃": "\\bigcup",
  "⋂": "\\bigcap",
};

function readNary(node: SequenceNode): string | undefined {
  const properties = findChild(node, "m:naryPr");
  const operator =
    NARY_OPERATORS[findChild(properties, "m:chr")?.attributes["m:val"] ?? "∫"];

  const body = readPart(node, "m:e");
  const sub = readOptionalPart(node, "m:sub");
  const sup = readOptionalPart(node, "m:sup");

  if (
    operator === undefined ||
    body === undefined ||
    sub === undefined ||
    sup === undefined
  ) {
    return undefined;
  }

  const lower = sub && sub.trim() !== "" ? `_{${sub}}` : "";
  const upper = sup && sup.trim() !== "" ? `^{${sup}}` : "";
  return `${operator}${lower}${upper}{${body}}`;
}

/**
 * The characters Word writes literally that LaTeX spells as a command.
 *
 * A finite table of things that are true — α is `\alpha` — rather than a guess
 * at what a symbol might have meant. A character absent from it refuses the
 * equation, which is why the table is worth extending and worth never filling
 * in by approximation.
 */
const SYMBOLS: Readonly<Record<string, string>> = {
  α: "\\alpha",
  β: "\\beta",
  γ: "\\gamma",
  δ: "\\delta",
  ε: "\\varepsilon",
  ζ: "\\zeta",
  η: "\\eta",
  θ: "\\theta",
  ι: "\\iota",
  κ: "\\kappa",
  λ: "\\lambda",
  μ: "\\mu",
  ν: "\\nu",
  ξ: "\\xi",
  π: "\\pi",
  ρ: "\\rho",
  σ: "\\sigma",
  τ: "\\tau",
  υ: "\\upsilon",
  φ: "\\varphi",
  χ: "\\chi",
  ψ: "\\psi",
  ω: "\\omega",
  Γ: "\\Gamma",
  Δ: "\\Delta",
  Θ: "\\Theta",
  Λ: "\\Lambda",
  Ξ: "\\Xi",
  Π: "\\Pi",
  Σ: "\\Sigma",
  Φ: "\\Phi",
  Ψ: "\\Psi",
  Ω: "\\Omega",
  "×": "\\times",
  "÷": "\\div",
  "±": "\\pm",
  "∓": "\\mp",
  "≤": "\\leq",
  "≥": "\\geq",
  "≠": "\\neq",
  "≈": "\\approx",
  "≡": "\\equiv",
  "∞": "\\infty",
  "∂": "\\partial",
  "∇": "\\nabla",
  "√": "\\surd",
  "·": "\\cdot",
  "−": "-",
  "→": "\\to",
  "∈": "\\in",
  "∅": "\\emptyset",
  "%": "\\%",
};

/** What needs no translation: it means in LaTeX what it means in the document. */
const LITERAL = /^[A-Za-z0-9 +\-=/()[\]|<>,.!'`:;*?]$/;

function translate(text: string): string | undefined {
  const characters = [...text];
  let latex = "";

  for (const [index, character] of characters.entries()) {
    const symbol = SYMBOLS[character];
    if (symbol !== undefined) {
      latex += symbol + separatorAfter(symbol, characters[index + 1]);
      continue;
    }
    if (!LITERAL.test(character)) {
      return undefined;
    }
    latex += character;
  }

  return latex;
}

/**
 * TeX reads a command name as letters until something that is not one, so
 * `\alpha x` needs the space and `\alpha=` does not. Adding it either way
 * doubles the spaces the document actually asked for.
 */
function separatorAfter(symbol: string, next: string | undefined): string {
  const isCommand = /[A-Za-z]$/.test(symbol);
  const continuesTheName = next !== undefined && /[A-Za-z]/.test(next);

  return isCommand && continuesTheName ? " " : "";
}
