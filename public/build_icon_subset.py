#!/usr/bin/env python3
"""Build a minimal bootstrap-icons subset for the Rex dashboard (portable).

Run from anywhere inside the project — all paths resolve relative to this
script's own location (dashboard/public/), not to where you invoke it.

What it does:
  1. Scans the dashboard JS files for bi-<name> class usage.
  2. Reads the codepoints from bootstrap-icons.json.
  3. Writes css/icons.css (only the used .bi-<name> rules).
  4. Rebuilds css/icons-subset.woff2 from the full font with pyftsubset
     (fonttools) so the WOFF2 always matches the CSS — skip with --no-font
     if fonttools is unavailable.

Requirements:
  - bootstrap-icons source under project root: node_modules/bootstrap-icons/
    OR any folder passed via --icons-dir (must contain font/ subfolder with
    bootstrap-icons.json and fonts/bootstrap-icons.woff2)

Usage:
  python3 dashboard/public/build_icon_subset.py            # default
  python3 dashboard/public/build_icon_subset.py --no-font  # CSS only
  python3 dashboard/public/build_icon_subset.py --icons-dir /path/to/bootstrap-icons
"""
import argparse
import json
import os
import re
import subprocess
import sys

# The script can live at the repo root OR inside dashboard/public —
# PROJECT_ROOT is the folder that contains node_modules/.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = (
    SCRIPT_DIR if os.path.isdir(os.path.join(SCRIPT_DIR, 'node_modules'))
    else os.path.dirname(SCRIPT_DIR)
)
OUT_DIR = os.path.join(SCRIPT_DIR, 'css')
if not os.path.isdir(OUT_DIR):
    # Fallback when run from the repo root: css lives under dashboard/public.
    OUT_DIR = os.path.join(SCRIPT_DIR, 'dashboard', 'public', 'css')

JS_FILES = [
    'js/app.js', 'js/components/ApiKeysTab.js', 'js/components/EndpointList.js',
    'js/components/OverviewTab.js', 'js/components/PasswordModal.js',
    'js/components/ResultPane.js', 'js/components/ShortlinkManager.js',
    'js/components/Sidebar.js', 'js/components/TryItModal.js',
    'js/components/FormField.js',
]
# HTML files are scanned too — both a recursive directory scan and an
# explicit list (so files outside the public tree, like profile/, are
# picked up regardless of where the script is run from).
HTML_FILES = [
    'dashboard.html',
    'profile/profile.html',
]

