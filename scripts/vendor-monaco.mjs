import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Copies Monaco's prebuilt AMD bundle into public/ so the editor is served from
 * this origin.
 *
 * `@monaco-editor/react` otherwise pulls the editor from a CDN at runtime,
 * which makes an offline machine show an empty box and puts a third party in
 * the path of every session. Importing the npm ESM entry instead would pull the
 * whole language-service set into the client bundle; the AMD build loads only
 * the chunks it needs.
 */
const require = createRequire(import.meta.url);

// The package's own entry point is inside the AMD bundle (min/vs/index.js), and
// its exports map hides package.json, so the directory is derived from the
// entry rather than looked up by name.
const source = dirname(require.resolve("monaco-editor"));
const target = new URL("../public/monaco/vs/", import.meta.url);
const stamp = new URL("../public/monaco/version.txt", import.meta.url);

const manifest = join(source, "..", "..", "package.json");
const version = JSON.parse(await readFile(manifest, "utf8")).version;

if ((await readSafely(stamp)) === version) {
  process.exit(0);
}

await rm(new URL("../public/monaco/", import.meta.url), {
  recursive: true,
  force: true,
});
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
await writeFile(stamp, version, "utf8");

console.log(`vendored monaco-editor ${version} into public/monaco/vs`);

async function readSafely(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}
