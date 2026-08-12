"""Minify the redesigned Rex API dashboard stylesheet for production.
Strategy (same proven pass as style.css, cssmin-free for safety):
  1. Strip /* ... */ comments greedily — safe because this file's
     url()/content() strings contain no unquoted '*/' sequences.
  2. Collapse whitespace runs to a single space; trim around structural
     characters { } : ; , > + ~.
  3. Remove the trailing semicolon before each closing brace.
Safety checks after minification:
  - braces must balance,
  - no whitespace adjacent to structural chars,
  - every selector block must still contain at least one declaration.
Run from the project root:  python3 minify_dashboard_css.py
"""
import gzip
import re

SRC = 'dashboard/public/css/dashboard.css'
OUT = 'dashboard/public/css/dashboard.min.css'

src = open(SRC, encoding='utf-8').read()

# 1. Strip comments (greedy — safe per audit: no unquoted '*/' outside them).
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

# ---- Safety audits -----------------------------------------------------
errs = []
if out.count('{') != out.count('}'):
    errs.append('unbalanced braces')
if re.search(r'\s[{;:,>+~]|[{;:,>+~]\s', out):
    errs.append('stray whitespace around structural characters')
# Any block with a selector but no declaration? find '{...}' pairs with
# empty bodies.
for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', out):
    if not m.group(2).strip():
        errs.append('empty rule body for: ' + m.group(1)[:60])
if errs:
    print('AUDIT FAILED — do NOT deploy:')
    for e in errs:
        print('  -', e)
    raise SystemExit(1)
print('audit: balanced braces, clean whitespace, no empty rule bodies')

open(OUT, 'w', encoding='utf-8').write(out)

raw = len(out)
gz = len(gzip.compress(out.encode()))
orig = len(src) if False else len(open(SRC, encoding='utf-8').read())
print(f'source: {orig} bytes raw, {len(gzip.compress(open(SRC, encoding="utf-8").read().encode()))} bytes gzip')
print(f'minified: {raw} bytes raw, {gz} bytes gzip')
print(f'savings: {(1 - gz / len(gzip.compress(open(SRC, encoding="utf-8").read().encode()))) * 100:.1f}% on the wire')
