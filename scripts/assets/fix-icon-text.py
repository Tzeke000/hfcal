#!/usr/bin/env python3
"""One-time artwork fix: correct "ANTENA" -> "ANTENNA" on the app icon.

The bottom caption of the original icon artwork read "HF FIELD EXPEDIENT
ANTENA" (one N short). This repaints that caption band with the surrounding
background and redraws the corrected text, condensed to occupy the same
width so the icon's proportions are unchanged.

Operates on scripts/icon-source.png (the pristine, badge-free master).
Re-run scripts/generate-icons.py afterwards to rebuild all icon sizes.

Usage: python3 scripts/fix-icon-text.py   (run from the repo root)

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'scripts', 'icon-source.png')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

TEXT = 'HF FIELD EXPEDIENT ANTENNA'
# Ink box of the original caption, measured from the artwork.
BOX_X0, BOX_X1 = 22, 228
BOX_Y0, BOX_Y1 = 233, 246
# Band cleared before redrawing (kept clear of the rounded corners).
CLEAR = (20, 231, 235, 248)
TEXT_RGB = (201, 182, 143)   # icon's tan caption colour


def main():
    im = Image.open(SRC).convert('RGB')
    px = im.load()

    # Background: median of pixels in the band that are clearly not caption ink
    samples = [px[x, y] for y in range(CLEAR[1], CLEAR[3])
               for x in range(CLEAR[0], CLEAR[2])
               if px[x, y][0] < 80]
    if not samples:
        sys.exit('ERROR: could not sample the caption background')
    bg = tuple(sorted(c[i] for c in samples)[len(samples) // 2] for i in range(3))

    # Guard: the clear band must not touch the rounded corner / outside area
    for y in (CLEAR[1], CLEAR[3] - 1):
        for x in (CLEAR[0], CLEAR[2] - 1):
            if px[x, y][0] > 200:
                sys.exit('ERROR: clear band overlaps the icon corner at %d,%d' % (x, y))

    ImageDraw.Draw(im).rectangle([CLEAR[0], CLEAR[1], CLEAR[2] - 1, CLEAR[3] - 1], fill=bg)

    # Render the corrected caption large, then condense it into the original box
    target_w = BOX_X1 - BOX_X0 + 1
    target_h = BOX_Y1 - BOX_Y0 + 1
    big_font = ImageFont.truetype(FONT, 200)
    tmp = Image.new('L', (6000, 400), 0)
    ImageDraw.Draw(tmp).text((50, 50), TEXT, font=big_font, fill=255)
    mask = tmp.crop(tmp.getbbox()).resize((target_w, target_h), Image.LANCZOS)

    im.paste(Image.new('RGB', (target_w, target_h), TEXT_RGB), (BOX_X0, BOX_Y0), mask)
    im.save(SRC)
    print('Caption corrected to "%s" (bg %s, box %dx%d at %d,%d)'
          % (TEXT, bg, target_w, target_h, BOX_X0, BOX_Y0))


if __name__ == '__main__':
    main()
