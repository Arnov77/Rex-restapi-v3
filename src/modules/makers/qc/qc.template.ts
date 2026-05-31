export interface QcTemplateOptions {
  text: string;
  name: string;
  avatar?: string;
  theme: 'dark' | 'light';
  time: string;
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
}

const THEMES = {
  dark: {
    bubble:       '#1f2c34',
    tail:         '#1f2c34',
    senderName:   '#00a884',
    messageText:  '#e9edef',
    time:         'rgba(255,255,255,.38)',
    avatarBg:     '#2a3942',
    avatarIcon:   '#54656f',
  },
  light: {
    bubble:       '#ffffff',
    tail:         '#ffffff',
    senderName:   '#00a884',
    messageText:  '#111b21',
    time:         'rgba(0,0,0,.38)',
    avatarBg:     '#dfe5e7',
    avatarIcon:   '#b0bec5',
  },
} as const;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function defaultAvatar(theme: 'dark' | 'light'): string {
  const t = THEMES[theme];
  return `
  <svg class="avatar avatar-default" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
    <circle cx="18" cy="18" r="18" fill="${t.avatarBg}"/>
    <circle cx="18" cy="14" r="6" fill="${t.avatarIcon}"/>
    <ellipse cx="18" cy="30" rx="11" ry="8" fill="${t.avatarIcon}"/>
  </svg>`;
}

export function renderQcHtml(opts: QcTemplateOptions): string {
  const t = THEMES[opts.theme];

  const avatar = opts.avatar
    ? `<img class="avatar" src="${esc(opts.avatar)}" alt="avatar"/>`
    : defaultAvatar(opts.theme);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }

  #canvas {
    display: inline-flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
  }

  /* ── Avatar ── */
  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    object-fit: cover;
    flex-shrink: 0;
    align-self: flex-start;
  }

  .avatar-default {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    flex-shrink: 0;
    overflow: hidden;
  }

  /* ── Bubble ── */
  .bubble {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    gap: 3px;
    max-width: 520px;
    min-width: 80px;
    padding: 6px 12px 8px 14px;
    border-radius: 2px 12px 12px 12px;
    background: ${t.bubble};
    box-shadow: 0 2px 8px rgba(0,0,0,.15);
  }

  /* Tail kiri atas */
  .bubble::before {
    content: "";
    position: absolute;
    left: -8px;
    top: 0;
    width: 10px;
    height: 14px;
    background: ${t.tail};
    clip-path: polygon(100% 0, 0 0, 100% 100%);
  }

  /* ── Sender name ── */
  .sender-name {
    font-size: 13.5px;
    font-weight: 700;
    color: ${t.senderName};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
  }

  /* ── Message row ── */
  .message {
    display: inline-flex;
    align-items: flex-end;
    gap: 10px;
  }

  .message-text {
    font-size: 15px;
    font-weight: 400;
    color: ${t.messageText};
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .time {
    font-size: 11.5px;
    font-weight: 400;
    color: ${t.time};
    white-space: nowrap;
    align-self: flex-end;
    flex-shrink: 0;
    padding-bottom: 1px;
  }
</style>
</head>
<body>
<div id="canvas">
  ${avatar}
  <div class="bubble">
    <span class="sender-name">${esc(opts.name)}</span>
    <div class="message">
      <span class="message-text">${esc(opts.text)}</span>
      <span class="time">${esc(opts.time)}</span>
    </div>
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