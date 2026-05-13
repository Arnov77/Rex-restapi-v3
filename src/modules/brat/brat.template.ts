/**
 * Returns a self-contained HTML document that renders one brat-style
 * caption frame. We intentionally avoid external font/CSS requests so the
 * page can be rendered with `setContent` (no network = no SSRF surface).
 *
 * Font-size auto-shrink: we let the browser size by viewport width, then
 * a tiny inline script trims font-size until the text fits both axes.
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
    ? `@font-face{font-family:"BratArialNarrow";src:url("${FONT_DATA_URI}") format("truetype");font-weight:400;font-style:normal;font-display:block;}`
    : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  ${fontFace}
  html,body{margin:0;padding:0;width:${opts.width}px;height:${opts.height}px;overflow:hidden;background:${opts.background};${bgLayer}}
  .wrap{width:100%;height:100%;display:flex;align-items:flex-start;justify-content:flex-start;padding:3%;box-sizing:border-box;}
  .t{
    font-family: "BratArialNarrow", "Arial Narrow", "Liberation Sans Narrow", Arial, Helvetica, sans-serif;
    font-weight: 400;
    color:${opts.color};
    text-transform:lowercase;
    line-height:1.0;
    text-align:left;
    filter: blur(${opts.blur}px);
    word-break: break-word;
    max-width:100%;
    font-size:${Math.round(opts.width * 0.22)}px;
  }
</style></head><body>
<div class="wrap"><div id="t" class="t">${esc(opts.text)}</div></div>
<script>
  // Wait for the embedded font to be ready before measuring, otherwise the
  // shrink-to-fit loop runs against the fallback metrics.
  (function(){
    var el=document.getElementById('t');
    var box=el.parentElement;
    function fit(){
      var size=parseInt(getComputedStyle(el).fontSize,10);
      for(var i=0;i<60;i++){
        if(el.scrollWidth<=box.clientWidth && el.scrollHeight<=box.clientHeight) break;
        size=Math.max(12,size-Math.ceil(size*0.06));
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
