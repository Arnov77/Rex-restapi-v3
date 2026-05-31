import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface SmemeTemplateOptions {
  image: string;
  top?: string;
  bottom?: string;
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
}

// Load font sekali saat module init — tidak ada network fetch saat render
const FONT_DATA_URI: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const ttf = readFileSync(join(here, 'assets', 'anton.ttf'));
    return `data:font/ttf;base64,${ttf.toString('base64')}`;
  } catch {
    return '';
  }
})();

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

export function renderSmemeHtml(opts: SmemeTemplateOptions): string {
  const fontFace = FONT_DATA_URI
    ? `@font-face {
        font-family: 'Impacted';
        src: url("${FONT_DATA_URI}") format('truetype');
        font-weight: normal;
        font-style: normal;
        font-display: block;
      }`
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  ${fontFace}

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    background: transparent;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }

  #canvas {
    position: relative;
    display: inline-block;
    line-height: 0;
  }

  #canvas img {
    display: block;
    max-width: 800px;
    max-height: 800px;
    width: auto;
    height: auto;
  }

  .meme-text {
    position: absolute;
    left: 0;
    right: 0;
    padding: 0 10px;
    font-family: 'Impacted', Impact, Arial, sans-serif;
    font-size: 52px;
    font-weight: normal;
    text-transform: uppercase;
    text-align: center;
    color: #fff;
    line-height: 1.1;
    letter-spacing: 1px;
    word-break: break-word;
    -webkit-text-stroke: 2px #000;
    text-shadow:
      2px  2px 0 #000,
     -2px  2px 0 #000,
      2px -2px 0 #000,
     -2px -2px 0 #000,
      0px  3px 0 #000,
      0px -3px 0 #000,
      3px  0px 0 #000,
     -3px  0px 0 #000;
  }

  .meme-text.top {
    top: 10px;
  }

  .meme-text.bottom {
    bottom: 10px;
  }
</style>
</head>
<body>
<div id="canvas">
  <img id="img" src="${esc(opts.image)}" alt=""/>
  ${opts.top    ? `<div class="meme-text top">${esc(opts.top)}</div>`    : ''}
  ${opts.bottom ? `<div class="meme-text bottom">${esc(opts.bottom)}</div>` : ''}
</div>

<script>
(async () => {
  const img = document.getElementById('img');
  await (img.complete ? Promise.resolve() : new Promise((resolve) => {
    img.addEventListener('load',  resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  }));

  // Tunggu font load dulu sebelum render
  if (document.fonts?.ready) await document.fonts.ready;

  const imgWidth = img.naturalWidth || img.offsetWidth || 500;
  const fontSize = Math.max(40, Math.min(140, Math.round(imgWidth * 0.14)));
  document.querySelectorAll('.meme-text').forEach((el) => {
    el.style.fontSize = fontSize + 'px';
  });

  document.documentElement.dataset.ready = '1';
})();
</script>
</body>
</html>`;
}