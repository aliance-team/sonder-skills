#!/usr/bin/env python3
"""Extract a PDF into revision-ready, vision-friendly artifacts.

Given a PDF (typically a product revision doc made of "screenshot | annotation"
rows), emit into an output directory:

  page-N.png        full-page render at the requested DPI
  pN-imgK-R.png     each embedded screenshot, cropped to its placed rectangle
  manifest.json     machine-readable: per page, text blocks (with bbox) + images
  digest.md         human/agent-readable pairing of right-column annotations
                    with the left-column visual they describe (--digest)

Run on demand without polluting any environment:

  uv run --with pymupdf python pdf_extract.py DOC.pdf -o out --digest

Exit code 0 on success. Prints a one-line JSON summary.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import pymupdf  # PyMuPDF


def _text_blocks(page: "pymupdf.Page") -> list[dict]:
    """Return non-empty text blocks as {bbox, text} with rounded coordinates."""
    blocks: list[dict] = []
    for x0, y0, x1, y1, text, *_ in page.get_text("blocks"):
        text = text.strip()
        if not text:
            continue
        blocks.append(
            {"bbox": [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)], "text": text}
        )
    return blocks


def _page_images(
    page: "pymupdf.Page", page_no: int, dpi: int, out_dir: str, min_px: int
) -> list[dict]:
    """Render every placed raster image to its own PNG cropped to its rect."""
    images: list[dict] = []
    for idx, info in enumerate(page.get_images(full=True), 1):
        xref = info[0]
        try:
            rects = page.get_image_rects(xref)
        except Exception:
            rects = []
        for ri, rect in enumerate(rects, 1):
            if rect.width < 8 or rect.height < 8:
                continue
            pix = page.get_pixmap(dpi=dpi, clip=rect)
            if pix.width < min_px or pix.height < min_px:
                continue
            name = f"p{page_no}-img{idx}-{ri}.png"
            pix.save(os.path.join(out_dir, name))
            images.append(
                {
                    "file": name,
                    "bbox": [round(rect.x0, 1), round(rect.y0, 1), round(rect.x1, 1), round(rect.y1, 1)],
                    "w": pix.width,
                    "h": pix.height,
                }
            )
    return images


def _y_overlap(a: list[float], b: list[float]) -> float:
    return max(0.0, min(a[3], b[3]) - max(a[1], b[1]))


def _build_digest(source: str, pages: list[dict], page_width: float) -> str:
    """Pair right-half annotation text with left-half images by vertical overlap.

    Mirrors the common "screenshot on the left, numbered notes on the right"
    review-doc layout into ordered, readable markdown.
    """
    lines: list[str] = [f"# Digest — {os.path.basename(source)}", ""]
    for p in pages:
        lines.append(f"## Page {p['page']}")
        lines.append(f"![page {p['page']}]({p['render']})")
        lines.append("")
        half = page_width / 2
        left = [b for b in p["blocks"] if b["bbox"][2] <= half * 1.08]
        right = [b for b in p["blocks"] if b["bbox"][0] >= half * 0.92]
        # Each left image anchors a section; greedy-match the right notes it overlaps.
        for img in p["images"]:
            if img["bbox"][0] > half:
                continue
            lines.append(f"### Visual `{img['file']}` ({img['w']}x{img['h']})")
            lines.append(f"![{img['file']}]({img['file']})")
            matched = [b for b in right if _y_overlap(b["bbox"], img["bbox"]) > 0]
            for b in sorted(matched, key=lambda x: x["bbox"][1]):
                lines.append(f"- {b['text']}")
            lines.append("")
        # Left-column text blocks that are not image captions (titles, etc.).
        for b in sorted(left, key=lambda x: x["bbox"][1]):
            lines.append(f"> {b['text']}")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf", help="path to the source PDF")
    ap.add_argument("-o", "--out", required=True, help="output directory")
    ap.add_argument("-d", "--dpi", type=int, default=160, help="render DPI (default 160)")
    ap.add_argument("--min-image", type=int, default=64, help="drop cropped images smaller than N px (default 64)")
    ap.add_argument("--digest", action="store_true", help="also write digest.md pairing visuals with notes")
    args = ap.parse_args()

    if not os.path.isfile(args.pdf):
        print(json.dumps({"error": f"not a file: {args.pdf}"}))
        return 2

    os.makedirs(args.out, exist_ok=True)
    doc = pymupdf.open(args.pdf)
    pages: list[dict] = []
    for page_no, page in enumerate(doc, 1):
        render = f"page-{page_no}.png"
        page.get_pixmap(dpi=args.dpi).save(os.path.join(args.out, render))
        pages.append(
            {
                "page": page_no,
                "render": render,
                "width": round(page.rect.width, 1),
                "height": round(page.rect.height, 1),
                "blocks": _text_blocks(page),
                "images": _page_images(page, page_no, args.dpi, args.out, args.min_image),
            }
        )

    manifest = {"source": os.path.abspath(args.pdf), "pages": pages}
    with open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)

    if args.digest and pages:
        with open(os.path.join(args.out, "digest.md"), "w", encoding="utf-8") as fh:
            fh.write(_build_digest(args.pdf, pages, pages[0]["width"]))

    print(
        json.dumps(
            {
                "out": os.path.abspath(args.out),
                "pages": len(pages),
                "images": sum(len(p["images"]) for p in pages),
                "digest": bool(args.digest),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
