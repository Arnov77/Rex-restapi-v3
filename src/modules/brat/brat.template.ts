/**
 * Returns a self-contained HTML document that renders one brat-style
 * caption frame. We intentionally avoid external font/CSS requests so the
 * page can be rendered with `setContent` (no network = no SSRF surface).
 *
 * Font-size auto-shrink: we let the browser size by viewport width, then
 * a tiny inline script trims font-size until the text fits both axes.
 */
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
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:${opts.width}px;height:${opts.height}px;overflow:hidden;background:${opts.background};${bgLayer}}
  .wrap{width:100%;height:100%;display:flex;align-items:flex-start;justify-content:flex-start;padding:6%;box-sizing:border-box;}
  .t{
    font-family: "Arial Narrow", "ArialNarrow", "Liberation Sans Narrow", Arial, Helvetica, sans-serif;
    font-weight: 700;
    font-stretch: condensed;
    color:${opts.color};
    text-transform:lowercase;
    letter-spacing:-0.04em;
    line-height:0.95;
    text-align:left;
    filter: blur(${opts.blur}px);
    word-break: break-word;
    max-width:100%;
    font-size:${Math.round(opts.width * 0.28)}px;
  }
</style></head><body>
<div class="wrap"><div id="t" class="t">${esc(opts.text)}</div></div>
<script>
  // Shrink-to-fit. Bounded loop — never block the page indefinitely.
  (function(){
    var el=document.getElementById('t');
    var box=el.parentElement;
    var size=parseInt(getComputedStyle(el).fontSize,10);
    for(var i=0;i<60;i++){
      if(el.scrollWidth<=box.clientWidth && el.scrollHeight<=box.clientHeight) break;
      size=Math.max(12,size-Math.ceil(size*0.08));
      el.style.fontSize=size+'px';
    }
    document.documentElement.dataset.ready='1';
  })();
</script>
</body></html>`;
}
