import { describe, expect, it } from "vitest";
import { MAX_ASSET_BYTES, readAssets } from "./payload";

/** Base64 for the bytes a test wants to see come back out. */
function encode(bytes: readonly number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString("base64");
}

describe("readAssets", () => {
  it("decodes an entry back to the bytes it was made from", () => {
    const assets = readAssets({
      assets: { "media/image1.png": encode([137, 80, 78, 71]) },
    });

    expect(assets?.get("media/image1.png")).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
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
    const oversized = Buffer.alloc(MAX_ASSET_BYTES + 1).toString("base64");

    expect(
      readAssets({ assets: { "media/a.png": oversized } }),
    ).toBeUndefined();
  });

  it("rejects assets that are not an object", () => {
    expect(readAssets({ assets: "media/a.png" })).toBeUndefined();
  });
});
