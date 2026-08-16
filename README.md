# DocToTex

Turn a `.docx` into a LaTeX template that keeps its **visual identity** — margins,
typography, colours, heading hierarchy, headers and footers — not just its text.

Pandoc converts content and throws the styling away. Mammoth flattens everything
into semantic HTML. Anyone migrating a thesis, paper or report to LaTeX ends up
rebuilding the layout by hand.

DocToTex reads the raw OOXML inside the package rather than an abstraction over
it, extracts a typed `StyleProfile`, and generates a LaTeX template from it.
Output is a ZIP with `doctotex.cls` + `main.tex` + `images/`, previewed in the
browser before download.

## Status

**Phase 4 — the config panel.** Upload a `.docx` and it comes back as a
`doctotex.cls` and a `main.tex`, editable in the browser, compiled to a PDF shown
beside the code, and downloadable as a zip. Four settings change what is
generated; each one re-runs the conversion over the file the browser already
holds. Lists, tables, images and equations are not carried across yet — a
bulleted paragraph arrives as an ordinary one, and the `lists` chip in the report
says the document has them, not that the template keeps them.

| Setting        | Choices                            | What changes                                                          |
| -------------- | ---------------------------------- | --------------------------------------------------------------------- |
| Engine         | pdfLaTeX, XeLaTeX, LuaLaTeX        | Font selection: metric-clone packages, or `fontspec` by family name   |
| Bibliography   | none, `biblatex` (biber), `natbib` | Package loading, `references.bib`, extra engine passes when compiling |
| Citation style | APA, IEEE, ABNT                    | `style=` for biblatex; the `.bst` for natbib                          |
| Files          | class + `main.tex`, one `main.tex` | Whether the preamble lives in a `.cls` or inside the document         |

The preview is the real artifact: `POST /api/preview` runs the selected engine
over the text currently in the editor and answers with the PDF itself, so what
you look at and what you download come out of the same engine. The engine
travels with the request rather than being inferred from the sources — a
`fontspec` preamble read by pdfLaTeX fails in a way that looks like the reader's
mistake. Editing debounces and the editor keeps one compile in flight, but a
debounce is a courtesy from the client: the endpoint caps itself at two
containers and answers a third with 429.

`main.tex` carries the commands that build it, because the engine is chosen in a
browser and the archive is opened somewhere else. Reaching for pdfLaTeX out of
habit on a `fontspec` preamble produces errors that read as though the template
were broken; the same list drives the preview container, so the advice cannot
drift from what actually ran.

Compilation is verified by the test suite against the real engine, not asserted
about: `lib/latex/compile.test.ts` compiles in the texlive container and fails on
a non-zero exit. By default it runs one case per option — each of the three
engines, each of the seven bibliography settings, both layouts — plus the five
crossings that can plausibly fail together, all of them fontspec beside a
bibliography, since both rewrite the preamble the inter-pass tools read. The
defaults belong to all three option groups, so the set is deduplicated before it
runs: fifteen compiles instead of forty-two.

```bash
DOCTOTEX_MATRIX=full npm run test   # the whole cross product, 42 compiles
```

The matrix runs over a profile the test builds, so it does not go quiet when no
sample `.docx` is present. It skips where no Docker daemon is reachable.

Monaco is served from `public/monaco`, vendored on install by
`scripts/vendor-monaco.mjs`. The default is a CDN fetch at runtime, which makes
an offline machine show an empty box and puts a third party in the path of every
session.

To read the generated output rather than assert about it:

```bash
DOCTOTEX_INSPECT=1 npm run test   # writes sources, PDF and log to out/
```

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
```

| Script              | Purpose            |
| ------------------- | ------------------ |
| `npm run dev`       | Development server |
| `npm run build`     | Production build   |
| `npm run test`      | Vitest suite       |
| `npm run typecheck` | `tsc --noEmit`     |
| `npm run lint`      | ESLint             |
| `npm run format`    | Prettier write     |

## Layout

```
app/
  page.tsx                 upload and orchestration
  api/convert/route.ts     docx -> StyleProfile + sources   (nodejs runtime)
  api/preview/route.ts     sources -> PDF                   (nodejs runtime)
  api/bundle/route.ts      sources -> ZIP                   (nodejs runtime)
components/                Dropzone, ConfigPanel, ArchiveReport, StyleProfileReport,
                           PageDiagram, SourcesPanel, LatexEditor, PreviewPane
lib/
  docx/                    unzip, part reading, XML parsing
  editor/                  Monaco's LaTeX grammar
  extract/                 units, style cascade, page, typography, headings
  latex/                   options, .cls and .tex generation, compilation, ZIP
scripts/                   vendor-monaco.mjs
fixtures/                  real .docx used by the tests
```

Tests sit next to the code they cover (`upload.test.ts` beside `upload.ts`).

Three directories the original plan called for are not here. `templates/` was to
hold a `doctotex.cls` skeleton, but the class is assembled from the style profile
rather than filled into a template, so there is nothing static to keep.
`docker/` was to hold a shell wrapper, which `lib/latex/compile.ts` invokes
directly instead. `lib/omml/` belongs to phase 5 and will arrive with it.

Nothing validates with Zod. It was in the plan for the boundaries, and the
boundaries — `lib/latex/payload.ts` and `lib/latex/options.ts` — ended up as
hand-written total functions returning `T | undefined`, which the callers turn
into a 400. Keeping a schema library that nothing imported would have been a
dependency shipped for a paragraph in a plan.

## Roadmap

| Phase | Scope                                                                     | State     |
| ----- | ------------------------------------------------------------------------- | --------- |
| 0     | Setup, upload, archive inspection                                         | done      |
| 1     | Parse margins, typography, colours, heading hierarchy into `StyleProfile` | done      |
| 2     | Generate `doctotex.cls` + `main.tex`, assemble the ZIP                    | done      |
| 3     | Monaco code preview + server-side PDF rendering                           | done, MVP |
| 4     | Config panel: compiler, bibliography, output shape                        | done      |
| 5     | Tables, images, equations (OMML)                                          | next      |
| 6     | Visual polish                                                             |           |

## Toolchain decisions

**Compilation runs in Docker (`texlive/texlive:latest`).** The full scheme covers
pdfLaTeX, XeLaTeX, LuaLaTeX and biber in one image, so phases 2 and 4 need no
further installs. The same container backs the phase-3 preview, which makes the
preview byte-identical to the artifact you download.

Two browser-side alternatives were evaluated and rejected:

- **`latex.js`** cannot load `\documentclass{doctotex}` — it only supports
  `article`/`book` and a subset of commands, so the preview would show a
  different document from the one downloaded. Unmaintained since April 2023.
- **SwiftLaTeX (WASM)** resolves LaTeX packages on demand from
  `texlive.swiftlatex.com`, which no longer resolves in DNS. It is also AGPL-3.0,
  has no npm package, and its last release was February 2022.

The consequence is that the compile endpoint needs a host that can run Docker —
Fly.io, Railway or a VPS — rather than Vercel's serverless runtime.

**Equations use a hand-written OMML walker** rather than Microsoft's
`OMML2MML.xsl`, which would mean committing a proprietary file and pulling in an
XSLT engine plus a MathML converter.
