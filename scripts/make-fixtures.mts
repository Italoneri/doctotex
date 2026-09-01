import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { listsNested } from "../fixtures/documents.ts";

/**
 * Writes the built fixtures into `fixtures/` so they can be opened in Word, in
 * the browser, or with `unzip -p`.
 *
 * The suite does not need this: it builds the same documents in memory, which
 * is what keeps it from skipping on a checkout with no `.docx` in it. This is
 * for looking at them — a converter that produces the wrong PDF is easiest to
 * diagnose beside the document it came from.
 */
const DOCUMENTS: readonly (readonly [string, () => Promise<Uint8Array>])[] = [
  ["lists-nested.docx", listsNested],
];

for (const [name, build] of DOCUMENTS) {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  await writeFile(path, await build());
  process.stdout.write(`fixtures/${name}\n`);
}
