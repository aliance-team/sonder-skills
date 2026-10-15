---
name: pdf-revision
description: Turns a PDF product/revision document (screenshots + numbered annotations) into vision-ready artifacts — full-page renders, every embedded screenshot cropped to its own PNG, and a digest that pairs each note with the visual it describes. Use when asked to read, review, or act on a PDF, especially "revisión"/"observaciones" docs, specs, or any PDF whose layout carries meaning a text dump would lose.
---

# PDF Revision

## When to use this

- A PDF review doc, spec, or "observaciones"/"revisión" sheet (screenshots + numbered notes).
- Any PDF where layout, images, or tables carry meaning a plain `pdftotext` would drop.
- A PDF living on the Windows host — translate `C:\...` → `/mnt/c/...` first (see the `image-access` skill).

Skip it for a trivial text-only PDF: `pdftotext -layout` is enough there.

## Why PyMuPDF and not the browser

A model cannot ingest a PDF directly, so the file must become images/text. Rendering it through
Chrome's built-in PDF viewer over CDP is slow and awkward to scroll/zoom. PyMuPDF handles text
coordinates, page rendering, and per-image extraction in one pass, ~7 ms/page, and — run through
`uv` — installs nothing globally.

## The flow

1. **Locate and translate** the path (Windows → `/mnt/c/...`, quoted; see `image-access`).
2. **Extract** (`uv` fetches PyMuPDF on demand, no global install):
   ```bash
   uv run --with pymupdf python {skill}/scripts/pdf_extract.py "DOC.pdf" -o /tmp/opencode/rev --digest
   ```
3. **Read `digest.md`** — the whole document as ordered notes paired with the visual each one
   annotates. One read instead of page-hopping.
4. **Open only the crops that need pixel truth** (a form, a colour, a chart, an address) with the
   Read tool. The `page-N.png` renders stay as the overview fallback.
5. **Synthesize** the observations into a structured list (item → screen → ask → target code area).

## Output contract

`manifest.json`: `{ source, pages: [{ page, render, width, height, blocks: [{bbox, text}], images: [{file, bbox, w, h}] }] }`
plus `page-N.png` renders and one `pN-imgK-R.png` per placed screenshot when `--digest` is used.

## Quality rules

- Never `cat`/base64 a PDF or infer content from a filename — always go through images.
- Read each cropped screenshot; do not describe one you have not looked at.
- Zoom for fine detail with ImageMagick (kept in `/tmp/opencode`):
  ```bash
  convert page-1.png -crop 300x20+180+62 +repage -resize 900% detail.png   # addresses, tiny text
  ```
- Windowed layout, not a stop sign: numbers like `1./ 2./` are per-screenshot and restart each row.

## Fallbacks

- No `uv`/network → `pip install --user pymupdf`, or `pdftoppm -png -r 150 DOC.pdf out` (poppler-utils)
  for renders only (loses the digest and per-image crops).
- Scanned (image-only) PDF → PyMuPDF still extracts and renders; OCR would need `tesseract`.

## Reference

- [scripts/pdf_extract.py](scripts/pdf_extract.py) — the extractor (renders, per-image crops, manifest, digest).
