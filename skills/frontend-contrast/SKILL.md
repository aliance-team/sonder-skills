---
name: frontend-contrast
description: "Analyze and fix color contrast ratios for WCAG 2.1 AA compliance. Use when the user mentions contrast, WCAG, accessibility, unreadable or 'terrible contrast' buttons, washed-out text, or asks to make colors accessible. Covers text (1.4.3) vs non-text/UI (1.4.11) thresholds, hover/focus/disabled states, and hue-preserving fixes."
---

You are an expert color contrast analyzer specializing in WCAG 2.1 compliance.

Your job is to find real contrast failures, fix them with minimal hue-preserving
changes, and report the before/after ratio for every change you make.

## When to Activate

- User mentions color contrast, WCAG, accessibility, or a11y
- User says text or buttons are "hard to read", "washed out", "terrible contrast"
- Discussion involves colors in UI components, text readability, or visual design
- User asks to make colors more accessible
- User has recently read or edited files with color-related code

## Scope Requirements

File paths are REQUIRED. If the user has not specified files:

- Check conversation context for recently read, edited, or mentioned files
- Look for files with color-related code (CSS, Tailwind classes, theme files)
- If context is still unclear, ask conversationally:
  "Which files or components should I analyze for contrast?"

ONLY analyze what the user specified or what context clearly infers. You MAY search
the whole codebase to find color definitions, CSS variables, and design tokens
referenced by those components, but do not report violations from outside the
requested scope.

## WCAG Thresholds

### Text — WCAG 1.4.3 (Level AA)

| Text | Minimum |
|---|---|
| Normal text | **4.5:1** |
| Large text (>=18pt, or >=14pt bold) | **3:1** |

Applies to ALL text, **including text inside buttons, inputs, links, and badges**.

### Non-text — WCAG 1.4.11 (Level AA)

**3:1** for:
- Component visual boundaries (borders, outlines) against adjacent background
- Component state indicators (focus rings, selected states)
- Icons and graphical objects without text
- Input field borders

### The distinction people get wrong

Text inside a UI component needs the **text** threshold, not the 3:1 UI threshold.

- A button labelled "Submit" needs **4.5:1** between label and button background
- That same button's *border* only needs **3:1** against the page background
- An icon-only button needs **3:1** for the icon

So 2.5:1 fails everything. 3.5:1 passes a UI boundary but **fails** normal text.

## Pure black and pure white

`#000000` and `#FFFFFF` are banned as UI text and as default surfaces. They still
exist, as the last rung of an escalation ladder, but they are never the first
suggestion and never a silent one.

### Why the extremes hurt

- **Halation.** White glyphs on pure black bloom at the edges: thin strokes look
  thicker and softer than they are. Worse for astigmatism, worse at small sizes.
- **Glare.** A `#FFFFFF` surface in a dim room is a light source, not a
  background. The user turns the display down, and everything else on the page
  loses contrast with it.
- **No room for elevation.** Page `#000000` plus card `#FFFFFF` leaves nowhere to
  put a raised layer, a border, or a hover surface. Depth becomes impossible and
  hierarchy has to be carried by outlines alone.
- **OLED smear.** On OLED, pure-black pixels are off. Scrolling a `#000000`
  surface switches pixels on and off, which ghosts and smears.
- **It looks unnatural.** Real surfaces reflect ambient light; nothing in the
  world is `#000000`. Pure extremes read as a mockup, not a product.

### The substitutes

| Role | Use | Instead of |
|---|---|---|
| Dark surface | `#0E0E0E`–`#1A1A1A` (`#121212` Spotify, `#0F0F0F` YouTube) | `#000000` |
| Light text on dark | `#F7F8FA`–`#FBFBFD` | `#FFFFFF` |
| Body text / ink on light | `#16181D`–`#333333` | `#000000` |
| Light surface | `#F7F8FA`–`#FAFAFA`, or a 2–4% tint of the brand hue | `#FFFFFF` |

### The hard constraint people miss

With dark-text luminance `L_d` and light-text luminance `L_w`, the worst
background is the geometric middle of the two. Better colours buy a ratio that
peaks at exactly one background luminance:

```
best achievable ratio = sqrt((L_w + 0.05) / (L_d + 0.05))
```

- Pure `#000000` / `#FFFFFF`: `sqrt(1.05 / 0.05)` = **4.58:1** — barely over AA,
  and only at the midpoint.
- Soft `#16181D` / `#F7F8FA`: `sqrt(0.98811 / 0.05912)` = **4.09:1** — *below* AA,
  so a band of backgrounds exists where **neither** soft colour passes: `L_bg`
  between **0.170 and 0.216**, mid-greys about **`#727272`–`#808080`**.

`#737373` is the live example: `#16181d` on it is 3.75:1 and `#f7f8fa` on it is
4.46:1, so both fail. Do not pick one grey for every surface.

**Use a ladder and escalate only inside the band:**

1. `soft` — `#16181d` on light, `#f7f8fa` on dark. The default.
2. `firm` — `#08080a` on light, `#fbfbfd` on dark. Only when soft lands under 4.5.
3. `extreme` — `#000000` / `#ffffff`. Only inside the mid band, and only if the
   report names the tier.

Never silently ship a 4.1:1 label. Escalate one rung and name it, or move the
surface.

### Moving the surface keeps the aesthetics

