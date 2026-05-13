const { withPage } = require('../../../shared/browser/browserManager');

const DEFAULT_AVATAR = 'https://i.ibb.co/dwTRp2SF/images-1.jpg';

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]
  );
}

async function generateQuoteImage(name, message, avatarUrl) {
  return withPage(async (page) => {
    const resolvedAvatar = avatarUrl?.trim() ? avatarUrl : DEFAULT_AVATAR;

    const html = `
      <html>
        <head>
          <style>
            html, body {
              margin: 0;
              padding: 0;
              display: inline-block;
            }
            body {
              margin: 0;
              padding: 40px;
              font-family: 'Segoe UI', sans-serif;
              background: rgba(255, 255, 255, 0);
            }
            .chat-container {
              display: flex;
              align-items: flex-start;
              max-width: 600px;
              padding-bottom: 60px;
            }
            .avatar {
              width: 60px;
              height: 60px;
              border-radius: 50%;
              object-fit: cover;
              margin-right: 12px;
              flex-shrink: 0;
            }
            .bubble {
              position: relative;
              background: rgb(255, 255, 255);
              border-radius: 0 24px 24px 24px;
              padding: 10px 14px;
              color: white;
              max-width: 80%;
              box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
            }
            .bubble::after {
              content: '';
              position: absolute;
              left: -10px;
              top: 0;
              width: 0;
              height: 0;
              border: 10px solid transparent;
              border-top-color: rgb(255, 255, 255);
              border-bottom: 0;
              border-right: 0;
              margin-bottom: -1px;
            }
            .name {
              font-weight: 600;
              font-size: 25px;
              margin-bottom: 4px;
              color: rgb(255, 136, 0);
            }
            .message {
              font-size: 25px;
              color: #111;
              white-space: pre-wrap;
              line-height: 1.5;
            }
          </style>
        </head>
        <body>
          <div class="chat-container">
            <img class="avatar" src="${escapeHtml(resolvedAvatar)}" />
            <div class="bubble">
              <div class="name">${escapeHtml(name)}</div>
              <div class="message">${escapeHtml(message)}</div>
            </div>
          </div>
        </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: 'networkidle' });
    const element = await page.$('.chat-container');
    return element.screenshot({ omitBackground: true });
  });
}

module.exports = { generateQuoteImage };
