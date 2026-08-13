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

**Phase 3 — the MVP.** Upload a `.docx` and it comes back as a `doctotex.cls`
and a `main.tex`, editable in the browser, compiled to a PDF shown beside the
code, and downloadable as a zip. Tables, images and equations are not carried
across yet.

The preview is the real artifact: `POST /api/preview` runs pdfLaTeX over the
text currently in the editor and answers with the PDF itself, so what you look
at and what you download come out of the same engine. Editing debounces, and one
compile runs at a time — the container keeps going whatever the browser does, so
a second request mid-compile would buy nothing and cost a container.

Compilation is verified by the test suite against the real engine, not
asserted about: `lib/latex/compile.test.ts` runs pdfLaTeX in the texlive
container and fails on a non-zero exit. It skips where no Docker daemon is
reachable.

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
components/                Dropzone, ArchiveReport, LatexEditor, PreviewPane
lib/
  docx/                    unzip, part reading, XML parsing
  editor/                  Monaco's LaTeX grammar
  extract/                 units, style cascade, page, typography, headings
  omml/                    OMML -> LaTeX walker
  latex/                   .cls and .tex generation, compilation, ZIP assembly
scripts/                   vendor-monaco.mjs
templates/                 doctotex.cls skeleton
fixtures/                  real .docx used by the tests
docker/                    texlive compilation wrapper
```

Tests sit next to the code they cover (`upload.test.ts` beside `upload.ts`).

## Roadmap

| Phase | Scope                                                                     | State     |
| ----- | ------------------------------------------------------------------------- | --------- |
| 0     | Setup, upload, archive inspection                                         | done      |
| 1     | Parse margins, typography, colours, heading hierarchy into `StyleProfile` | done      |
| 2     | Generate `doctotex.cls` + `main.tex`, assemble the ZIP                    | done      |
| 3     | Monaco code preview + server-side PDF rendering                           | done, MVP |
| 4     | Config panel: compiler, bibliography, output shape                        | next      |
| 5     | Tables, images, equations (OMML)                                          |           |
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
