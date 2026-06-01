/**
 * Twitter-style quote card HTML template.
 *
 * Three themes (light / dim / dark) mirror Twitter's own palettes. Font
 * stacks are bundled system fonts — no network fetch, so we can render in
 * a single page.setContent() call with no font-loading races.
 *
 * The card auto-sizes height: we wrap everything in #card with `display:
 * inline-block` and screenshot that element directly (not the viewport),
 * so the output is exactly the card's bounding box.
 */
const THEMES = {
    light: { bg: '#ffffff', fg: '#0f1419', sub: '#536471', border: '#eff3f4' },
    dim: { bg: '#15202b', fg: '#f7f9f9', sub: '#8b98a5', border: '#38444d' },
    dark: { bg: '#000000', fg: '#e7e9ea', sub: '#71767b', border: '#2f3336' },
};
const FONTS = {
    sans: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    serif: 'Georgia,"Times New Roman",serif',
    mono: '"SFMono-Regular",Menlo,Consolas,"Liberation Mono",monospace',
};
function esc(s) {
    return s.replace(/[&<>"']/g, (c) => c === '&' ? '&amp;' :
        c === '<' ? '&lt;' :
            c === '>' ? '&gt;' :
                c === '"' ? '&quot;' : '&#39;');
}
// Inline SVG initial avatar when none provided. Uses accent colour as bg.
function initialAvatar(name, accent) {
    const initial = esc((name.trim()[0] ?? 'A').toUpperCase());
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' fill='${accent}'/><text x='32' y='42' font-family='Arial,sans-serif' font-size='32' font-weight='700' text-anchor='middle' fill='#fff'>${initial}</text></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
const VERIFIED_BADGE = `
<svg viewBox="0 0 22 22" width="20" height="20" aria-label="Verified">
  <path fill="currentColor" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/>
</svg>`;
export function renderQuoteHtml(opts) {
    const t = THEMES[opts.theme];
    const fontStack = FONTS[opts.font];
    const avatar = opts.avatar ?? initialAvatar(opts.name, opts.accent);
    // Preserve line breaks the user typed; CSS `white-space: pre-wrap` handles it.
    const safeText = esc(opts.text);
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent;}
  body{padding:24px;font-family:${fontStack};-webkit-font-smoothing:antialiased;}
  #card{
    display:inline-block;
    width:${opts.width - 48}px;
    background:${t.bg};
    color:${t.fg};
    border:1px solid ${t.border};
    border-radius:16px;
    padding:20px 22px;
    box-sizing:border-box;
    box-shadow:0 1px 3px rgba(0,0,0,.04);
  }
  .head{display:flex;align-items:center;gap:12px;}
  .avatar{width:48px;height:48px;border-radius:50%;object-fit:cover;flex:0 0 48px;background:${t.border};}
  .who{display:flex;flex-direction:column;line-height:1.25;min-width:0;}
  .name-row{display:flex;align-items:center;gap:4px;}
  .name{font-weight:700;font-size:16px;color:${t.fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .badge{color:${opts.accent};display:inline-flex;align-items:center;}
  .handle{font-size:14px;color:${t.sub};white-space:nowrap;}
  .text{
    margin-top:14px;
    font-size:20px;
    line-height:1.4;
    color:${t.fg};
    white-space:pre-wrap;
    word-wrap:break-word;
    overflow-wrap:break-word;
  }
  .foot{
    margin-top:14px;
    padding-top:12px;
    border-top:1px solid ${t.border};
    display:flex;align-items:center;gap:8px;
    font-size:13px;color:${t.sub};
  }
  .logo{color:${opts.accent};display:inline-flex;}
</style></head><body>
<div id="card">
  <div class="head">
    <img class="avatar" src="${esc(avatar)}" />
    <div class="who">
      <div class="name-row">
        <span class="name">${esc(opts.name)}</span>
        ${opts.verified ? `<span class="badge">${VERIFIED_BADGE}</span>` : ''}
      </div>
      <span class="handle">@${esc(opts.handle)}</span>
    </div>
  </div>
  <div class="text">${safeText}</div>
  <div class="foot">
    <span class="logo">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
    </span>
    <span>quote card</span>
  </div>
</div>
<script>document.documentElement.dataset.ready='1';</script>
</body></html>`;
}
//# sourceMappingURL=quote.template.js.map