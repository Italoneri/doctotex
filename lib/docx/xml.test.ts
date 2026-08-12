import { describe, expect, it } from "vitest";
import { attribute, child, descend, parseXml, toArray, value } from "./xml";

const DOC = parseXml(`<?xml version="1.0"?>
<w:root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:rPr>
    <w:b/>
    <w:i w:val="0"/>
    <w:sz w:val="24"/>
  </w:rPr>
  <w:item w:id="1"/>
  <w:item w:id="2"/>
  <w:solo w:id="only"/>
</w:root>`);

const root = child(DOC, "w:root");

describe("value", () => {
  // An element with neither attributes nor children parses to the empty string
  // rather than an object, so presence cannot be probed by reading a child.
  it("reports a bare toggle element as present with no value", () => {
    expect(value(child(root, "w:rPr"), "w:b")).toEqual({
      present: true,
      val: undefined,
    });
  });

  it("reports a toggle switched off as present with its value", () => {
    expect(value(child(root, "w:rPr"), "w:i")).toEqual({
      present: true,
      val: "0",
    });
  });

  it("reports an absent element as not present", () => {
    expect(value(child(root, "w:rPr"), "w:caps")).toEqual({
      present: false,
      val: undefined,
    });
  });

  it("reports not present when the parent itself is missing", () => {
    expect(value(undefined, "w:b")).toEqual({ present: false, val: undefined });
  });
});

describe("toArray", () => {
  it("returns every occurrence of a repeated element", () => {
    expect(toArray(root?.["w:item"])).toHaveLength(2);
  });

  // The parser collapses a lone occurrence to a bare object, which is the
  // single most common source of off-by-one bugs when reading OOXML.
  it("wraps a single occurrence that the parser did not array", () => {
    expect(toArray(root?.["w:solo"])).toHaveLength(1);
  });

  it("returns nothing for an absent element", () => {
    expect(toArray(root?.["w:missing"])).toEqual([]);
  });
});

describe("attribute", () => {
  it("reads an attribute as a raw string", () => {
    expect(attribute(child(root, "w:solo"), "w:id")).toBe("only");
  });

  it("leaves numeric-looking values as strings for units.ts to interpret", () => {
    expect(attribute(child(child(root, "w:rPr"), "w:sz"), "w:val")).toBe("24");
  });

  it("returns undefined for an attribute that is not set", () => {
    expect(attribute(child(root, "w:solo"), "w:nope")).toBeUndefined();
  });
});

describe("descend", () => {
  it("follows a chain of single children", () => {
    expect(attribute(descend(DOC, "w:root", "w:rPr", "w:sz"), "w:val")).toBe(
      "24",
    );
  });

  it("returns undefined as soon as a link is missing", () => {
    expect(descend(DOC, "w:root", "w:missing", "w:sz")).toBeUndefined();
  });
});
