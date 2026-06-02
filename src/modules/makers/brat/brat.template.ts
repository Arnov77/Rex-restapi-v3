/**
 * Returns a self-contained HTML document that renders one brat-style
 * caption frame. Mirrors bratify.vercel.app's CSS exactly:
 *   font-family: arialnarrow (embedded TTF, no network)
 *   text-align: justify
 *   filter: blur(1.5px) by default
 *   no padding, no letter-spacing, no text-transform
 * Font-size auto-shrinks until the text fits both axes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface BratTemplateOptions {
  text: string;
  width: number;
  height: number;
  blur: number;
  background: string;
  color: string;
  /** Optional pre-validated background image URL (already SSRF-checked). */
  bgImage?: string;
}

// Embed the bundled Arial Narrow TTF as a data URI so `setContent` can render
// it without any network fetch. Loaded once at module init.
const FONT_DATA_URI: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const ttf = readFileSync(join(here, 'assets', 'arialnarrow.ttf'));
    return `data:font/ttf;base64,${ttf.toString('base64')}`;
  } catch {
    return '';
  }
})();

// HTML escape — never inject the user's text raw into the DOM.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' : '&#39;',
  );
}

export function renderBratHtml(opts: BratTemplateOptions): string {
  const bgLayer = opts.bgImage
    ? `background-image:url("${esc(opts.bgImage)}");background-size:cover;background-position:center;`
    : '';
  const fontFace = FONT_DATA_URI
    ? `@font-face{font-family:"arialnarrow";src:url("${FONT_DATA_URI}") format("truetype");font-weight:400;font-style:normal;font-display:block;}`
    : '';
  // Bratify uses 48px on a 384px box (24rem). That's 12.5% of width.
  // We start a bit larger and let the shrink-to-fit loop trim down.
  const startSize = Math.round(opts.width * 0.25);
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  ${fontFace}
  html,body{margin:0;padding:0;width:${opts.width}px;height:${opts.height}px;overflow:hidden;background:${opts.background};${bgLayer}}
  #t{
    box-sizing:border-box;
    width:${opts.width}px;
    height:${opts.height}px;
    color:${opts.color};
    font-family:"arialnarrow","Arial Narrow",Arial,sans-serif;
    font-weight:400;
    text-align:justify;
    filter:blur(${opts.blur}px);
    backface-visibility:hidden;
    word-break:break-word;
    overflow:hidden;
    font-size:${startSize}px;
  }
</style></head><body>
<div id="t">${esc(opts.text)}</div>
<script>
  // Wait for the embedded font to load before measuring; otherwise the
  // shrink loop runs against fallback metrics and over-shrinks.
  (function(){
    var el=document.getElementById('t');
    function fit(){
      var size=parseInt(getComputedStyle(el).fontSize,10);
      for(var i=0;i<80;i++){
        if(el.scrollHeight<=el.clientHeight && el.scrollWidth<=el.clientWidth) break;
        size=Math.max(10,size-Math.ceil(size*0.05));
        el.style.fontSize=size+'px';
      }
      document.documentElement.dataset.ready='1';
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(fit, fit);
    } else {
      fit();
    }
  })();
</script>
</body></html>`;
}
