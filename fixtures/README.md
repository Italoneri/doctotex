# Fixtures

Real `.docx` files the test suite runs against. They are committed on purpose:
style extraction is only meaningful against documents Word and Google Docs
actually produce, and synthetic fixtures miss the quirks that break parsers.

## `exemplo.docx`

A French-locale Word document, A4 portrait, 24 parts.

| Aspect | Value |
| --- | --- |
| Page | 11906 x 16838 twips (210 x 297 mm) |
| Margins | top 1701, right/bottom/left 1418, header 567, footer 709 twips |
| Styles | 22, of which 3 are headings |
| Content | 50 paragraphs, 1 table, 1 drawing |
| Parts | styles, theme, settings, numbering, header1, footer1, 3 media files |

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

**Equations here are legacy OLE, not OMML.** There are zero `<m:oMath>`
elements; instead one `<w:object>` wrapping an `<o:OLEObject>` — a Microsoft
Equation 3.0 object with a `.wmf` fallback in `word/media/image3.wmf`. The
phase-5 OMML walker will not see it. Recovering LaTeX from the OLE binary is out
of scope; the realistic fallback is embedding the `.wmf` as an image.

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
