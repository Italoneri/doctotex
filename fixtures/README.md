# Fixtures

Real `.docx` files the test suite runs against. They are committed on purpose:
style extraction is only meaningful against documents Word and Google Docs
actually produce, and synthetic fixtures miss the quirks that break parsers —
inherited `w:basedOn` chains, `w:docDefaults`, theme font references and
numbering definitions.

| File | Covers |
| --- | --- |
| `exemplo.docx` | baseline document with `word/styles.xml` |

## Adding one

Drop the file here and reference it from a test by URL relative to the module:

```ts
const FIXTURE = new URL("../../fixtures/my-document.docx", import.meta.url);
```

Useful gaps to fill:

- deep heading hierarchy (H1 through H4)
- a table plus an embedded image
- OMML equations, both inline and display
- landscape orientation, or margins that are not the Word default
- a Google Docs export, whose `styles.xml` differs from Word's

Keep them small; these are read on every test run.

Do not put anything confidential here — the folder is committed to the repo.
