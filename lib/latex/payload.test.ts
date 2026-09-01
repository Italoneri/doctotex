import { describe, expect, it } from "vitest";
import { MAX_ASSET_BYTES, readAssets } from "./payload";

/** Base64 for the bytes a test wants to see come back out. */
function encode(bytes: readonly number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString("base64");
}

/** The eight bytes every PNG opens with, which the reader checks for. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("readAssets", () => {
  it("decodes an entry back to the bytes it was made from", () => {
    const bytes = [...PNG_SIGNATURE, 1, 2, 3, 4];
    const assets = readAssets({
      assets: { "media/image1.png": encode(bytes) },
    });

    expect(assets?.get("media/image1.png")).toEqual(Uint8Array.from(bytes));
  });

  // A request that predates the field is not a broken one.
  it("reads an absent field as no pictures", () => {
    expect(readAssets({ sources: {} })?.size).toBe(0);
  });

  it("rejects a path that climbs out of the directory it is written to", () => {
    expect(
      readAssets({ assets: { "../../etc/passwd": encode([0]) } }),
    ).toBeUndefined();
  });

  // Buffer.from takes what it can parse and drops the rest, which would make a
  // corrupt picture rather than a rejected request.
  it("rejects an entry that is not valid base64", () => {
    expect(
      readAssets({ assets: { "media/a.png": "not base64!" } }),
    ).toBeUndefined();
  });

  it("rejects an entry whose length no base64 string has", () => {
    expect(readAssets({ assets: { "media/a.png": "QUJD=" } })).toBeUndefined();
  });

  it("rejects a value that is not a string", () => {
    expect(readAssets({ assets: { "media/a.png": 12 } })).toBeUndefined();
  });

  it("rejects a body carrying more bytes than the cap allows", () => {
    // A real signature, so the cap is what rejects this and not the format
    // check that runs before it.
    const oversized = Buffer.concat([
      Buffer.from(PNG_SIGNATURE),
      Buffer.alloc(MAX_ASSET_BYTES + 1),
    ]).toString("base64");

    expect(
      readAssets({ assets: { "media/a.png": oversized } }),
    ).toBeUndefined();
  });

  it("rejects assets that are not an object", () => {
    expect(readAssets({ assets: "media/a.png" })).toBeUndefined();
  });
});

describe("readAssets on bytes that are not the format they claim", () => {
  /** The exact failure this check exists for: the base64 written as the file. */
  const PIXEL_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("rejects a picture whose own base64 text was written as its bytes", () => {
    const doubled = Buffer.from(PIXEL_PNG, "utf8").toString("base64");

    expect(readAssets({ assets: { "media/a.png": doubled } })).toBeUndefined();
  });

  it("accepts a png that opens with the png signature", () => {
    const assets = readAssets({ assets: { "media/a.png": PIXEL_PNG } });

    expect(assets?.get("media/a.png")?.slice(0, 4)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it("accepts a jpeg that opens with the jpeg signature", () => {
    const jpeg = encode([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

    expect(readAssets({ assets: { "media/a.jpeg": jpeg } })?.size).toBe(1);
  });

  it("rejects a png named as a jpeg", () => {
    expect(
      readAssets({ assets: { "media/a.jpeg": PIXEL_PNG } }),
    ).toBeUndefined();
  });

  it("rejects a pdf that does not open with %PDF", () => {
    expect(
      readAssets({ assets: { "media/a.pdf": encode([1, 2, 3, 4]) } }),
    ).toBeUndefined();
  });

  it("rejects a file too short to carry the signature at all", () => {
    expect(
      readAssets({ assets: { "media/a.png": encode([0x89]) } }),
    ).toBeUndefined();
  });

  // Guessing at a format the generator never emits would reject files this
  // check knows nothing about.
  it("leaves an extension it has no signature for alone", () => {
    expect(
      readAssets({ assets: { "media/a.eps": encode([1, 2, 3, 4]) } })?.size,
    ).toBe(1);
  });
});
