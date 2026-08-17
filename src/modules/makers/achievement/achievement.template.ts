import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface AchievementTemplateOptions {
  title: string;
  text1: string;
  text2: string;
  iconDataUri: string;
}

// Load the bundled Minecraft TTF once at module init — no network fetch at
// render time, and no dependency on a system-installed font (fontconfig).
// sharp/librsvg cannot honour an @font-face data URI, so we render the SVG
// through Chromium (see achievement.service.ts), which can.
const FONT_DATA_URI: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const ttf = readFileSync(join(here, 'assets', 'Minecraft.ttf'));
    return `data:font/ttf;base64,${ttf.toString('base64')}`;
  } catch {
    return '';
  }
})();

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    const cp = c.codePointAt(0);
    return cp !== undefined ? `&#${cp};` : c;
  });
}

// The card itself is the classic Minecraft toast: a wide, thin 780×136 bar.
// Wrapping it in a square 900×900 canvas keeps the toast's identity but lets
// downstream consumers (WhatsApp stickers, which square-crop to ~512px) show
// the card at a readable size. The card is centred vertically via Y_OFFSET;
// everything inside the <g> keeps the original toast-relative coordinates
// shifted by that offset.
export function renderAchievementHtml(opts: AchievementTemplateOptions): string {
  const fontFace = FONT_DATA_URI
    ? `@font-face{font-family:"Minecraft";src:url("${FONT_DATA_URI}") format("truetype");font-weight:normal;font-style:normal;font-display:block;}`
    : '';

  const SIDE = 900;
  // Original toast was 900×260 centred at y≈78..214; in a 900×900 canvas we
  // centre it: card occupies the middle 260px, i.e. y from 320 to 580.
  // The toast already had a top margin of 78 within the 260-row, so the inner
  // group's origin shifts by 320 - 0 = 320 (card top at 78+320 = 398).
  const Y_OFFSET = 320;

  const colors = {
    bgTop: '#3f3f3f',
    bgBottom: '#202020',
    outer1: '#787878',
    innerShadow: '#2b2b2b',
    title: '#fffb54',
    text: '#ffffff',
  };

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  ${fontFace}
  html, body { margin: 0; padding: 0; background: transparent; }
</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIDE}" height="${SIDE}" viewBox="0 0 ${SIDE} ${SIDE}">
  <rect width="${SIDE}" height="${SIDE}" fill="transparent" />
  <g transform="translate(0, ${Y_OFFSET})" filter="url(#shadow)">
    <defs>
      <linearGradient id="cardBg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${colors.bgTop}" />
        <stop offset="100%" stop-color="${colors.bgBottom}" />
      </linearGradient>
      <filter id="shadow" x="-10%" y="-20%" width="130%" height="160%">
        <feDropShadow dx="0" dy="6" stdDeviation="4" flood-color="rgba(0,0,0,0.35)" />
      </filter>
    </defs>

    <rect width="${SIDE}" height="260" fill="transparent" />

    <rect x="52" y="78" width="796" height="136" rx="2" fill="${colors.outer1}" />
    <rect x="60" y="86" width="780" height="120" rx="2" fill="url(#cardBg)" />
    <rect x="68" y="94" width="764" height="104" rx="1" fill="none" stroke="${colors.innerShadow}" stroke-width="3" opacity="0.65"/>

    <image
      href="${opts.iconDataUri}"
      x="88"
      y="103"
      width="86"
      height="86"
      preserveAspectRatio="xMidYMid meet"
      image-rendering="pixelated"
    />

    <text
      x="196"
      y="124"
      font-family="Minecraft, monospace"
      font-weight="normal"
      fill="${colors.title}"
      font-size="30"
      lengthAdjust="spacingAndGlyphs"
    >${esc(opts.title)}</text>

    <text
      x="196"
      y="168"
      font-family="Minecraft, monospace"
      font-weight="normal"
      fill="${colors.text}"
      font-size="28"
      lengthAdjust="spacingAndGlyphs"
    >${esc(opts.text1)}</text>

    ${
      opts.text2
        ? `<text
      x="196"
      y="196"
      font-family="Minecraft, monospace"
      font-weight="normal"
      fill="${colors.text}"
      font-size="24"
      opacity="0.95"
      lengthAdjust="spacingAndGlyphs"
    >${esc(opts.text2)}</text>`
        : ''
    }
  </g>
</svg>
<script>
(async () => {
  try { await document.fonts.ready; } catch (e) {}
  document.documentElement.dataset.ready = '1';
})();
</script>
</body>
</html>`;
}
