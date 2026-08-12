import { XMLParser } from "fast-xml-parser";

/**
 * A second view of the same XML, ordered.
 *
 * `xml.ts` reads parts that are lookup tables — styles.xml and theme1.xml are
 * addressed by name and their order carries no meaning. A document body is the
 * opposite: it *is* a sequence. A paragraph mixes `w:r` runs with `w:hyperlink`
 * wrappers, and reading them as two separate collections reorders the sentence.
 *
 * fast-xml-parser can preserve order, but its shape for that mode is awkward to
 * walk — one single-key object per element, attributes under `:@`. This module
 * normalises it once into a plain recursive tree.
 */
export interface SequenceNode {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly SequenceNode[];
  /** Set only on text nodes, whose `name` is `#text`. */
  readonly text?: string;
}

const TEXT_NODE = "#text";
const ATTRIBUTES_KEY = ":@";

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseAttributeValue: false,
  parseTagValue: false,
  // Significant whitespace is the whole point of `xml:space="preserve"`.
  trimValues: false,
});

export function parseSequence(xml: string): readonly SequenceNode[] {
  return normalise(parser.parse(xml));
}

function normalise(raw: unknown): readonly SequenceNode[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const nodes: SequenceNode[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const attributes = readAttributes(entry[ATTRIBUTES_KEY]);

    for (const [name, payload] of Object.entries(entry)) {
      if (name === ATTRIBUTES_KEY) {
        continue;
      }
      if (name === TEXT_NODE) {
        nodes.push({
          name: TEXT_NODE,
          attributes,
          children: [],
          text: String(payload),
        });
        continue;
      }
      nodes.push({ name, attributes, children: normalise(payload) });
    }
  }
  return nodes;
}

function readAttributes(raw: unknown): Readonly<Record<string, string>> {
  if (!isRecord(raw)) {
    return {};
  }
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      attributes[key.replace(/^@/, "")] = value;
    }
  }
  return attributes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function findChild(
  node: SequenceNode | undefined,
  name: string,
): SequenceNode | undefined {
  return node?.children.find((c) => c.name === name);
}

/** Follows a chain of first-matching children, e.g. `w:pPr` then `w:pStyle`. */
export function descendSequence(
  node: SequenceNode | undefined,
  ...names: readonly string[]
): SequenceNode | undefined {
  return names.reduce<SequenceNode | undefined>(
    (current, name) => findChild(current, name),
    node,
  );
}

export function attributeOf(
  node: SequenceNode | undefined,
  name: string,
): string | undefined {
  return node?.attributes[name];
}

/** True when the element is present, whether or not it carries anything. */
export function hasChild(
  node: SequenceNode | undefined,
  name: string,
): boolean {
  return node?.children.some((c) => c.name === name) ?? false;
}

/** Every descendant text node, concatenated in document order. */
export function textOf(node: SequenceNode | undefined): string {
  if (!node) {
    return "";
  }
  if (node.name === TEXT_NODE) {
    return node.text ?? "";
  }
  return node.children.map(textOf).join("");
}

/** Depth-first search for the first element with the given name. */
export function findDescendant(
  nodes: readonly SequenceNode[],
  name: string,
): SequenceNode | undefined {
  for (const node of nodes) {
    if (node.name === name) {
      return node;
    }
    const found = findDescendant(node.children, name);
    if (found) {
      return found;
    }
  }
  return undefined;
}
