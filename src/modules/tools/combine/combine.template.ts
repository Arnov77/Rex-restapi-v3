export interface CombineTemplateOptions {
  imageSrcs: string[];
  layout: number[];
  captionText?: string;
  position: 'top' | 'center' | 'bottom';
  rotation: number;
  textColor: string;
  strokeColor: string;
  gap: number;
  width: number;
  cellAspectRatio: number | number[];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function renderMultiline(text: string): string {
  return text.split('\n').map(esc).join('<br/>');
}

function chunkByLayout(imageSrcs: string[], layout: number[]): string[][] {
  const rows: string[][] = [];
  let cursor = 0;
  for (const count of layout) {
    rows.push(imageSrcs.slice(cursor, cursor + count));
    cursor += count;
  }
  return rows;
}

/** Fixed row height so images in that row crop uniformly via object-fit: cover. */
function rowHeight(colCount: number, canvasWidth: number, gap: number, aspect: number): number {
  const colWidth = (canvasWidth - gap * (colCount - 1)) / colCount;
  return Math.round(colWidth * aspect);
}

export function renderCombineHtml(opts: CombineTemplateOptions): string {
  const topPct = opts.position === 'top' ? '18%' : opts.position === 'bottom' ? '82%' : '50%';
  const rows = chunkByLayout(opts.imageSrcs, opts.layout);

  const rowsHtml = rows
      .map((row, i) => {
        const aspect = Array.isArray(opts.cellAspectRatio)
          ? (opts.cellAspectRatio[i] ?? opts.cellAspectRatio[opts.cellAspectRatio.length - 1] ?? 1)
          : opts.cellAspectRatio;
        const h = rowHeight(row.length, opts.width, opts.gap, aspect);
        return `<div class="row" style="height:${h}px">
          ${row.map((src) => `<img class="grid-img" src="${src}" alt=""/>`).join('\n')}
        </div>`;
      })
      .join('\n');

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
    width: ${opts.width}px;
    display: flex;
    flex-direction: column;
    gap: ${opts.gap}px;
    line-height: 0;
  }

  .row {
    display: flex;
    flex-direction: row;
    gap: ${opts.gap}px;
    width: 100%;
  }

  .grid-img {
    display: block;
    flex: 1 1 0;
    min-width: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  #banner-wrap {
    position: absolute;
    left: 0;
    top: ${topPct};
    width: 100%;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }

  #banner {
    transform: translateY(-50%) rotate(${opts.rotation}deg);
    transform-origin: center;
    width: 130%;
    text-align: center;
    padding: 10px 0;
  }

  .caption-text {
    font-family: 'TikTok Sans', Arial, sans-serif;
    font-weight: 800;
    text-align: center;
    color: ${opts.textColor};
    line-height: 1.3;
    letter-spacing: 0.2px;
    word-break: break-word;
    -webkit-text-stroke: 2px ${opts.strokeColor};
    text-shadow:
      2px  2px 0 ${opts.strokeColor},
     -2px  2px 0 ${opts.strokeColor},
      2px -2px 0 ${opts.strokeColor},
     -2px -2px 0 ${opts.strokeColor},
      0px  3px 0 ${opts.strokeColor},
      0px -3px 0 ${opts.strokeColor},
      3px  0px 0 ${opts.strokeColor},
     -3px  0px 0 ${opts.strokeColor};
  }
</style>
</head>
<body>
<div id="canvas">
  ${rowsHtml}
  ${opts.captionText ? `<div id="banner-wrap">
    <div id="banner">
      <div class="caption-text" id="text">${renderMultiline(opts.captionText)}</div>
    </div>
  </div>` : ''}
</div>

<script>
(async () => {
  const imgs = Array.from(document.querySelectorAll('.grid-img'));
  await Promise.all(imgs.map((img) =>
    img.complete ? Promise.resolve() : new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }),
  ));

  if (document.fonts?.ready) await document.fonts.ready;

  const text = document.getElementById('text');
  if (text) {
    const canvasWidth = document.getElementById('canvas').offsetWidth || ${opts.width};
    const rawLen = text.textContent?.length || 1;
    const lengthFactor = rawLen > 90 ? 0.7 : rawLen > 50 ? 0.85 : 1;
    const fontSize = Math.max(16, Math.min(52, Math.round(canvasWidth * 0.065 * lengthFactor)));
    text.style.fontSize = fontSize + 'px';
  }

  document.documentElement.dataset.ready = '1';
})();
</script>
</body>
</html>`;
}