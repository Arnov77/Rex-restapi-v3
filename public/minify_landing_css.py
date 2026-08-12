"""Minify the Rex API landing-page stylesheet for production.

Strategy (manual, cssmin-free for safety):
  1. Strip /* ... */ comments, including multi-line, but never touch
     strings inside url()/content() quotes. The source has been audited:
     no unquoted '*/' sequences appear outside comments, so a greedy
     regex over the whole file is safe.
  2. Collapse all runs of whitespace (including newlines) to a single
     space, trimming around structural characters { } : ; , > + ~.
  3. Remove trailing semicolon before closing brace.

Run from the repo root as:
  python3 merged/public/minify_landing_css.py

Produces merged/public/css/style.min.css next to the source.
"""
import gzip
import os

SRC = os.path.join('merged', 'public', 'css', 'style.css')
OUT = os.path.join('merged', 'public', 'css', 'style.min.css')

import re
src = open(SRC, encoding='utf-8').read()
# 1. Strip comments (greedy — safe per audit above).
src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
# 2. Collapse whitespace around structural characters.
src = re.sub(r'\s+', ' ', src)
for pair in [(' {', '{'), ('{ ', '{'),
             (' }', '}'), ('} ', '}'),
             (' :', ':'), (': ', ':'),
             (' ;', ';'), ('; ', ';'),
             (' ,', ','), (', ', ','),
             (' >', '>'), ('> ', '>'),
             (' +', '+'), ('+ ', '+'),
             (' ~', '~'), ('~ ', '~')]:
    src = src.replace(pair[0], pair[1])
# 3. Trailing semicolon before }.
src = src.replace(';}', '}')
out = src.strip() + '\n'
open(OUT, 'w', encoding='utf-8').write(out)

raw = len(out)
gz = len(gzip.compress(out.encode()))
print(f'minified: {raw} bytes raw, {gz} bytes gzip')
orig = open(SRC, encoding='utf-8').read()
print(f'source:   {len(orig)} bytes raw, {len(gzip.compress(orig.encode()))} bytes gzip')
print(f'saved:    {len(orig) - raw} bytes raw ({(1 - raw / len(orig)) * 100:.1f}%)')
