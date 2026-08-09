#!/usr/bin/env python3
"""Regenerate all app icons from scripts/assets/icon-source.png with a version badge.

Reads the version from package.json (single source of truth), composites a
"v<major>.<minor>" pill onto the artwork, and writes:

  public/icon-512.png           512x512 full-bleed
  public/icon-192.png           192x192 full-bleed
  public/apple-touch-icon.png   180x180 full-bleed (iOS preferred size)
  public/icon-512-maskable.png  512x512, artwork scaled onto a matching dark
                                background so every essential pixel (badge,
                                corner text) fits the W3C maskable safe zone
                                (central circle, radius 40% of icon width)

Usage: python3 scripts/generate-icons.py   (run from the repo root)
Requires: pillow  (pip install pillow)

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. — USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import json, os, sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCE = os.path.join(ROOT, 'scripts', 'icon-source.png')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def main():
    version = json.load(open(os.path.join(ROOT, 'package.json')))['version']
    badge_text = 'v' + '.'.join(version.split('.')[:2])   # 1.0.0 -> v1.0

    src = Image.open(SOURCE).convert('RGB')

    # Work at 512 regardless of source size
    art = src.resize((512, 512), Image.LANCZOS)

    # Badge pill, top-left clear area, palette matched to the artwork
    d = ImageDraw.Draw(art)
    x0, y0, w, h = 32, 32, 132, 52
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=h // 2,
                        fill=(90, 158, 75), outline=(14, 20, 9), width=4)
    font = ImageFont.truetype(FONT, 34)
    tb = d.textbbox((0, 0), badge_text, font=font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    d.text((x0 + (w - tw) / 2 - tb[0], y0 + (h - th) / 2 - tb[1]),
           badge_text, font=font, fill=(14, 20, 9))

    # Full-bleed outputs
    art.save(os.path.join(ROOT, 'public', 'icon-512.png'))
    art.resize((192, 192), Image.LANCZOS).save(os.path.join(ROOT, 'public', 'icon-192.png'))
    art.resize((180, 180), Image.LANCZOS).save(os.path.join(ROOT, 'public', 'apple-touch-icon.png'))

    # Maskable: artwork into the inner ~80% safe zone on a matching dark bg.
    # The source has white baked into its rounded corners — measure that
    # radius and mask it off so the corners blend into the background.
    row = [src.getpixel((x, 0)) for x in range(src.width)]
    corner_r = next((x for x, p in enumerate(row)
                     if not all(c > 240 for c in p)), 0)  # near-white counts as white
    corner_r_512 = int(corner_r * 512 / src.width)

    bg = src.getpixel((src.width // 2, 1))  # dark edge color of the artwork
    mask = Image.new('L', (512, 512), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 511, 511], radius=max(corner_r_512, 1), fill=255)

    # 0.64 keeps the artwork's farthest essential pixels (badge corner,
    # bottom text ends, ~316px from center at full scale) inside the safe
    # circle radius of 204.8px: 316 x 0.64 = 202 < 204.8.
    safe = int(512 * 0.64)
    art_small = art.resize((safe, safe), Image.LANCZOS)
    mask_small = mask.resize((safe, safe), Image.LANCZOS)
    maskable = Image.new('RGB', (512, 512), bg)
    off = (512 - safe) // 2
    maskable.paste(art_small, (off, off), mask_small)
    maskable.save(os.path.join(ROOT, 'public', 'icon-512-maskable.png'))

    print(f'Icons regenerated with badge "{badge_text}" '
          f'(corner radius {corner_r_512}px, maskable bg {bg})')

if __name__ == '__main__':
    main()
