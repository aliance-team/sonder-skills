---
name: media-asset-fetch
description: Download a missing image/asset from the live site into the repo at the same relative path. Use when a template, CSS, or HTML snippet references an asset that 404s or is absent locally ("download this image", "this asset is not found", "the second image is missing", a pasted snippet with a broken <img src>). Handles versioned URLs (?v=...), leading/relative paths, and verifies the download instead of trusting curl.
---

# Production asset fetch

The live site is the source of truth for artwork that is missing from the repo.
One asset = one `curl` to the identical relative path. No markup edits, no
renames, no refactors, no commit unless asked.

## Procedure

1. **Extract the path** from the snippet or the user's words:
   - `/assets/images/...` → strip the leading `/`
   - `assets/images/...` (relative) → use as-is
   - strip the `?v=...` cache-buster
   - keep the extension (`.png`, `.avif`, `.svg`, `.webp`, `.jpg`)

2. **Check what exists locally first** — the file may be present under a
   neighbouring name, in which case you still need the exact referenced name:

   ```bash
   ls -l assets/images/fmd/empresas/insulmed/ | head
   ```

3. **Probe production** with a HEAD-style check before downloading, so a 404
   does not become a saved HTML error page:

   ```bash
   curl -sS -o /dev/null -w "%{http_code} %{content_type} %{size_download}\n" \
     "https://zur.dataemergencia.com/<path>"
   ```

   Expect `200` plus an image content type. `404` with `text/html` means the
   name is wrong on production, not that the file is unavailable.

4. **Download to the same relative path**, creating parent dirs if needed:

   ```bash
   curl -sSfL -o "<path>" "https://zur.dataemergencia.com/<path>"
   ```

5. **Verify** — never report success from curl's exit code alone:

   ```bash
   ls -l "<path>"
   file "<path>"
   tail -c 1 "<path>" | od -c   # no trailing HTML
   ```

   `file` must say PNG / AVIF / SVG / JPEG, not HTML.

6. **Report** a one-line table: local path → source URL, plus size and type.

## Known source

| Site | Base URL |
|---|---|
| ZUR / SCAEM FMD | `https://zur.dataemergencia.com` |

## Gotchas seen in this repo

- `versionedAsset()` / `?v=<epoch>` cache-busters are not part of the filename.
- Templates sometimes use `sitePrivateConfig() . 'assets/images/...'` and
  sometimes a bare `/assets/images/...`; both resolve to the same repo path.
- Code may reference a name that production does not have, while production
  serves the unscoped original. Example: the templates ask for
  `scaem-red-apoyo-boton-a.png` / `-b.png`, but production only serves
  `scaem-red-apoyo-boton.png`. Download the existing file and copy it to each
  referenced name (the `-a`/`-b` A/B switch is documented as a no-op today).
- Sponsored SVGs (`boton-ambulancia.svg`, `boton-ruta-web-2.svg`) are
  white-on-transparent; the orange plate is CSS. Do not "fix" the asset.
- The assets directory returns `403` on directory listing — probe exact names
  only, do not try to browse it.

## Do not

- Do not edit the template, CSS, or layout to accommodate a missing asset.
- Do not rewrite paths or rename downloaded files.
- Do not run the dev server or a browser to "verify"; `file` plus size is enough.
- Do not commit.