def main():
    ap = argparse.ArgumentParser(description='Build minimal bootstrap-icons subset')
    ap.add_argument('--no-font', action='store_true',
                    help='skip WOFF2 subset generation (CSS only)')
    ap.add_argument('--icons-dir', default=None,
                    help='path to a bootstrap-icons package (with font/ subfolder)')
    args = ap.parse_args()

    # 1. Locate the bootstrap-icons package.
    if args.icons_dir:
        icons_dir = args.icons_dir
    else:
        # npm layout (node_modules/bootstrap-icons) or the package root itself.
        # Search from the script's folder up to two levels so the script works
        # whether it sits at the repo root or in dashboard/public/.
        candidates = []
        for root in (SCRIPT_DIR, PROJECT_ROOT, os.path.dirname(PROJECT_ROOT)):
            candidates.extend([
                os.path.join(root, 'node_modules', 'bootstrap-icons'),
                os.path.join(root, 'bootstrap-icons'),
            ])
        icons_dir = next((c for c in candidates if os.path.isdir(c)), None)
    if not icons_dir or not os.path.isdir(os.path.join(icons_dir, 'font')):
        print(f'Error: bootstrap-icons source not found at {icons_dir}.')
        print('  Run `npm install bootstrap-icons` in the project root, or pass')
        print('  --icons-dir /path/to/bootstrap-icons.')
        sys.exit(1)

    src_json = os.path.join(icons_dir, 'font', 'bootstrap-icons.json')
    src_font = os.path.join(icons_dir, 'font', 'fonts', 'bootstrap-icons.woff2')
    if not os.path.exists(src_json):
        print(f'Error: {src_json} not found.')
        sys.exit(1)

    # 2. Scan JS files and HTML files for icon usage.
    icons = set()
    js_root = (
        SCRIPT_DIR if os.path.isdir(os.path.join(SCRIPT_DIR, 'js'))
        else os.path.join(SCRIPT_DIR, 'dashboard', 'public')
    )
    for fn in JS_FILES:
        path = os.path.join(js_root, fn)
        if not os.path.exists(path):
            print(f'Warning: {fn} not found, skipping.')
            continue
        with open(path, encoding='utf-8') as f:
            icons.update(re.findall(r'bi-([a-z][a-z0-9-]*)', f.read()))
    # Explicit HTML files (relative to js_root), with a repo-root fallback
    # so the script works from the repo root and from dashboard/public/.
    html_roots = [
        SCRIPT_DIR,
        js_root,
        os.path.dirname(SCRIPT_DIR),
    ]
    scanned = set()
    for fn in HTML_FILES:
        if fn in scanned:
            continue
        path = next((os.path.join(r, fn) for r in html_roots
                     if os.path.exists(os.path.join(r, fn))), None)
        if not path:
            print(f'Warning: {fn} not found, skipping.')
            continue
        scanned.add(fn)
        with open(path, encoding='utf-8') as f:
            icons.update(re.findall(r'bi-([a-z][a-z0-9-]*)', f.read()))
    # Bonus: recurse through {js_root}/html-ish pages as a safety net.
    for root, _, files in os.walk(js_root):
        for f in files:
            if f.endswith('.html'):
                p = os.path.join(root, f)
                with open(p, encoding='utf-8') as fh:
                    icons.update(re.findall(r'bi-([a-z][a-z0-9-]*)', fh.read()))
    print(f'Used icons ({len(icons)}):', sorted(icons))

    with open(src_json, encoding='utf-8') as f:
        meta = json.load(f)

    missing = [n for n in icons if n not in meta]
    if missing:
        print('Error: icon names used in JS but not in bootstrap-icons.json:')
        for n in sorted(missing):
            print('  MISSING:', n)
        sys.exit(1)
    glyphs = {n: meta[n] for n in icons}

    # 3. Write icons.css (root-relative font path — same as the hand-built file).
    css = f"""/* Rex API — minimal bootstrap-icons subset ({len(glyphs)} icons).
   Auto-generated by build_icon_subset.py — do not edit by hand.
   Source: bootstrap-icons@1.11.3 (MIT). */
@font-face{{
  font-family:'bi-subset';
  src:url('/css/icons-subset.woff2') format('woff2');
  font-weight:normal;
  font-style:normal;
  font-display:swap;
}}
[class^='bi-']::before,[class*=' bi-']::before{{
  font-family:'bi-subset' !important;
  speak:none;
  font-style:normal;
  font-weight:normal;
  font-variant:normal;
  text-transform:none;
  line-height:1;
  vertical-align:-.125em;
  -webkit-font-smoothing:antialiased;
}}
"""
    for name, code in glyphs.items():
        css += f'.bi-{name}:before{{content:"\\{code:x}"}}\n'

    os.makedirs(OUT_DIR, exist_ok=True)
    css_path = os.path.join(OUT_DIR, 'icons.css')
    with open(css_path, 'w', encoding='utf-8') as f:
        f.write(css)
    print(f'wrote {css_path} ({len(css)} bytes)')

    # 4. Rebuild the WOFF2 subset so the font always matches the CSS.
    if args.no_font or not os.path.exists(src_font):
        if not os.path.exists(src_font):
            print('Warning: full WOFF2 font not found — skipping subset build.')
        return
    out_font = os.path.join(OUT_DIR, 'icons-subset.woff2')
    try:
        subprocess.run([
            'pyftsubset', src_font,
            '--output-file=' + out_font,
            '--flavor=woff2',
            '--no-hinting',
            '--unicodes=' + ','.join(f'U+{c:X}' for c in glyphs.values()),
        ], check=True, capture_output=True, text=True)
    except FileNotFoundError:
        print('Warning: pyftsubset (fonttools) not installed — skipping WOFF2 rebuild.')
        print('  pip install fonttools brotli   then re-run to rebuild the font.')
        return
    print(f'wrote {out_font} ({os.path.getsize(out_font)} bytes)')

if __name__ == '__main__':
    main()
