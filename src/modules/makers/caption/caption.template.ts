export interface CaptionTemplateOptions {
  imageDataUri: string;
  captionText: string;
  position: 'top' | 'center' | 'bottom';
  textColor: string;
  strokeColor: string;
}



function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function renderMultiline(text: string): string {
  return text.split('\n').map(esc).join('<br/>');
}

export function renderCaptionHtml(opts: CaptionTemplateOptions): string {
  const vAlign =
    opts.position === 'top' ? 'flex-start' : opts.position === 'bottom' ? 'flex-end' : 'center';

  const translateY =
    opts.position === 'top'
      ? '0'
      : opts.position === 'center'
        ? '-5%'
        : '0';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
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
    max-width: 1600px;
    max-height: 1600px;
    width: auto;
    height: auto;
  }

  #overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: ${vAlign};
    justify-content: center;
    padding: 28px 40px;
    pointer-events: none;

    transform: translateY(${translateY})
  }

  .caption-text {
    font-family: "TikTok Sans", sans-serif;
    font-weight: 700;
    color: ${opts.textColor};

    text-align: center;

    line-height: 1.15;
    letter-spacing: 0;
    white-space: pre-wrap;
    word-break: normal;
    overflow-wrap: break-word;

    max-width: 88%;
    margin: 0 auto;
    
    text-shadow:
      1px  0   ${opts.strokeColor},
      -1px  0   ${opts.strokeColor},
      0    1px ${opts.strokeColor},
      0   -1px ${opts.strokeColor},
      1px  1px ${opts.strokeColor},
      -1px  1px ${opts.strokeColor},
      1px -1px ${opts.strokeColor},
      -1px -1px ${opts.strokeColor};
  }
</style>
</head>
<body>
<div id="canvas">
  <img id="img" src="${opts.imageDataUri}" alt=""/>
  <div id="overlay"><div class="caption-text" id="text">${renderMultiline(opts.captionText)}</div></div>
</div>

<script>
(async () => {
  const img = document.getElementById('img');
  await (img.complete ? Promise.resolve() : new Promise((resolve) => {
    img.addEventListener('load',  resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  }));

  if (document.fonts?.ready) await document.fonts.ready;

  const imgWidth = img.naturalWidth || img.offsetWidth || 500;
  const text = document.getElementById('text');
  const rawLen = text.textContent?.length || 1;
  const lengthFactor = rawLen > 120 ? 0.75 : rawLen > 60 ? 0.88 : 1;
  const fontSize = Math.max(
    20,
    Math.min(72, Math.round(imgWidth * 0.06 * lengthFactor))
  );
  text.style.fontSize = fontSize + 'px';

  document.documentElement.dataset.ready = '1';
})();
</script>
</body>
</html>`;
}
