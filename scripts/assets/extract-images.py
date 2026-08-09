#!/usr/bin/env python3
"""One-time migration: pull base64 antenna photos out of src/ui/HFCalc.jsx.

Before v1.7 the nine antennas' reference photos (27 JPEGs, ~1.7 MB) were
embedded as base64 data URIs directly in the source, which meant the JS
bundle carried all of them and every code change forced a re-download of
the artwork. This script writes each image to public/antenna/<key>-<n>.jpg
and rewrites the ANTENNA_IMAGES map to reference them by path.

Kept in the repo for provenance; it is idempotent-safe (it exits cleanly if
the source no longer contains data URIs).

Usage: python3 scripts/extract-images.py   (run from the repo root)

Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
Project signature: HFCALC-AG-EZK-USMC-v1
"""
import base64
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSX = os.path.join(ROOT, 'src', 'HFCalc.jsx')
OUT_DIR = os.path.join(ROOT, 'public', 'antenna')

ENTRY_RE = re.compile(
    r'\{\s*url:\s*"data:image/(?P<ext>[a-z]+);base64,(?P<data>[^"]+)",\s*'
    r'caption:\s*(?P<caption>"(?:[^"\\]|\\.)*")\s*,?\s*\}'
)


def main():
    src = open(JSX, encoding='utf-8').read()
    start = src.index('const ANTENNA_IMAGES = {')
    end = src.index('\n};', start) + len('\n};')
    block = src[start:end]

    if 'base64' not in block:
        print('No embedded images found — already extracted. Nothing to do.')
        return

    os.makedirs(OUT_DIR, exist_ok=True)
    counters = {}
    written = []

    def current_key(pos):
        """Nearest `  key: [` above pos in the block."""
        keys = list(re.finditer(r'\n  ([a-z_0-9]+):\s*\[', block))
        key = None
        for m in keys:
            if m.start() < pos:
                key = m.group(1)
        return key

    def repl(m):
        key = current_key(m.start()) or 'misc'
        counters[key] = counters.get(key, 0) + 1
        ext = 'jpg' if m.group('ext') in ('jpeg', 'jpg') else m.group('ext')
        name = '%s-%d.%s' % (key, counters[key], ext)
        path = os.path.join(OUT_DIR, name)
        with open(path, 'wb') as fh:
            fh.write(base64.b64decode(m.group('data')))
        written.append((name, os.path.getsize(path)))
        return '{ url: ANTENNA_IMG_BASE + %r, caption: %s }' % (name, m.group('caption'))

    new_block = ENTRY_RE.sub(repl, block)
    header = (
        '// Antenna reference photos live in public/antenna/ (extracted from the\n'
        '// bundle in v1.7 by scripts/extract-images.py). Paths resolve against\n'
        "// BASE_URL so they work at both '/' (Tauri, dev) and '/hfcal/' (Pages),\n"
        '// and the service worker precaches them so offline use is unchanged.\n'
        "const ANTENNA_IMG_BASE = import.meta.env.BASE_URL + 'antenna/';\n"
    )
    src = src[:start] + header + new_block + src[end:]
    open(JSX, 'w', encoding='utf-8').write(src)

    total = sum(sz for _, sz in written)
    print('Extracted %d images (%.1f MB) to public/antenna/' % (len(written), total / 1e6))
    for name, sz in written:
        print('  %-26s %6.0f KB' % (name, sz / 1024))


if __name__ == '__main__':
    sys.exit(main())
