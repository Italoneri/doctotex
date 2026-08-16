# Fixtures

Real `.docx` files the test suite runs against. Style extraction is only
meaningful against documents Word and Google Docs actually produce; synthetic
fixtures miss the quirks that break parsers.

**The documents themselves are gitignored** — `*.docx` never enters the repo, so
source documents stay on the machine that owns them. Only this README and
`fixture.ts` are tracked.

The consequence is that a fresh checkout has no fixtures. Tests that need one
gate on `hasFixture` and skip:

```ts
import { hasFixture, readFixture } from "@/fixtures/fixture";

const FIXTURE = "exemplo.docx";
const describeFixture = describe.skipIf(!hasFixture(FIXTURE));
```

Without a fixture the suite reports skips rather than failures, because a
missing file says nothing about whether the code is correct. It also means green
does not imply covered — check the skip count.

What follows documents fixtures used during development, so their findings
survive even when the files do not.

## `exemplo.docx`

A French-locale Word document, A4 portrait, 24 parts.

| Aspect    | Value                                                               |
| --------- | ------------------------------------------------------------------- |
| Page      | 11906 x 16838 twips (210 x 297 mm)                                  |
| Sections  | 2 — see below                                                       |
| Margins   | body-level section: 1418 twips all round, header/footer 720         |
| Styles    | 22, of which 3 are headings                                         |
| Content   | 50 paragraphs, 1 table, 1 drawing                                   |
| Parts     | styles, theme, settings, numbering, header1, footer1, 3 media files |
| Theme     | major Cambria, minor Calibri                                        |
| Body font | Times New Roman from `docDefaults`; no size declared anywhere       |

### What it taught us

**Style IDs are localised; style names are not.** This document declares
`Titre1`, `Titre3` and `Titre4`, whose `<w:name w:val="...">` are `heading 1`,
`heading 3` and `heading 4`. A parser keyed on `w:styleId="Heading1"` finds
nothing here. **Always match on `w:name`.**

**Heading levels are not contiguous.** This document jumps 1 -> 3 -> 4 with no
level 2. The extractor must carry a sparse set of levels, not an array indexed
from 1.

**`Titre` ("Title") is not a heading level.** It is Word's document-title style
and needs its own mapping, separate from `heading N`.

**A document can carry more than one `sectPr`, and only one of them is the
document's.** This file has two: an opening section with a 30mm top margin,
declared inside the paragraph that ends it and covering 15 paragraphs, and the
body-level one with 25mm margins covering the other 35. Only the body-level
`sectPr` is a direct child of `w:body`; the earlier ones nest inside
`w:p/w:pPr`. Reading the first match in the file gets the wrong geometry.

**None of its 50 paragraphs reference a style.** `Titre1`, `Titre3` and `Titre4`
are declared in `styles.xml` and then never applied: every heading in the body
is a normal paragraph that was manually bolded and capitalised. The generated
template therefore has no sections, which is faithful but structureless. Real
documents do this constantly, and it is the reason a converter cannot rely on
`w:pStyle` alone to recover structure.

**Heading sizes are not monotonic.** `heading 4` is 14pt while `heading 3` is
13pt. The extractor reports what the document says rather than tidying it.

**Equations here are legacy OLE, not OMML.** There are zero `<m:oMath>`
elements; instead one `<w:object>` wrapping an `<o:OLEObject>` — a Microsoft
Equation 3.0 object with a `.wmf` fallback in `word/media/image3.wmf`. The
phase-5 OMML walker will not see it. Recovering LaTeX from the OLE binary is out
of scope; the realistic fallback is embedding the `.wmf` as an image.

## `curriculo-estagio.docx`

A Portuguese-locale one-page CV exported from Google Docs. A4, no `w:pStyle`
anywhere, everything formatted directly.

### What it taught us

**Direct formatting is the normal case, not the exception.** Not one of its
paragraphs references a style, yet it centres, colours, sizes and spaces almost
every one of them through its own `w:pPr` and `w:rPr`. A converter that reads
only the stylesheet reproduces none of it. This is the document the direct
formatting cascade was built against.

**Google Docs writes `w:ptab`, not `w:tab`.** Its right-aligned dates use
`<w:ptab w:alignment="right" w:relativeTo="margin" w:leader="none"/>`, an
absolute position tab that carries its own alignment and needs no `w:tabs`
lookup at all. `w:relativeTo="margin"` with `w:alignment="right"` is exactly
`\hfill`. A tab-stop implementation that reads only `w:tabs` and
`w:defaultTabStop` will not see this document's tabs.

**Its rules are bottom borders on the heading paragraph.** Each section title
carries `<w:pBdr><w:bottom w:val="single" w:color="1F3A5F" w:sz="8"
w:space="2"/></w:pBdr>`. Note `w:sz="8"` is **eighths of a point** — 1pt — not
the half-points `w:sz` means inside `w:rPr`. The same attribute name means two
different units depending on where it sits.

**It sets `w:hAnsi` beside `w:ascii` on every run**, and other Google Docs
exports set only `w:hAnsi`, so reading `w:ascii` alone reports no font.

## Gaps

No fixture covers these yet, so the matching phase cannot be fully verified:

- **modern OMML equations** (`<m:oMath>`), inline and display — blocks phase 5
- **a full heading hierarchy** with contiguous H1-H4 — the acceptance criterion
  "the original heading hierarchy is reflected in the PDF" leans on this
- **landscape orientation** (`<w:orient w:val="landscape"/>`)
- **a Google Docs export**, whose `styles.xml` differs from Word's
- **an English-locale document**, to confirm the `w:name` lookup works both ways

## Adding one

Drop the file here and reference it from a test by URL relative to the module:

```ts
const FIXTURE = new URL("../../fixtures/my-document.docx", import.meta.url);
```

Keep them small; these are read on every test run. Nothing confidential — the
folder is committed.
