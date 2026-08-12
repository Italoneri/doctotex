import { XMLParser } from "fast-xml-parser";

/** A parsed OOXML element: attributes prefixed with `@`, children by tag name. */
export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // OOXML numbers carry unit semantics (twips, half-points, 240ths of a line),
  // so units.ts owns every conversion. Letting the parser coerce them would
  // silently turn "0080" into 80 and "auto" into NaN.
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  // Prefixes are part of the name we match on: w:sz and a:sz are unrelated.
  removeNSPrefix: false,
});

export function parseXml(xml: string): XmlNode {
  return parser.parse(xml) as XmlNode;
}

/**
 * fast-xml-parser yields a bare object for a single occurrence and an array for
 * several, so every repeated element has to be normalised at the point of use.
 * Declaring the repeatable names up front instead would mean keeping a list in
 * step with the whole schema.
 */
export function toArray(value: unknown): readonly XmlNode[] {
  if (Array.isArray(value)) {
    return value.filter(isNode);
  }
  return isNode(value) ? [value] : [];
}

function isNode(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null;
}

/** Reads a child element, or `undefined` when it is absent or repeated. */
export function child(
  node: XmlNode | undefined,
  name: string,
): XmlNode | undefined {
  if (!node) {
    return undefined;
  }
  const [first] = toArray(node[name]);
  return first;
}

/** Follows a chain of single child elements, e.g. `w:pPr` then `w:spacing`. */
export function descend(
  node: XmlNode | undefined,
  ...names: readonly string[]
): XmlNode | undefined {
  return names.reduce<XmlNode | undefined>(
    (current, name) => child(current, name),
    node,
  );
}

/** Reads an attribute as a raw string, leaving interpretation to units.ts. */
export function attribute(
  node: XmlNode | undefined,
  name: string,
): string | undefined {
  const value = node?.[`@${name}`];
  return typeof value === "string" ? value : undefined;
}

/**
 * Most OOXML properties carry their payload in `w:val`. A present element with
 * no `w:val` still means something — `<w:b/>` is bold — so presence and value
 * are reported separately.
 *
 * Presence is a key check rather than a `child` call: an element with neither
 * attributes nor children parses to the empty string, not an object, so `child`
 * reports the bare `<w:b/>` as absent.
 */
export function value(
  node: XmlNode | undefined,
  name: string,
): { present: boolean; val: string | undefined } {
  if (!node || !(name in node)) {
    return { present: false, val: undefined };
  }
  return { present: true, val: attribute(child(node, name), "w:val") };
}
