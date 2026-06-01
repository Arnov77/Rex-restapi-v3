const CANVAS = {
    width: 736,
    height: 1308,
    bottomPadding: 92,
    left: 28,
    maxStackWidth: 640,
};
const UI = {
    reactionGap: 12,
    menuGap: 18,
    bubbleMaxWidth: 540,
    menuWidth: 510,
};
const TYPE_PRESETS = {
    chat: {
        bg: 'classic',
        bubbleFont: 26,
        menu: ['Beri Bintang', 'Balas', 'Teruskan', 'Salin', 'Sematkan', 'Laporkan', 'Hapus'],
        reactions: ['👍', '❤️', '😂', '😮', '😢', '🙏', '👏'],
    },
    sticker: {
        bg: 'green',
        bubbleFont: 22,
        menu: ['Beri Bintang', 'Balas', 'Teruskan', 'Salin', 'Sematkan', 'Laporkan', 'Hapus'],
        reactions: ['👍', '❤️', '😂', '😮', '😢', '🙏', '👏'],
    },
    media: {
        bg: 'sad',
        bubbleFont: 22,
        menu: ['Beri Bintang', 'Balas', 'Teruskan', 'Salin', 'Sematkan', 'Laporkan', 'Hapus'],
        reactions: ['👍', '❤️', '😂', '😮', '😢', '🙏', '👏'],
    },
};
function esc(s) {
    return s.replace(/[&<>"']/g, (c) => c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
}
function iconSvg(label) {
    const key = label.toLowerCase();
    if (key.includes('bintang')) {
        return `<svg viewBox="0 0 32 32"><path d="M16 3.5l3.8 7.7 8.5 1.2-6.1 6 1.4 8.4-7.6-4-7.6 4 1.4-8.4-6.1-6 8.5-1.2L16 3.5z"/></svg>`;
    }
    if (key.includes('balas')) {
        return `<svg viewBox="0 0 32 32"><path d="M13.5 9L5.5 16l8 7"/><path d="M6.5 16h12c5 0 8 3 8 8v1"/></svg>`;
    }
    if (key.includes('terus')) {
        return `<svg viewBox="0 0 32 32"><path d="M18.5 9l8 7-8 7"/><path d="M25.5 16h-12c-5 0-8 3-8 8v1"/></svg>`;
    }
    if (key.includes('salin')) {
        return `<svg viewBox="0 0 32 32"><path d="M12 11h12v16H12z"/><path d="M8 21H6V5h12v2"/><path d="M18 11V7h-8v16h2"/></svg>`;
    }
    if (key.includes('semat')) {
        return `<svg viewBox="0 0 32 32"><path d="M12 4h8"/><path d="M14 4v7l-4 4h12l-4-4V4"/><path d="M16 15v13"/><path d="M12 28h8"/></svg>`;
    }
    if (key.includes('lapor')) {
        return `<svg viewBox="0 0 32 32"><path d="M16 4l13 23H3L16 4z"/><path d="M16 12v7"/><path d="M16 23.8v.2"/></svg>`;
    }
    if (key.includes('hapus')) {
        return `<svg viewBox="0 0 32 32"><path d="M6 8h20"/><path d="M12 8V5h8v3"/><path d="M9 8l1.2 19h11.6L23 8"/><path d="M14 13v10"/><path d="M18 13v10"/></svg>`;
    }
    return `<svg viewBox="0 0 32 32"><path d="M16 7v18"/><path d="M7 16h18"/></svg>`;
}
export function renderIqcHtml(opts) {
    const preset = TYPE_PRESETS[opts.type];
    const safeMessage = esc(opts.text ?? '');
    const mediaTime = opts.type === 'sticker' || opts.type === 'media'
        ? `<div class="media-time">${esc(opts.time)}</div>`
        : '';
    const sticker = opts.type === 'sticker' && opts.media
        ? `
        <div class="media-group">
          <div class="sticker-box">
            <img class="sticker-img" src="${esc(opts.media)}" alt="sticker"/>
          </div>
          ${mediaTime}
        </div>
      `
        : '';
    const media = opts.type === 'media' && opts.media
        ? `
        <div class="media-group">
          <div class="media-box">
            <img class="media-img" src="${esc(opts.media)}" alt="media"/>
          </div>
          ${mediaTime}
        </div>
      `
        : '';
    const bubble = opts.type === 'chat'
        ? `<div class="bubble">${safeMessage}<span class="time">${esc(opts.time)}</span></div>`
        : safeMessage
            ? `<div class="bubble caption">${safeMessage}</div>`
            : '';
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  html,body{margin:0;padding:0;background:transparent;}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased;
    text-rendering:geometricPrecision;
  }

  #canvas{
    position:relative;
    width:${CANVAS.width}px;
    height:${CANVAS.height}px;
    overflow:hidden;
    background:#0b0f0f;
    color:#fff;
    isolation:isolate;
  }

  .bg{
    position:absolute;
    inset:-24px;
    z-index:0;
    filter:blur(21px) saturate(1.08) brightness(.58);
    transform:scale(1.08);
    opacity:.98;
  }

  .bg::before,
  .bg::after{
    content:"";
    position:absolute;
    inset:0;
  }

  .bg::before{
    background:
      radial-gradient(ellipse at 75% 13%, rgba(0,168,105,.48) 0 11%, transparent 22%),
      radial-gradient(ellipse at 33% 25%, rgba(20,23,24,.96) 0 20%, transparent 36%),
      radial-gradient(ellipse at 37% 49%, rgba(185,176,136,.30) 0 12%, transparent 22%),
      radial-gradient(ellipse at 78% 63%, rgba(0,168,105,.38) 0 12%, transparent 23%),
      radial-gradient(ellipse at 62% 83%, rgba(0,168,105,.34) 0 12%, transparent 24%),
      linear-gradient(180deg,#0b0f10 0%,#101514 50%,#080b0b 100%);
  }

  .bg::after{
    background:
      linear-gradient(180deg, transparent 0 12%, rgba(0,0,0,.28) 12% 28%, transparent 28% 100%),
      radial-gradient(ellipse at 83% 5%, rgba(210,225,220,.35) 0 4%, transparent 10%);
    opacity:.9;
  }

  .bg.green::before{
    background:
      radial-gradient(ellipse at 74% 15%, rgba(0,170,105,.55) 0 12%, transparent 24%),
      radial-gradient(ellipse at 32% 30%, rgba(17,19,20,.98) 0 20%, transparent 34%),
      radial-gradient(ellipse at 78% 64%, rgba(0,180,112,.46) 0 13%, transparent 25%),
      radial-gradient(ellipse at 62% 86%, rgba(0,180,112,.40) 0 13%, transparent 25%),
      linear-gradient(180deg,#0a1010 0%,#101716 52%,#090d0d 100%);
  }

  .bg.sad::before{
    background:
      radial-gradient(ellipse at 55% 15%, rgba(218,222,190,.24) 0 10%, transparent 24%),
      radial-gradient(ellipse at 64% 46%, rgba(214,202,164,.25) 0 11%, transparent 21%),
      radial-gradient(ellipse at 31% 36%, rgba(21,24,25,.95) 0 22%, transparent 38%),
      radial-gradient(ellipse at 77% 68%, rgba(0,150,103,.25) 0 12%, transparent 25%),
      linear-gradient(180deg,#0c1111 0%,#121716 50%,#090c0c 100%);
  }

  .dim{
    position:absolute;
    inset:0;
    z-index:1;
    background:
      linear-gradient(180deg,rgba(0,0,0,.17),rgba(0,0,0,.35)),
      radial-gradient(ellipse at center,transparent 0 42%,rgba(0,0,0,.18) 100%);
  }

  .stack{
    position:absolute;
    left:${CANVAS.left}px;
    bottom:${CANVAS.bottomPadding}px;
    z-index:3;
    width:${CANVAS.maxStackWidth}px;
    display:flex;
    flex-direction:column;
    align-items:flex-start;
  }

  .reaction{
    display:inline-flex;
    align-items:center;
    gap:6px;
    height:84px;
    max-width:${CANVAS.maxStackWidth}px;
    box-sizing:border-box;
    padding:0 12px 0 18px;
    margin-bottom:${UI.reactionGap}px;
    border-radius:999px;
    background:rgba(30,33,33,.92);
    border:1px solid rgba(255,255,255,.045);
    -webkit-backdrop-filter:blur(26px) saturate(1.15);
    backdrop-filter:blur(26px) saturate(1.15);
    box-shadow:0 14px 34px rgba(0,0,0,.26);
    font-size:46px;
    line-height:1;
    position:relative;
  }

  .reaction .emoji{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    position:relative;
    z-index:1;
    width:54px;
    height:54px;
    filter:drop-shadow(0 1px 2px rgba(0,0,0,.22));
  }

  .reaction .emoji.last{
    margin-right:0;
    z-index:1;
  }

  .reaction .plus{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    position:relative;
    z-index:4;
    width:54px;
    height:54px;
    margin-left:-26px;
    border-radius:999px;
    background:rgba(108,114,120,1);
    color:rgba(236,240,244,.95);
    font-size:40px;
    font-weight:300;
    line-height:1;
    box-shadow:
      -14px 0 22px 6px rgba(0,0,0,.90),
      inset 0 1px 0 rgba(255,255,255,.10);
    border:1px solid rgba(255,255,255,.10);
  }

  .bubble-wrap{
    width:fit-content;
    max-width:min(100%, ${UI.bubbleMaxWidth}px);
    margin-bottom:${UI.menuGap}px;
  }

  .bubble{
    position:relative;
    display:inline-block;
    width:fit-content;
    max-width:100%;
    box-sizing:border-box;
    min-height:54px;
    padding:12px 88px 12px 19px;
    border-radius:17px;
    background:rgba(28,31,31,.88);
    color:#fff;
    -webkit-backdrop-filter:blur(18px) saturate(1.08);
    backdrop-filter:blur(18px) saturate(1.08);
    box-shadow:0 10px 24px rgba(0,0,0,.17);
    font-size:${preset.bubbleFont}px;
    font-weight:500;
    letter-spacing:-.35px;
    line-height:1.18;
    white-space:pre-wrap;
    overflow-wrap:anywhere;
    word-break:normal;
  }

  .bubble::before{
    content:"";
    position:absolute;
    left:-5px;
    bottom:0;
    width:14px;
    height:16px;
    background:rgba(28,31,31,.88);
    clip-path:polygon(100% 0,0 100%,100% 100%);
    -webkit-backdrop-filter:blur(18px);
    backdrop-filter:blur(18px);
  }

  .bubble.caption{
    margin-top:10px;
    padding-right:19px;
    font-size:${Math.max(17, preset.bubbleFont - 3)}px;
  }

  .time{
    position:absolute;
    right:15px;
    bottom:10px;
    font-size:15px;
    font-weight:500;
    letter-spacing:-.1px;
    color:rgba(255,255,255,.42);
    white-space:nowrap;
  }

  .media-group{
    display:flex;
    flex-direction:column;
    align-items:flex-start;
    width:fit-content;
  }

  .media-time{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    height:38px;
    margin-top:8px;
    margin-left:8px;
    padding:0 16px;
    border-radius:16px;
    background:rgba(24,27,27,.82);
    color:rgba(255,255,255,.78);
    border:1px solid rgba(255,255,255,.03);
    -webkit-backdrop-filter:blur(18px) saturate(1.08);
    backdrop-filter:blur(18px) saturate(1.08);
    box-shadow:0 8px 18px rgba(0,0,0,.18);
    font-size:16px;
    font-weight:500;
    letter-spacing:-.15px;
    line-height:1;
  }

  .sticker-box{
    display:flex;
    align-items:center;
    justify-content:center;
    width:280px;
    min-height:220px;
    padding:12px;
    box-sizing:border-box;
    border-radius:24px;
    background:rgba(255,255,255,.035);
    -webkit-backdrop-filter:blur(10px);
    backdrop-filter:blur(10px);
  }

  .sticker-img{
    display:block;
    max-width:250px;
    max-height:250px;
    object-fit:contain;
    filter:drop-shadow(0 8px 18px rgba(0,0,0,.32));
  }

  .media-box{
    overflow:hidden;
    max-width:330px;
    max-height:330px;
    border-radius:22px;
    background:rgba(255,255,255,.05);
    box-shadow:0 10px 24px rgba(0,0,0,.18);
  }

  .media-img{
    display:block;
    width:330px;
    height:330px;
    object-fit:cover;
  }

  .menu{
    width:${UI.menuWidth}px;
    overflow:hidden;
    border-radius:24px;
    background:rgba(37,40,39,.76);
    border:1px solid rgba(255,255,255,.045);
    -webkit-backdrop-filter:blur(28px) saturate(1.22);
    backdrop-filter:blur(28px) saturate(1.22);
    box-shadow:0 22px 44px rgba(0,0,0,.26);
  }

  .menu-row{
    position:relative;
    display:flex;
    align-items:center;
    justify-content:space-between;
    height:80px;
    padding:0 40px 0 31px;
    box-sizing:border-box;
    color:rgba(255,255,255,.92);
    font-size:29px;
    font-weight:400;
    letter-spacing:-.55px;
  }

  .menu-row:not(:last-child)::after{
    content:"";
    position:absolute;
    left:0;
    right:0;
    bottom:0;
    height:1px;
    background:rgba(255,255,255,.062);
  }

  .menu-row.danger{
    color:#ff6077;
  }

  .menu-row svg{
    width:34px;
    height:34px;
    fill:none;
    stroke:currentColor;
    stroke-width:2.25;
    stroke-linecap:round;
    stroke-linejoin:round;
    opacity:.97;
  }

  .home-indicator{
    position:absolute;
    left:50%;
    bottom:12px;
    z-index:4;
    transform:translateX(-50%);
    width:134px;
    height:5px;
    border-radius:999px;
    background:rgba(255,255,255,.82);
  }
</style>
</head>
<body>
<div id="canvas">
  <div class="bg ${preset.bg}"></div>
  <div class="dim"></div>

  <div class="stack" id="stack">
    <div class="reaction">
      ${preset.reactions
        .map((r, i) => {
        const last = i === preset.reactions.length - 1 ? ' last' : '';
        return `<span class="emoji${last}">${esc(r)}</span>`;
    })
        .join('')}
      <span class="plus">+</span>
    </div>

    <div class="bubble-wrap">
      ${sticker}
      ${media}
      ${bubble}
    </div>

    <div class="menu">
      ${preset.menu
        .map((item) => {
        const danger = item.toLowerCase().includes('hapus') ? ' danger' : '';
        return `<div class="menu-row${danger}"><span>${esc(item)}</span>${iconSvg(item)}</div>`;
    })
        .join('')}
    </div>
  </div>

  <div class="home-indicator"></div>
</div>

<script>
(async () => {
  const imgs = Array.from(document.images || []);
  await Promise.all(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  })));

  const stack = document.getElementById('stack');
  const rect = stack.getBoundingClientRect();

  // Fixed output size, but the whole stack moves upward if content gets taller.
  const bottomPadding = ${CANVAS.bottomPadding};
  const minTop = 42;
  const desiredTop = Math.max(minTop, ${CANVAS.height} - bottomPadding - rect.height);

  stack.style.top = desiredTop + 'px';
  stack.style.bottom = 'auto';

  document.documentElement.dataset.ready = '1';
})();
</script>
</body>
</html>`;
}
//# sourceMappingURL=iqc.template.js.map