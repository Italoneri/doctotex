import type { languages } from "monaco-editor";

/** Monaco ships no LaTeX grammar, so the editor registers this one. */
export const LATEX_LANGUAGE_ID = "latex";

/**
 * A control sequence is a backslash followed by letters, or by exactly one
 * non-letter. The second form is what makes `\\`, `\%` and `\&` a single token
 * rather than a stray backslash next to a comment or an alignment character.
 */
export const latexTokens: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".tex",

  tokenizer: {
    root: [
      [/%.*$/, "comment"],
      [/\\(?:begin|end)\b/, { token: "keyword.control", next: "@environment" }],
      [/\\[a-zA-Z@]+\*?/, "keyword"],
      [/\\[^a-zA-Z]/, "string.escape"],
      [/\$\$/, { token: "string", next: "@displayMath" }],
      [/\$/, { token: "string", next: "@inlineMath" }],
      [/[{}]/, "delimiter.bracket"],
      [/[[\]]/, "delimiter.square"],
      [/[&~^_]/, "operator"],
    ],

    // The environment name carries the document's structure, so it is coloured
    // apart from the \begin that introduces it.
    environment: [
      [/\s+/, ""],
      [/\{/, "delimiter.bracket"],
      [/[a-zA-Z]+\*?/, "type"],
      [/\}/, { token: "delimiter.bracket", next: "@pop" }],
      [/./, { token: "", next: "@pop" }],
    ],

    inlineMath: [
      [/\$/, { token: "string", next: "@pop" }],
      [/\\[a-zA-Z@]+/, "keyword"],
      [/\\[^a-zA-Z]/, "string.escape"],
      [/[^$\\]+/, "string"],
    ],

    displayMath: [
      [/\$\$/, { token: "string", next: "@pop" }],
      [/\\[a-zA-Z@]+/, "keyword"],
      [/\\[^a-zA-Z]/, "string.escape"],
      [/[^$\\]+/, "string"],
    ],
  },
};

export const latexConfiguration: languages.LanguageConfiguration = {
  comments: { lineComment: "%" },
  brackets: [
    ["{", "}"],
    ["[", "]"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "$", close: "$" },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "$", close: "$" },
  ],
};
