#!/usr/bin/env python3
"""Generate the TabBurrow vector logo lockups.

Shapes the wordmark "TabBurrow" with HarfBuzz (real kerning) using the brand's
own Syne-Bold.woff2, extracts each glyph's outline as SVG path data with
fontTools, and composes lockups with the existing burrow-arch mark (copied
verbatim from apps/extension/assets/icon.svg, never redrawn).

Deps (not in the repo's package tree; one-off generator):
    python3 -m venv .venv && .venv/bin/pip install fonttools brotli uharfbuzz
    .venv/bin/python assets/logo/make-logo.py

Outputs (into assets/logo/):
  tabburrow-lockup-dark.svg   cream wordmark, for dark/green grounds
  tabburrow-lockup-light.svg  ink wordmark, for light/paper grounds
  tabburrow-mark.svg          the arch mark alone (square)
  tabburrow-wordmark-dark.svg / tabburrow-wordmark-light.svg  text only
"""
import io
import os
import sys

import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform

REPO = os.path.expanduser("~/Projects/tabburrow")
FONT = os.path.join(REPO, "packages/ui/src/fonts/Syne-Bold.woff2")
OUTDIR = os.path.join(REPO, "assets/logo")
TEXT = "TabBurrow"

CREAM = "#EEE8D9"
INK = "#211D14"
ORANGE = "#F97316"
YELLOW = "#D9A441"

# The mark, verbatim from apps/extension/assets/icon.svg (viewBox 0 0 128 128).
MARK_PATHS = (
    '<path fill-rule="evenodd" clip-rule="evenodd" fill="{orange}" '
    'd="M24,112 L24,64 A40,40 0 0 1 104,64 L104,112 Z '
    'M40,112 L40,80 A24,24 0 0 1 88,80 L88,112 Z"/>'
    '<rect x="12" y="116" width="104" height="10" rx="5" fill="{yellow}"/>'
).format(orange=ORANGE, yellow=YELLOW)

os.makedirs(OUTDIR, exist_ok=True)

# ---- decompress woff2 once, share bytes between harfbuzz + fontTools ----
font = TTFont(FONT)  # fontTools reads woff2 directly (brotli installed)
font.flavor = None   # re-save as plain ttf bytes for harfbuzz
buf_ttf = io.BytesIO()
font.save(buf_ttf)
ttf_bytes = buf_ttf.getvalue()

upem = font["head"].unitsPerEm
glyph_set = font.getGlyphSet()
glyph_order = font.getGlyphOrder()

# ---- shape with harfbuzz (applies GPOS kerning) ----
face = hb.Face(ttf_bytes)
hbfont = hb.Font(face)
buf = hb.Buffer()
buf.add_str(TEXT)
buf.guess_segment_properties()
hb.shape(hbfont, buf, {"kern": True, "liga": True})

# ---- emit one combined path per wordmark (y-flipped into SVG space) ----
def wordmark_path_and_width():
    x_cursor = 0
    y_cursor = 0
    parts = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        gname = glyph_order[info.codepoint]
        pen = SVGPathPen(glyph_set)
        # SVG y grows downward; fonts grow upward. Flip and translate per glyph.
        t = Transform(1, 0, 0, -1, x_cursor + pos.x_offset, y_cursor - pos.y_offset)
        glyph_set[gname].draw(TransformPen(pen, t))
        d = pen.getCommands()
        if d:
            parts.append(d)
        x_cursor += pos.x_advance
        y_cursor += pos.y_advance
    return " ".join(parts), x_cursor

path_d, adv_width = wordmark_path_and_width()

asc = font["hhea"].ascent
desc = font["hhea"].descent  # negative
# Tight-ish vertical box using cap metrics: use OS/2 capHeight when present.
cap = font["OS/2"].sCapHeight if font["OS/2"].version >= 2 and font["OS/2"].sCapHeight else asc

def svg(width, height, inner, label):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:g} {height:g}" '
        f'role="img" aria-label="{label}">\n{inner}\n</svg>\n'
    )

def write(name, content):
    p = os.path.join(OUTDIR, name)
    with open(p, "w") as f:
        f.write(content)
    print(f"wrote {os.path.relpath(p, REPO)} ({os.path.getsize(p)} bytes)")

# ---- wordmark-only files ----
# Box: x 0..adv_width, y 0..(cap + |desc|*0.4 breathing), baseline at y = cap.
pad = upem * 0.06
wm_h = cap + pad * 2
wm_w = adv_width + pad * 2
for suffix, color in (("dark", CREAM), ("light", INK)):
    inner = (
        f'  <g transform="translate({pad:g},{cap + pad:g})">'
        f'<path fill="{color}" d="{path_d}"/></g>'
    )
    write(f"tabburrow-wordmark-{suffix}.svg", svg(wm_w, wm_h, inner, "TabBurrow"))

# ---- mark-only ----
write("tabburrow-mark.svg", svg(128, 128, "  " + MARK_PATHS, "TabBurrow mark"))

# ---- lockups: mark left of wordmark, optically aligned ----
# Scale the 128-box mark to match the wordmark cap height * 1.18 (the arch
# reads slightly larger than caps, like an initial), gap of 0.55 cap.
mark_h = cap * 1.18
mark_scale = mark_h / 128.0
gap = cap * 0.55
lk_pad = upem * 0.08
lk_h = max(mark_h, cap) + lk_pad * 2
baseline_y = lk_pad + cap + (mark_h - cap) / 2  # wordmark baseline, mark vertically centered
mark_y = lk_pad
lk_w = lk_pad * 2 + mark_h + gap + adv_width  # mark box is square (mark_h wide)

for suffix, color in (("dark", CREAM), ("light", INK)):
    inner = (
        f'  <g transform="translate({lk_pad:g},{mark_y:g}) scale({mark_scale:g})">{MARK_PATHS}</g>\n'
        f'  <g transform="translate({lk_pad + mark_h + gap:g},{baseline_y:g})">'
        f'<path fill="{color}" d="{path_d}"/></g>'
    )
    write(f"tabburrow-lockup-{suffix}.svg", svg(lk_w, lk_h, inner, "TabBurrow"))

print("done; caps:", cap, "advance:", adv_width, "upem:", upem)
