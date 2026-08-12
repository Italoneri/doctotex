import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { POST } from "./route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/bundle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = {
  filename: "thesis.docx",
  sources: { "main.tex": "\\documentclass{article}" },
};

describe("packaging", () => {
  it("returns a zip of the sources it was given", async () => {
    const response = await POST(post(VALID));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");

    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(["main.tex"]);
  });

  it("names the download after the source document", async () => {
    const response = await POST(post(VALID));

    expect(response.headers.get("Content-Disposition")).toContain(
      'filename="thesis.zip"',
    );
  });

  it("strips characters that would break out of the header value", async () => {
    const response = await POST(
      post({ ...VALID, filename: 'a"; rm -rf /; x.docx' }),
    );

    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).toBe('attachment; filename="a---rm--rf----x.zip"');
  });
});

describe("path rejection", () => {
  // An entry named ../../etc/passwd escapes the extraction directory on any
  // tool that follows the path. A dot is legal inside a segment but not first,
  // which is what distinguishes main.tex from `..`.
  const traversals = [
    "../../etc/passwd",
    "..",
    "./main.tex",
    "/absolute/main.tex",
    "images/../../escape.tex",
    "..\\windows\\system32",
  ];

  for (const path of traversals) {
    it(`rejects ${path}`, async () => {
      const response = await POST(
        post({ filename: "x", sources: { [path]: "content" } }),
      );

      expect(response.status).toBe(400);
    });
  }

  it("accepts a nested path that stays inside the archive", async () => {
    const response = await POST(
      post({ filename: "x", sources: { "images/figure-1.png": "data" } }),
    );

    expect(response.status).toBe(200);
  });
});

describe("input rejection", () => {
  const cases: ReadonlyArray<[name: string, body: unknown]> = [
    ["a missing sources object", { filename: "x" }],
    ["an empty sources object", { filename: "x", sources: {} }],
    ["a non-string file body", { filename: "x", sources: { "a.tex": 123 } }],
    ["sources that is not an object", { filename: "x", sources: "nope" }],
  ];

  for (const [name, body] of cases) {
    it(`rejects ${name}`, async () => {
      expect((await POST(post(body))).status).toBe(400);
    });
  }

  it("rejects a body that is not JSON", async () => {
    const request = new Request("http://localhost/api/bundle", {
      method: "POST",
      body: "not json",
    });

    expect((await POST(request)).status).toBe(400);
  });

  it("rejects sources larger than the limit", async () => {
    const huge = { filename: "x", sources: { "a.tex": "x".repeat(6_000_000) } };

    expect((await POST(post(huge))).status).toBe(400);
  });
});
