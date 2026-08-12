"""Minify the optimized Rex API stylesheet for production.

Strategy (manual, cssmin-free for safety):
  1. Strip /* ... */ comments, including multi-line, but never touch
     strings inside url()/content() quotes (no quoted strings in this
     file contain '*/', so a greedy regex over the whole file is safe).
  2. Collapse all runs of whitespace (including newlines) to a single
     space, trimming around structural characters { } : ; , > +.
  3. Remove trailing semicolon before closing brace.

The optimized source was audited to contain no unquoted '*/' sequences
outside comments, so greedy comment removal is safe here.
"""
import re

src = open('optimized/public/css/style.css', encoding='utf-8').read()

# 1. Strip comments (greedy — safe per audit above).
src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)

# 2. Collapse whitespace around structural characters.
src = re.sub(r'\s+', ' ', src)
for ch in ['{', '}', ':', ';', ',', '>', '+', '~']:
    src = src.replace(' {' , '{').replace('{ ', '{')
    src = src.replace(' }', '}').replace('} ', '}')
    src = src.replace(' :', ':').replace(': ', ':')
    src = src.replace(' ;', ';').replace('; ', ';')
    src = src.replace(' ,', ',').replace(', ', ',')
    src = src.replace(' >', '>').replace('> ', '>')
    src = src.replace(' +', '+').replace('+ ', '+')
    src = src.replace(' ~', '~').replace('~ ', '~')

# 3. Trailing semicolon before }.
src = src.replace(';}', '}')

out = src.strip() + '\n'
open('optimized/public/css/style.min.css', 'w', encoding='utf-8').write(out)

import gzip
raw = len(out)
gz = len(gzip.compress(out.encode()))
print(f'minified: {raw} bytes raw, {gz} bytes gzip')

orig = open('optimized/public/css/style.css', encoding='utf-8').read()
print(f'source:   {len(orig)} bytes raw, {len(gzip.compress(orig.encode()))} bytes gzip')
