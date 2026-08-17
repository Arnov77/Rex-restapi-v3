import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface MiqTemplateOptions {
  text: string;
  name: string;
  username: string;
  image: string;
  orientation: 'landscape' | 'portrait';
  image_filter: 'grayscale' | 'color';
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
}

const CANVAS = {
  landscape: { width: 1200, height: 630 },
  portrait:  { width: 630,  height: 840  },
} as const;

// Load the bundled Lora woff2 files once at module init — no network fetch at
// render time and no dependency on Google Fonts / a system-installed font.
// Each entry is a base64 data URI read straight from disk in assets/.
function loadFontDataUri(file: string): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const woff2 = readFileSync(join(here, 'assets', file));
    return `data:font/woff2;base64,${woff2.toString('base64')}`;
  } catch {
    return '';
  }
}

const LORA_400       = loadFontDataUri('lora-latin-400-normal.woff2');
const LORA_500       = loadFontDataUri('lora-latin-500-normal.woff2');
const LORA_600       = loadFontDataUri('lora-latin-600-normal.woff2');
const LORA_400_ITAL  = loadFontDataUri('lora-latin-400-italic.woff2');
const LORA_500_ITAL  = loadFontDataUri('lora-latin-500-italic.woff2');

function fontFace(weight: number, style: 'normal' | 'italic', uri: string): string {
  if (!uri) return '';
  return `@font-face{
    font-family:"Lora";
    src:url("${uri}") format("woff2");
    font-weight:${weight};
    font-style:${style};
    font-display:block;
    unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
  }`;
}

const FONT_FACES = [
  fontFace(400, 'normal', LORA_400),
  fontFace(500, 'normal', LORA_500),
  fontFace(600, 'normal', LORA_600),
  fontFace(400, 'italic', LORA_400_ITAL),
  fontFace(500, 'italic', LORA_500_ITAL),
].join('\n');

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const cp = c.codePointAt(0);
    return cp !== undefined ? `&#${cp};` : c;
  });
}

export function renderMiqHtml(opts: MiqTemplateOptions): string {
  const { width, height } = CANVAS[opts.orientation];
  const grayscale = opts.image_filter === 'grayscale' ? 'filter:grayscale(1);' : '';
  const landscape = opts.orientation === 'landscape';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  ${FONT_FACES}

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    width: ${width}px;
    height: ${height}px;
    background: #000;
    overflow: hidden;
  }

  body {
    font-family: "Lora", Georgia, serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
    color: #fff;
  }

  #canvas {
    position: relative;
    width: ${width}px;
    height: ${height}px;
    background: #000;
    overflow: hidden;
  }

  /* ── Image ── */
  .img-wrap {
    position: absolute;
    ${landscape ? `
    left: 0;
    top: 0;
    width: 45%;
    height: 100%;
    ` : `
    left: 0;
    top: 0;
    width: 100%;
    height: 62%;
    `}
    overflow: hidden;
  }

  .img-wrap img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center top;
    ${grayscale}
  }

  .img-wrap::after {
    content: "";
    position: absolute;
    inset: 0;
    background: ${landscape
      ? 'linear-gradient(to right, transparent 30%, #000 100%)'
      : 'linear-gradient(to bottom, transparent 40%, #000 100%)'
    };
  }

  /* ── Content ── */
  .content {
    position: absolute;
    ${landscape ? `
    right: 0;
    top: 0;
    width: 60%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 64px 60px 40px;
    text-align: center;
    ` : `
    left: 0;
    bottom: 0;
    width: 100%;
    height: 52%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 52px 52px;
    text-align: center;
    `}
  }

  /* ── Quote marks (portrait only) ── */
  .quote-marks {
    font-size: 72px;
    line-height: 1;
    color: #fff;
    letter-spacing: 8px;
    margin-bottom: 12px;
    font-family: Georgia, serif;
  }

  /* ── Quote text ── */
  .quote-text {
    font-size: ${landscape ? '42px' : '36px'};
    font-weight: 500;
    font-style: italic;
    line-height: 1.4;
    color: #fff;
    margin-bottom: ${landscape ? '28px' : '24px'};
  }

  /* ── Divider (portrait only) ── */
  .divider {
    width: 60px;
    height: 2px;
    background: rgba(255,255,255,.5);
    margin-bottom: 20px;
  }

  /* ── Name ── */
  .name {
    font-size: ${landscape ? '24px' : '22px'};
    font-weight: 500;
    font-style: normal;
    color: #fff;
    line-height: 1.2;
    margin-bottom: 6px;
  }

  /* ── Username ── */
  .username {
    font-size: ${landscape ? '16px' : '15px'};
    font-weight: 400;
    font-style: normal;
    color: rgba(255,255,255,.5);
    line-height: 1.2;
  }
</style>
</head>
<body>
<div id="canvas">

  <div class="img-wrap">
    <img src="${esc(opts.image)}" alt=""/>
  </div>

  <div class="content">
    ${!landscape ? `<div class="quote-marks">“ ”</div>` : ''}
    <p class="quote-text">${esc(opts.text)}</p>
    ${!landscape ? `<div class="divider"></div>` : ''}
    <p class="name">${landscape ? `- ${esc(opts.name)}` : esc(opts.name)}</p>
    <p class="username">${esc(opts.username.startsWith('@') ? opts.username : '@' + opts.username)}</p>
  </div>

</div>

<script>
(async () => {
  const imgs = Array.from(document.images || []);
  await Promise.all(imgs.map((img) =>
    img.complete
      ? Promise.resolve()
      : new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        })
  ));
  // Tunggu font Lora load dulu sebelum render, biar tidak pakai fallback Georgia
  try { await document.fonts.ready; } catch (e) {}
  document.documentElement.dataset.ready = '1';
})();
</script>
</body>
</html>`;
}
