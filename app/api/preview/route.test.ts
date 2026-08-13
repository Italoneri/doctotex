import { describe, expect, it } from "vitest";
import { isDockerAvailable } from "@/lib/latex/compile";
import { POST } from "./route";

const dockerUp = await isDockerAvailable();

/** Generous: a first pass pulls fonts into the container's cache. */
const COMPILE_TIMEOUT = { timeout: 300_000 };

const DOCUMENT =
  "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n";

function post(body: unknown): Request {
  return new Request("http://localhost/api/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("input rejection", () => {
  const cases: ReadonlyArray<[name: string, body: unknown]> = [
    ["a missing sources object", {}],
    ["an empty sources object", { sources: {} }],
    ["a non-string file body", { sources: { "main.tex": 1 } }],
    ["an entry that is not among the sources", { sources: { "a.tex": "x" } }],
    [
      "an entry that is not a .tex file",
      { sources: { "main.tex": "x" }, entry: "main.tex.sh" },
    ],
    [
      "an entry outside the sources",
      { sources: { "main.tex": "x" }, entry: "other.tex" },
    ],
  ];

  for (const [name, body] of cases) {
    it(`rejects ${name}`, async () => {
      const response = await POST(post(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ reason: "invalid" });
    });
  }

  // The compile workspace is a real directory, so a traversing entry name would
  // write outside it exactly as it would escape a zip.
  it("rejects a source path that escapes the workspace", async () => {
    const response = await POST(
      post({ sources: { "../../escape.tex": DOCUMENT } }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a body that is not JSON", async () => {
    const request = new Request("http://localhost/api/preview", {
      method: "POST",
      body: "not json",
    });

    expect((await POST(request)).status).toBe(400);
  });
});

describe.skipIf(!dockerUp)("compiling", () => {
  it("answers with the pdf itself", COMPILE_TIMEOUT, async () => {
    const response = await POST(post({ sources: { "main.tex": DOCUMENT } }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");

    const pdf = new Uint8Array(await response.arrayBuffer());
    expect(pdf.length).toBeGreaterThan(1000);
    // Every PDF opens with %PDF-.
    expect(String.fromCharCode(...pdf.slice(0, 5))).toBe("%PDF-");
  });

  it("answers a rejected document with its log", COMPILE_TIMEOUT, async () => {
    const broken =
      "\\documentclass{article}\n\\begin{document}\n\\undefinedmacro\n\\end{document}\n";

    const response = await POST(post({ sources: { "main.tex": broken } }));

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ reason: "rejected" });
    expect(body.log).toContain("Undefined control sequence");
  });
});
