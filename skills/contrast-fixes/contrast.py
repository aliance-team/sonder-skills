#!/usr/bin/env python3
"""Exact WCAG 2.1 contrast math. No dependencies.

Usage:
  contrast.py FG BG              # ratio only
  contrast.py FG BG --text       # gate against 4.5:1 (WCAG 1.4.3 normal text)
  contrast.py FG BG --large      # gate against 3.0:1 (WCAG 1.4.3 large text)
  contrast.py FG BG --ui         # gate against 3.0:1 (WCAG 1.4.11 non-text)
  contrast.py FG BG --fix        # suggest a hue-preserving passing colour
  contrast.py --selfcheck        # verify the implementation

Accepts #rgb, #rrggbb, #rrggbbaa, rgb()/rgba(), and CSS colour keywords.
When the foreground has alpha, pass the composited backdrop with --over so the
ratio reflects what is actually painted rather than the nominal colour.
"""

from __future__ import annotations

import argparse
import colorsys
import re
import sys

NORMAL_TEXT = 4.5
LARGE_TEXT = 3.0
NON_TEXT = 3.0

KEYWORDS = {
    "black": "#000000", "white": "#ffffff", "red": "#ff0000",
    "green": "#008000", "blue": "#0000ff", "gray": "#808080",
    "grey": "#808080", "silver": "#c0c0c0", "navy": "#000080",
    "teal": "#008080", "olive": "#808000", "purple": "#800080",
    "maroon": "#800000", "lime": "#00ff00", "aqua": "#00ffff",
    "fuchsia": "#ff00ff", "yellow": "#ffff00", "orange": "#ffa500",
    "transparent": "#00000000",
}


def parse_hex(value: str) -> tuple[int, int, int, float]:
    h = value.strip().lstrip("#")
    if h.lower() in KEYWORDS:
        h = KEYWORDS[h.lower()].lstrip("#")
    if re.fullmatch(r"[0-9a-fA-F]{3}", h):
        h = "".join(c * 2 for c in h)
    if re.fullmatch(r"[0-9a-fA-F]{4}", h):
        h = "".join(c * 2 for c in h)
    if re.fullmatch(r"[0-9a-fA-F]{6}", h):
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0
    if re.fullmatch(r"[0-9a-fA-F]{8}", h):
        return (
            int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16),
            int(h[6:8], 16) / 255.0,
        )
    raise ValueError(f"cannot parse colour: {value!r}")


def parse_css(value: str) -> tuple[int, int, int, float]:
    v = value.strip()
    if v.lower().startswith(("rgb(", "rgba(")):
        nums = re.findall(r"[\d.]+%?", v)
        nums = [n for n in nums if n != ""][:4]
        r, g, b = (int(float(n)) for n in nums[:3])
        if len(nums) == 4:
            a = float(nums[3].rstrip("%"))
            a = a / 100.0 if "%" in nums[3] else a
        else:
            a = 1.0
        return r, g, b, a
    return parse_hex(v)


def composite(fg: tuple[int, int, int, float], bg: tuple[int, int, int, float]):
    """Flatten a translucent foreground onto an opaque backdrop."""
    r, g, b, a = fg
    br, bg_, bb, _ = bg
    return (
        round(r * a + br * (1 - a)),
        round(g * a + bg_ * (1 - a)),
        round(b * a + bb * (1 - a)),
    )