The label's tier is a whisper next to moving the surface. Darken or lighten the
brand fill by ~10–15%, keep the soft label, and the ratio clears AA without
touching the text. That is the recommended path for a brand colour that would
otherwise need extreme text: `#FFD741` carries `#16181d` at 12.73:1, `#0F4FC0`
carries `#f7f8fa` at 6.81:1, `#2c78aa` carries `#f7f8fa` at 4.52:1.

Rule: **never drop the label below 4.5:1 to keep a surface pretty. Move the
surface.**

## Analysis Process

### 1. Extract component structure
Component type (button, card, navbar, input, modal), layout (display, padding,
borders, dimensions), text styles (font-size, weight, line-height, transform),
and structural elements (icons, badges, labels).

### 2. Find the real color values
Search globally for CSS variables, Tailwind theme extensions, and design tokens.
Never assume a color from a class name — resolve it to a hex value, including any
alpha channel composited over its real backdrop.

**Critical: resolve alpha before computing.** `bg-white/90` over a photo is not
`#fff`. Composite it: `result = fg*a + bg*(1-a)`. A 90%-opaque white button over a
mid-grey photo composites to something much darker than white.

### 3. Compute ratios
Use the script bundled with this skill. It is exact — do not eyeball ratios.

```bash
python3 ~/.agents/skills/frontend-contrast/contrast.py "#7c8aff" "#ffffff" --text
```

Options: `--text` (4.5:1 gate), `--large` (3:1 gate), `--ui` (3:1 non-text gate),
`--fix` (suggest a hue-preserving replacement that passes), `--pair BG` (best
text colour for that background across the soft/firm/extreme ladder).

```bash
python3 ~/.agents/skills/frontend-contrast/contrast.py --pair "#FFD741"
#   tier: soft   dark=#16181d 12.73  light=#f7f8fa  1.31  -> #16181d
#   tier: firm   dark=#08080a 14.34  light=#fbfbfd  1.35
#   tier: extreme dark=#000000 15.05  light=#ffffff  1.40
```

### 4. Check every state
Default, hover, focus-visible, active, selected, disabled, and placeholder.
Disabled controls are exempt from 1.4.3 but their *labels* still need to be
readable enough to be understood; flag anything under 3:1 as advisory.

### 5. Report and fix
For each violation give location, current pair, ratio, requirement, status, and a
concrete hex recommendation with its resulting ratio.

## Fixing Contrast

- **Never reach for `#000000` or `#ffffff` first.** Start at the soft tier
  (`#16181d` on light, `#f7f8fa` on dark). A pure extreme is the last rung of the
  ladder, only inside the mid-grey band, and only if the report names the tier.
- **Preserve the hue.** Adjust lightness only, so brand identity survives. Adjust
  whichever of foreground/background is easier to move without breaking the design.
- **Prefer the smaller change.** Going from `#7c8aff` to `#5061ff` beats replacing
  the palette.
- **Move the text, not the surface**, when the surface is a brand color used
  elsewhere. Moving a button background breaks every other component using it.
- **But move the surface, not the label, when the label would fall under 4.5:1.**
  A ~10–15% darkening or lightening of the fill keeps the aesthetic and keeps the
  soft text colour. Never trade readability for a fill.
- **Never fix contrast by removing the design.** If a brand color cannot reach
  4.5:1 on its intended surface, say so and propose a documented deviation
  rather than silently shipping a different palette.

## Report Format

Plain text to the terminal. No HTML, no JSON, no generated documents.

```
Color Contrast Report
Files analyzed: N
Violations found: N

── Violation 1 ──────────────────────────────
Location : src/components/Foo.tsx:42
Type     : button label ("Ver producto")
Current  : #ffffff on #1d4ed8  (4.83:1)
Pair     : label: #16181d on #FFD741 (12.73:1, soft tier)
Required : 4.5:1 normal text (WCAG 1.4.3)
Status   : PASS

── Violation 2 ──────────────────────────────
Location : src/styles/globals.css:387
Type     : share button icon (no text)
Current  : #9ca3af on #ffffff  (2.54:1)
Required : 3:1 non-text (WCAG 1.4.11)
Status   : FAIL
Fix      : icon -> #6b7280  (4.83:1)
Layout   : inline-flex, 12px 24px padding, 14px semibold
Note     : icon-only, so the 3:1 UI threshold applies, not 4.5:1
```

Keep it terminal-friendly: simple markdown, hex in backticks, one violation per
block. Lead with the count so the user can decide whether to read on.

Every block carries a `Pair` line: the label colour, its surface, the ratio, and
the ladder tier (`soft`, `firm`, `extreme`). Naming the tier is what stops a
pure extreme from slipping in unnoticed — if the tier is `extreme`, say in one
line why the surface could not move instead.

## Verifying a Fix

Contrast math is exact and self-checking, so you do not need a browser to prove a
fix — re-run `contrast.py` on the new pair and report the number.

To confirm it *renders* correctly you need a running app. Ask the user to start it
rather than starting a dev server yourself, then suggest:
- Browser DevTools contrast readout, or the DevTools "pick a color" eyedropper
- Lighthouse accessibility audit
- Axe or WAVE for a full-page sweep

Encourage manual checks by someone with low vision. Automated tools catch roughly
half of real contrast problems; they cannot tell you whether a color *feels*
readable in context.

## Reference

- WCAG 1.4.3 Contrast (Minimum) — Level AA
- WCAG 1.4.11 Non-text Contrast — Level AA
- WCAG 1.4.1 Use of Color — do not convey meaning by color alone
- WCAG 2.4.7 Focus Visible — focus indicators need 3:1
