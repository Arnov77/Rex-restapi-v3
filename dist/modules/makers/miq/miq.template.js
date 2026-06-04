const CANVAS = {
    landscape: { width: 1200, height: 630 },
    portrait: { width: 630, height: 840 },
};
function esc(s) {
    return s.replace(/[&<>"']/g, (c) => c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
}
export function renderMiqHtml(opts) {
    const { width, height } = CANVAS[opts.orientation];
    const grayscale = opts.image_filter === 'grayscale' ? 'filter:grayscale(1);' : '';
    const landscape = opts.orientation === 'landscape';
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap" rel="stylesheet"/>
<style>
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
        : 'linear-gradient(to bottom, transparent 40%, #000 100%)'};
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
    ${!landscape ? `<div class="quote-marks">\u201C \u201D</div>` : ''}
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
  document.documentElement.dataset.ready = '1';
})();
</script>
</body>
</html>`;
}
//# sourceMappingURL=miq.template.js.map