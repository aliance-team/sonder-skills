---
name: image-access
description: Locate, translate, and read image files across WSL/Linux and the Windows host — pasted images, screenshots, clipboard grabs, and Windows-style paths such as C:\Users\...\shot.png. Use whenever the user pastes or attaches an image, shares a Windows file path, says "can you see this image", or asks you to look at a screenshot.
license: MIT
compatibility: opencode on WSL2 with the Windows C: drive automounted at /mnt/c
---

# Image Access (WSL ⇄ Windows)

Everything the user pastes in this environment lands on the **Windows host** and reaches you
through the `/mnt/c` automount. Translate the path, then open the file with the `read` tool.

## Golden rule: translate, then read

A Windows path maps to a WSL path under `/mnt/<drive>`:

```
C:\Users\Programador-1\AppData\Local\Temp\shot.png
→ /mnt/c/Users/Programador-1/AppData/Local/Temp/shot.png
```

- Backslashes → forward slashes.
- Drive letter lowercased and prefixed: `C:` → `/mnt/c`, `D:` → `/mnt/d`.
- `wslpath -u 'C:\Users\...'` converts Windows → WSL; `wslpath -w /mnt/c/...` converts back.
- **Quote paths** — usernames here contain spaces (`"SCAEM - Diseño"`).
- Use the `read` tool on the translated path: it renders the image to you directly.
  Never `cat`/base64 an image.

## A just-pasted Wave Terminal file

Wave Terminal drops pasted/uploaded files into a per-session temp directory:

- Windows: `%LOCALAPPDATA%\Temp\waveterm-<pid>\waveterm_paste_<ts>_<rand>.png`
- WSL: `/mnt/c/Users/<user>/AppData/Local/Temp/waveterm-*/waveterm_paste_*.png`

The `waveterm-<pid>` number changes per session — match it with a wildcard, never hardcode it.
Find the newest paste:

```bash
find /mnt/c/Users/*/AppData/Local/Temp/waveterm-* -name 'waveterm_paste_*' \
  -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1
```

Wave Terminal may echo the path with single backslashes (`C:\Users\...`); it is the same file.

## Other common Windows image locations

| Source | WSL path |
|---|---|
| Screenshots (`Win+PrtScn`) | `/mnt/c/Users/<user>/Pictures/Screenshots/` |
| Downloads | `/mnt/c/Users/<user>/Downloads/` |
| Desktop | `/mnt/c/Users/<user>/Desktop/` |

Windows accounts on this host: `Programador`, `Programador-1`, `SCAEM - Diseño`, `Public`.

## Clipboard image (e.g. `Win+Shift+S` snip)

Windows binaries are **not** on `PATH` in this shell, so call PowerShell by **full path**
(`powershell.exe` alone → `command not found`). Escape `$` as `\$` so the shell does not expand it:

```bash
PS=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
"$PS" -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; \
  \$i=[System.Windows.Forms.Clipboard]::GetImage(); \
  if(\$i){ \$i.Save('C:\Users\Programador-1\AppData\Local\Temp\clip.png',[System.Drawing.Imaging.ImageFormat]::Png); 'SAVED' } else { 'NO-IMAGE' }"
```

Then read `/mnt/c/Users/Programador-1/AppData/Local/Temp/clip.png`.
`NO-IMAGE` means the clipboard holds text or nothing — ask the user to copy the image first.

## Shrink before reading big screenshots

Full-screen grabs are ~1 MB and burn context. Downscale to ~1500 px wide first
(ImageMagick 6 uses `convert`, not `magick`), into the approved scratch dir `/tmp/opencode`:

```bash
mkdir -p /tmp/opencode
convert "/mnt/c/.../shot.png" -resize 1500x /tmp/opencode/shot.png
identify /tmp/opencode/shot.png        # confirm dimensions
```

Keep the original if the user needs full detail; read the shrunken copy.

## Moving images between the two worlds

- Windows → WSL: read `/mnt/c/...` **in place**; no copy needed.
- WSL → Windows: `cp ./img.png /mnt/c/Users/<user>/Desktop/`, then give the user the Windows
  form with `wslpath -w /mnt/c/Users/<user>/Desktop/img.png`.
- Sharing a workspace path back to the user: `wslpath -w /home/carlos/...`.

## OCR

`tesseract` is **not installed** here. Either read the image visually or
`sudo apt install tesseract-ocr` first. Never report OCR text you did not actually produce.

## Pitfalls

- zsh aborts on an unmatched glob (`no matches found`). Quote globs or use `find`.
- `/mnt/c` I/O is slow — keep intermediates in `/tmp/opencode`.
- Never infer an image's contents from its filename; open it.
- The clipboard path pattern is the verified one on this host; re-verify before assuming a
  different mount layout on another machine.
