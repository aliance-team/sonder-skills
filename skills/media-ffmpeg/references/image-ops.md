---
name: ffmpeg-image-ops
description: Convert, resize, optimise and batch-process raster images with ffmpeg (png, jpg, webp, avif, gif) - format conversion, WebP/AVIF generation, thumbnails, alpha-safe encoding, size/quality targeting, animated frames, and verifying the output. Use this whenever an image must be produced, converted, shrunk or checked, and reach for it BEFORE Pillow. Also covers when Pillow is genuinely the faster tool.
license: MIT
compatibility: opencode
---

# ffmpeg image ops

`ffmpeg` is the default tool for every image **conversion, scaling, encoding and quality**
job. It is one process with no import overhead, keeps alpha when asked to, and the same
flags cover a single still, a batch, and animated frames.

**Rule: do not reach for Pillow first.** Pillow is a fallback for pixel-level work only —
see [When Pillow wins](#when-pillow-wins) at the bottom. If you are about to write
`Image.open(...).save(...)`, write an `ffmpeg` command instead.

- Add `-y` to overwrite, `-hide_banner -loglevel error` to keep output clean, and
  `-nostdin` inside loops.
- `-f avif` (the muxer) must be the **last** argument before the output path.

## 1. Inspect before you convert

```bash
# dimensions, codec, pixel format, frame count — pix_fmt containing "a" means alpha
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt,nb_frames -of csv=p=0 in.png
#  → png,400,400,ya8        (has alpha)
#  → webp,400,400,yuva420p   (has alpha)
#  → av1,1800,727,yuv444p    (no alpha)
#  → webp,400,400,argb       (has alpha, lossless)

du -h in.png                     # bytes matter: report before/after for every conversion
identify -format "%[channels] %wx%h %B bytes\n" in.png   # cross-check (ImageMagick)
```

Nail down two things first: **does it have alpha**, and **what are the dimensions**. Both
decide the command.

## 2. Recipes (all verified)

```bash
# PNG → WebP, lossy
ffmpeg -hide_banner -loglevel error -y -i in.png -c:v libwebp -quality 85 -compression_level 6 out.webp

# PNG → WebP, lossless  (FLAT / LINE ART ONLY — often smaller than lossy)
ffmpeg -hide_banner -loglevel error -y -i in.png -c:v libwebp -lossless 1 out.webp

# JPG/PNG → AVIF, still image  (NO alpha — see §4)
ffmpeg -hide_banner -loglevel error -y -i in.jpg -c:v libaom-av1 \
  -still-picture 1 -crf 30 -cpu-used 4 -f avif out.avif

# PNG → JPG (flatten: JPG cannot carry alpha)
ffmpeg -hide_banner -loglevel error -y -i in.png -vf format=rgb24 -q:v 3 out.jpg

# Resize to an exact width, keep ratio
ffmpeg -hide_banner -loglevel error -y -i in.png -vf "scale=800:-1" -c:v libwebp -quality 90 out.webp

# Downscale cap (never upscale), even height for 4:2:0 codecs
ffmpeg -hide_banner -loglevel error -y -i in.png \
  -vf "scale='min(1920,iw)':-2:flags=lanczos" -c:v libwebp -quality 85 out.webp

# Crop w:h:x:y
ffmpeg -hide_banner -loglevel error -y -i in.png -vf "crop=85:85:33:35" -c:v libwebp -lossless 1 out.webp

# Animated GIF → animated WebP
ffmpeg -hide_banner -loglevel error -y -i anim.gif -c:v libwebp_anim -loop 0 -quality 80 anim.webp

# Batch: same treatment for a whole directory
for f in assets/**/*.png; do
  [ -f "$f" ] || continue
  ffmpeg -nostdin -hide_banner -loglevel error -y -i "$f" \
    -c:v libwebp -quality 85 -compression_level 6 "${f%.png}.webp"
done
```

`-1` keeps the aspect ratio but may land on an odd size; use `-2` when the codec is 4:2:0
(webp/jpg/avif). `-1` is fine for a lossless WebP or PNG.

## 3. Quality cheat sheet

| Source | Format | Start at |
|---|---|---|
| flat art, icons, screenshots, line art | webp `-lossless 1` | lossless — usually **smaller** than lossy |
| photos | webp `-quality 80`–`85` | climb to `-quality 92` only if banding shows |
| photos | avif `-crf 28`–`32` (`-cpu-used 4`) | ~2–3× smaller than webp at equal look |
| any | jpg `-q:v 2`–`4` | legacy/universal fallback only |

Measured example (400×400 line art, transparent): png 13,776 B → webp lossless **7,330 B**
→ webp q85 8,120 B. Lossless won *and* was pixel-identical — always try lossless first on
flat art.

`-cpu-used` is the speed/quality dial for AVIF: `4` is a good default, `8` is fastest and
worst, `0` is slowest and best. AVIF without `-still-picture 1` is not a still image.

## 4. Alpha is the trap — verify, always

AVIF written by this toolchain **silently drops the alpha channel** (both the ffmpeg `avif`
muxer and ImageMagick 6/libheif 1.15 write an opaque `ycbcr` stream, and this Pillow has no
AVIF support at all). So:

- **Transparent source → WebP** (or PNG). Never AVIF.
- **Opaque source → AVIF + WebP**, with the original as the final fallback.
- Pillow is **not** a way around this — it cannot write AVIF here.

Every conversion ends with a check; an encoder that dropped alpha is a bug, not a detail:

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 out.webp
# expect a pix_fmt containing "a" (yuva420p, argb, rgba, ya8). No "a" → alpha was lost.

identify -format "%[channels] %B bytes\n" out.webp     # srgba/graya == alpha intact
convert out.webp -format "%[fx:mean.a]\n" info:        # must be a number, not -nan
compare -metric RMSE in.png out.webp null:             # lossless: expect "0 (0)"
```

`-nan` from `fx:mean.a` means “this image has no alpha channel”.

## 5. Serving the result

Keep the original in the `<img src>` and list modern formats as `<source>` above it:

```html
<picture>
  <source srcset="logo.webp" type="image/webp">
  <img src="logo.png" alt="">
</picture>
```

Then confirm in the browser's network panel that **exactly one** candidate was fetched. A
stale or invalid `<source>` sends the browser back to the `<img>` and you download both
files — the optimisation can end up *slower* than the plain original.

## 6. Pitfalls

- `scale=w:-1` → odd dimensions; use `-2` for webp/jpg/avif.
- Photographs keep EXIF orientation; if a resized photo comes out rotated, add
  `-vf "scale=...,transpose=..."` or strip/normalise metadata with `-map_metadata -1`.
- ffmpeg re-encodes by default — never chain two lossy steps (jpg → webp → webp); go back
  to the original source each time.
- `-f avif` last; `-lossless 1` is a *libwebp* option and is ignored by other encoders.
- AVIF is slow: `-cpu-used 4` on a 4000 px photo still takes seconds. Batch it in the
  background and report when it finishes.

## When Pillow wins

Use Pillow (and say why in one line) when the job is **pixel logic, not encoding**:

| Task | Tool |
|---|---|
| convert / resize / crop / thumbnail / encode | **ffmpeg** |
| animated frames → webp | **ffmpeg** (`libwebp_anim`) |
| per-pixel maths, masks, channel algebra, numpy work | Pillow |
| palette / indexed-colour manipulation, `mode` surgery | Pillow |
| reading pixel values to assert a result in a test | Pillow |
| drawing text/shapes, programmatic generation (gradients, labels) | Pillow |
| EXIF read/write, multi-page TIFF, exotic formats | Pillow |
| AVIF encode — including alpha | **ffmpeg** (Pillow 9.4 here has no AVIF) |

```bash
python3 -c "
from PIL import Image
im = Image.open('in.png'); print(im.mode, im.size)
px = im.convert('RGBA').getpixel((0, 0)); print(px)
"
```

If you catch yourself using Pillow for a plain format conversion, you picked the wrong tool:
the `ffmpeg` one-liner in §2 is shorter, keeps alpha predictably, and needs no interpreter
startup.