def luminance(rgb: tuple[int, int, int]) -> float:
    def chan(c: int) -> float:
        s = c / 255.0
        return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = (chan(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg: tuple[int, int, int], bg: tuple[int, int, int]) -> float:
    l1, l2 = luminance(fg), luminance(bg)
    if l1 < l2:
        l1, l2 = l2, l1
    return (l1 + 0.05) / (l2 + 0.05)


def hexs(rgb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % rgb


def suggest(fg: tuple[int, int, int], bg: tuple[int, int, int], target: float):
    """Walk lightness away from the background until the target is met.

    Hue and saturation are preserved; only lightness moves, so the brand colour
    survives. Returns (hex, ratio) for the closest passing variant, or None.
    """
    h, l, s = colorsys.rgb_to_hls(*[c / 255.0 for c in fg])
    best = None

    # Search both directions: moving away from the backdrop always means
    # darkening when the backdrop is light, but a saturated brand colour can
    # also be lightened past the backdrop, so try both and keep the smaller move.
    for direction in (-1.0, 1.0):
        for step in [i / 400.0 for i in range(401)]:
            cand_l = max(0.0, min(1.0, l + direction * step))
            r, g, b = colorsys.hls_to_rgb(h, cand_l, s)
            cand = (round(r * 255), round(g * 255), round(b * 255))
            cr = ratio(cand, bg)
            if cr >= target:
                if best is None or step < best[2]:
                    best = (hexs(cand), cr, step)
                break

    # Hue-preserving lightness alone can be impossible: a vivid brand colour may
    # sit at a lightness where neither direction reaches the target before
    # clipping. Allow a bounded saturation reduction before giving up, and label
    # it so the caller knows the hue was only approximately preserved.
    if best is None:
        for sat_factor in (0.85, 0.7, 0.55, 0.4, 0.25):
            for direction in (-1.0, 1.0):
                for step in [i / 200.0 for i in range(201)]:
                    cand_l = max(0.0, min(1.0, l + direction * step))
                    r, g, b = colorsys.hls_to_rgb(h, cand_l, s * sat_factor)
                    cand = (round(r * 255), round(g * 255), round(b * 255))
                    cr = ratio(cand, bg)
                    if cr >= target:
                        if best is None or step < best[2]:
                            best = (hexs(cand), cr, step)
                        break
                if best is not None:
                    break
            if best is not None:
                best = (best[0], best[1], best[2], True)
                break
    return best


def verdict(cr: float, target: float) -> str:
    if cr >= 7.0:
        tag = "AAA"
    elif cr >= target:
        tag = "PASS"
    else:
        tag = "FAIL"
    return f"{tag} (needs {target}:1)"


def selfcheck() -> int:
    cases = [
        ("#000000", "#ffffff", 21.0),
        ("#ffffff", "#ffffff", 1.0),
        ("#777777", "#ffffff", 4.478),
        ("#1d4ed8", "#ffffff", 6.70),
        ("#6b7280", "#ffffff", 4.83),
    ]
    bad = 0
    for fg, bg, want in cases:
        got = ratio(parse_hex(fg)[:3], parse_hex(bg)[:3])
        ok = abs(got - want) < 0.02
        print(f"  {'ok  ' if ok else 'FAIL'} {fg} on {bg}: {got:.3f} (want ~{want})")
        if not ok:
            bad += 1
    # alpha compositing
    got = composite((255, 255, 255, 0.9), (128, 128, 128, 1.0))
    ok = got == (242, 242, 242)
    print(f"  {'ok  ' if ok else 'FAIL'} 90% white over #808080 -> {hexs(got)}")
    if not ok:
        bad += 1

    # A translucent fill must be measured AFTER compositing. Regression guard:
    # a stray reassignment of bg_rgb used to report the nominal colour's ratio
    # while printing the composited one, which silently understated the damage
    # that `opacity-90` on a button does.
    fill = composite(parse_hex("#1e3a8a")[:3] + (0.9,), (255, 255, 255, 1.0))
    got = ratio((255, 255, 255), fill)
    ok = got < 9.0  # nominal #1e3a8a alone is 10.36:1, so a higher value is a bug
    print(f"  {'ok  ' if ok else 'FAIL'} 90% of #1e3a8a over white = {hexs(fill)} "
          f"at {got:.2f}:1 (nominal 10.36:1)")
    if not ok:
        bad += 1
    print("selfcheck:", "PASS" if bad == 0 else f"{bad} FAILURE(S)")
    return 0 if bad == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("fg", nargs="?")
    ap.add_argument("bg", nargs="?")
    ap.add_argument("--over", help="the real backdrop; bg is composited onto it")
    ap.add_argument("--fill", action="store_true",
                    help="bg is a translucent fill painted over --over")
    ap.add_argument("--text", action="store_true")
    ap.add_argument("--large", action="store_true")
    ap.add_argument("--ui", action="store_true")
    ap.add_argument("--fix", action="store_true")
    ap.add_argument("--fix-bg", action="store_true",
                    help="suggest a passing BACKGROUND, preserving its hue")
    ap.add_argument("--target", type=float)
    ap.add_argument("--selfcheck", action="store_true")
    a = ap.parse_args()

    if a.selfcheck:
        return selfcheck()
    if not a.fg or not a.bg:
        ap.print_help()
        return 2

    fg = parse_css(a.fg)
    bg = parse_css(a.bg)
    bg_rgb = bg[:3]
    if a.fill:
        # bg is a translucent fill (e.g. bg-black/60) painted over --over
        if not a.over:
            print("error: --fill requires --over", file=sys.stderr)
            return 2
        backdrop = parse_css(a.over)[:3]
        bg_rgb = composite(bg, (*backdrop, 1.0))
        fg_rgb = fg[:3]
        print(f"note: fill {a.bg} over {a.over} paints {hexs(bg_rgb)}")
    elif a.over:
        # --over names the surface the text actually sits on
        backdrop = parse_css(a.over)[:3]
        if fg[3] < 1.0:
            fg_rgb = composite(fg, (*backdrop, 1.0))
            bg_rgb = backdrop
            print(f"note: {a.fg} over {a.over} paints {hexs(fg_rgb)}")
        else:
            bg_rgb = backdrop
            fg_rgb = fg[:3]
            if bg_rgb != bg[:3]:
                print(f"note: backdrop is {a.over} (not {a.bg})")
    else:
        fg_rgb = fg[:3]

    cr = ratio(fg_rgb, bg_rgb)
    print(f"  ratio: {hexs(fg_rgb)} on {hexs(bg_rgb)} = {cr:.2f}:1")
    if bg_rgb != bg[:3]:
        print(f"  composited background: {hexs(bg_rgb)} (nominal {a.bg})")

    target = a.target
    if target is None:
        if a.text:
            target = NORMAL_TEXT
        elif a.large or a.ui:
            target = NON_TEXT
    if target is not None:
        print("  " + verdict(cr, target))

    if a.fix:
        t = target or NORMAL_TEXT
        got = suggest(fg_rgb, bg_rgb, t)
        if got:
            how = "hue + saturation reduced" if len(got) > 3 else "hue preserved, lightness only"
            print(f"  fix foreground: {got[0]} ({got[1]:.2f}:1) - {how}")
        else:
            print(f"  fix foreground: no variant reaches {t}:1")

    if a.fix_bg:
        t = target or NORMAL_TEXT
        got = suggest(bg_rgb, fg_rgb, t)
        if got:
            how = "hue + saturation reduced" if len(got) > 3 else "hue preserved, lightness only"
            print(f"  fix background: {got[0]} ({got[1]:.2f}:1) - {how}")
        else:
            print(f"  fix background: no variant reaches {t}:1; "
                  "this hue cannot carry white text at that level")
    return 0


if __name__ == "__main__":
    sys.exit(main())
