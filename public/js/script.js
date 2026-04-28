const BASE_URL = window.location.origin || 'http://localhost:7860';
document.getElementById('baseUrl').textContent = BASE_URL;

function tick() {
  const time = new Date().toLocaleTimeString('id-ID');
  const desktopClock = document.getElementById('clock');
  const mobileClock = document.getElementById('mclock');
  if (desktopClock) desktopClock.textContent = time;
  if (mobileClock) mobileClock.textContent = time;
}

tick();
setInterval(tick, 1000);

const ICONS = {
  Downloader: 'DL',
  Sticker: 'STK',
  'Image Generator': 'IMG',
  Utilities: 'UTIL',
  Minecraft: 'MC',
  Status: 'OK',
};

let DATA = {};
let currentApi = null;
let activeTab = 'docs';
let selectedPreset = 'bratdeluxe';
let selectedOption = 'hitam';

fetch('data/apis.json')
  .then((response) => response.json())
  .then((data) => {
    DATA = data;
    const total = Object.values(data).reduce((sum, apis) => sum + apis.length, 0);
    document.getElementById('totalEp').textContent = total;
    document.getElementById('totalCat').textContent = Object.keys(data).length;
    buildNav(data);
    renderAll(data);
    document.getElementById('searchInput').addEventListener('input', (event) => {
      doSearch(event.target.value);
    });
  });

function buildNav(data) {
  const nav = document.getElementById('navItems');
  const total = Object.values(data).reduce((sum, apis) => sum + apis.length, 0);

  let html = `<a class="nav-item active" onclick="showAll(this)" href="#">
    <span class="nav-icon">ALL</span><span>Semua</span>
    <span class="nav-count">${total}</span>
  </a>`;

  Object.entries(data).forEach(([category, apis]) => {
    const icon = ICONS[category] || 'API';
    html += `<a class="nav-item" onclick="showCat('${category}', this)" href="#${slugify(category)}">
      <span class="nav-icon">${icon}</span><span>${category}</span>
      <span class="nav-count">${apis.length}</span>
    </a>`;
  });

  nav.innerHTML = html;
}

function slugify(value) {
  return value.toLowerCase().replace(/\s+/g, '-');
}

function showAll(element) {
  setActive(element);
  document.getElementById('activeTitle').textContent = 'Semua Endpoint';
  renderAll(DATA);
  if (window.innerWidth <= 768) closeMobileMenu();
}

function showCat(category, element) {
  setActive(element);
  document.getElementById('activeTitle').textContent = category;
  document.getElementById('mainContent').innerHTML = renderSection(category, DATA[category]);
  setTimeout(() => {
    document.getElementById(slugify(category))?.scrollIntoView({ behavior: 'smooth' });
  }, 50);
  if (window.innerWidth <= 768) closeMobileMenu();
}

function setActive(element) {
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
  if (element) element.classList.add('active');
}

function doSearch(query) {
  if (!query.trim()) {
    renderAll(DATA);
    return;
  }

  const normalized = query.toLowerCase();
  const filtered = {};

  Object.entries(DATA).forEach(([category, apis]) => {
    const matches = apis.filter((api) =>
      api.name.toLowerCase().includes(normalized) ||
      (api.description || '').toLowerCase().includes(normalized) ||
      api.action.toLowerCase().includes(normalized)
    );

    if (matches.length) filtered[category] = matches;
  });

  renderAll(filtered);
}

function renderAll(data) {
  document.getElementById('mainContent').innerHTML = Object.entries(data)
    .map(([category, apis]) => renderSection(category, apis))
    .join('');
}

function renderSection(category, apis) {
  const icon = ICONS[category] || 'API';
  return `<div class="section" id="${slugify(category)}">
    <div class="section-head">
      <div class="section-icon">${icon}</div>
      <div class="section-info">
        <div class="title">${category}</div>
        <div class="sub">Klik endpoint untuk dokumentasi dan uji coba</div>
      </div>
      <div class="ep-count">${apis.length} endpoints</div>
    </div>
    ${apis.map((api) => renderCard(api)).join('')}
  </div>`;
}

function renderCard(api) {
  const methodClass = api.method === 'GET' ? 'm-get' : 'm-post';
  const path = api.action.split('?')[0];

  return `<div class="api-card" onclick="openModal(${esc(api)})">
    <div class="card-row">
      <span class="mtag ${methodClass}">${api.method}</span>
      <div class="card-info">
        <div class="card-title">${api.name}</div>
        <div class="card-desc">${api.description || ''}</div>
        <div class="card-path">${path}</div>
      </div>
      <button class="test-btn" onclick="event.stopPropagation(); openModal(${esc(api)})">Buka</button>
    </div>
    <div class="params-chips">${buildChips(api)}</div>
  </div>`;
}

function buildChips(api) {
  if (!api.params || api.params.length === 0) {
    return '<span class="no-params">Tidak ada parameter</span>';
  }

  return api.params.map((param) => {
    const requiredBadge = param.required === false
      ? '<span class="chip-opt">opsional</span>'
      : '<span class="chip-req">wajib</span>';
    const typeBadge = param.type === 'select'
      ? '<span class="chip-sel">select</span>'
      : `<span class="chip-type">${param.type || 'string'}</span>`;
    return `<div class="chip"><span class="chip-name">${param.name}</span>${typeBadge}${requiredBadge}</div>`;
  }).join('');
}

function esc(object) {
  return JSON.stringify(object).replace(/"/g, '&quot;');
}

function openModal(api) {
  currentApi = api;
  activeTab = 'docs';
  selectedPreset = 'bratdeluxe';
  selectedOption = 'hitam';

  const methodClass = api.method === 'GET' ? 'm-get' : 'm-post';
  document.getElementById('mName').textContent = api.name;

  const methodTag = document.getElementById('mMethod');
  methodTag.textContent = api.method;
  methodTag.className = `mtag ${methodClass}`;

  document.getElementById('mPath').textContent = api.action.split('?')[0];
  document.getElementById('mDesc').textContent = api.description || '';

  buildTabs(api);
  document.getElementById('overlay').classList.add('open');
  document.getElementById('overlay').onclick = (event) => {
    if (event.target === document.getElementById('overlay')) closeModal();
  };
}

function closeModal() {
  document.getElementById('overlay').classList.remove('open');
  currentApi = null;
}

function buildTabs(api) {
  const isGet = api.method === 'GET';
  const tabs = isGet ? ['docs'] : ['docs', 'try', 'code'];
  const labels = {
    docs: 'Dokumentasi',
    try: 'Coba Langsung',
    code: 'Kode Integrasi',
  };

  document.getElementById('tabRow').innerHTML = tabs.map((tab) =>
    `<div class="tab ${tab === activeTab ? 'active' : ''}" onclick="switchTab('${tab}')">${labels[tab]}</div>`
  ).join('');

  renderTabBody(api, activeTab);
}

function switchTab(tab) {
  activeTab = tab;
  buildTabs(currentApi);
}

function renderTabBody(api, tab) {
  const body = document.getElementById('tabBody');
  if (tab === 'docs') body.innerHTML = buildDocsTab(api);
  if (tab === 'try') body.innerHTML = buildTryTab(api);
  if (tab === 'code') body.innerHTML = buildCodeTab(api);
}

function buildDocsTab(api) {
  const isGet = api.method === 'GET';
  const supportsFile = (api.params || []).some((param) => param.type === 'file');

  let paramSection = '';
  if (api.params && api.params.length > 0) {
    const rows = api.params.map((param) => {
      const required = param.required === false
        ? '<span class="popt">opsional</span>'
        : '<span class="preq">wajib</span>';
      const type = param.type === 'select' ? 'select (string)' : (param.type || 'string');
      const description = param.description || getParamDesc(param.name);
      const example = param.example ? `<div class="pexample">Contoh: ${param.example}</div>` : '';

      return `<tr>
        <td><span class="pname">${param.name}</span></td>
        <td><span class="ptype-badge">${type}</span></td>
        <td>${required}</td>
        <td><span class="pdesc">${description}</span>${example}</td>
      </tr>`;
    }).join('');

    paramSection = `<div style="margin-bottom:18px">
      <div class="section-sub-label">Parameter</div>
      <table class="param-table">
        <thead><tr><th>Nama</th><th>Tipe</th><th>Status</th><th>Keterangan</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  } else {
    paramSection = `<div style="margin-bottom:18px">
      <div class="info-box">Endpoint ini tidak membutuhkan parameter.</div>
    </div>`;
  }

  const reqBody = buildRequestBodyExample(api);
  const requestLabel = supportsFile ? 'Request Body (multipart/form-data atau JSON)' : 'Request Body (JSON)';
  const reqSection = reqBody ? `<div style="margin-bottom:18px">
    <div class="section-sub-label">${requestLabel}</div>
    <div class="response-schema">${reqBody}</div>
  </div>` : '';

  const responseExample = buildResponseExample(api);
  const getBtn = isGet
    ? `<div style="margin-top:16px"><button class="get-open-btn" onclick="window.open('${api.action}','_blank')">Buka Endpoint di Browser</button></div>`
    : '';

  return `${paramSection}${reqSection}
  <div style="margin-bottom:0">
    <div class="section-sub-label">Contoh Response</div>
    <div class="response-schema">${responseExample}</div>
  </div>
  ${getBtn}`;
}

function buildTryTab(api) {
  const isBrat = api.name.toLowerCase().includes('brat');
  const isReplicate = api.action === '/api/replicate/generate';
  const isTelegramSticker = api.action === '/api/telegram/sticker';

  let fields = '';
  if (api.params) {
    api.params.forEach((param) => {
      if (isBrat && ['bgColor', 'textColor', 'preset'].includes(param.name)) return;

      const required = param.required === false
        ? '<span class="chip-opt" style="font-size:10px">opsional</span>'
        : '<span class="chip-req" style="font-size:10px">wajib</span>';
      const hint = param.example || `masukkan ${param.name}`;
      const inputType = param.type === 'file'
        ? 'file'
        : ['url', 'image', 'avatarUrl', 'skin'].includes(param.name) ? 'url' : 'text';
      const description = param.description || getParamDesc(param.name);

      let control;
      if (param.type === 'select' && Array.isArray(param.options)) {
        const defaultValue = param.default ?? param.example ?? param.options[0];
        const opts = param.options
          .map((opt) => `<option value="${opt}"${opt === defaultValue ? ' selected' : ''}>${opt}</option>`)
          .join('');
        control = `<select class="form-input" id="f-${param.name}">${opts}</select>`;
      } else {
        control = `<input type="${inputType}" class="form-input" id="f-${param.name}" ${inputType === 'file' ? 'accept="image/*"' : `placeholder="${hint}"`}>`;
      }

      fields += `<div class="form-section">
        <div class="form-label"><span class="form-label-text">${param.name}</span>${required}</div>
        ${control}
        ${description ? `<div class="form-hint">${description}</div>` : ''}
      </div>`;
    });
  }

  let extra = '';

  if (isBrat) {
    extra = `<div class="form-section">
      <div class="form-label"><span class="form-label-text">preset</span><span class="chip-opt" style="font-size:10px">opsional</span></div>
      <div class="preset-row">
        <div class="preset-btn sel" onclick="selPreset('bratdeluxe', this)">bratdeluxe</div>
        <div class="preset-btn" onclick="selPreset('brat', this)">brat</div>
        <div class="preset-btn" onclick="selPreset('custom', this)">custom</div>
      </div>
    </div>
    <div id="colorWrap" style="display:none">
      <div class="form-section">
        <div class="form-label"><span class="form-label-text">bgColor</span><span class="chip-opt" style="font-size:10px">color</span></div>
        <div class="color-row">
          <input type="color" class="color-pick" id="f-bgColor-pick" value="#e4ff3d" onchange="syncC('bgColor')">
          <div class="color-text-wrap"><input type="text" class="form-input" id="f-bgColor" value="#e4ff3d" placeholder="#e4ff3d" oninput="syncP('bgColor')"></div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-label"><span class="form-label-text">textColor</span><span class="chip-opt" style="font-size:10px">color</span></div>
        <div class="color-row">
          <input type="color" class="color-pick" id="f-textColor-pick" value="#000000" onchange="syncC('textColor')">
          <div class="color-text-wrap"><input type="text" class="form-input" id="f-textColor" value="#000000" placeholder="#000000" oninput="syncP('textColor')"></div>
        </div>
      </div>
    </div>`;
  }

  if (isReplicate) {
    extra = `<div class="form-section">
      <div class="form-label"><span class="form-label-text">option</span><span class="chip-req" style="font-size:10px">wajib</span></div>
      <div class="preset-row">
        <div class="preset-btn sel" onclick="selOpt('hitam', this)">hitam</div>
        <div class="preset-btn" onclick="selOpt('nerd', this)">nerd</div>
      </div>
      <input type="hidden" id="f-option" value="hitam">
    </div>`;
  }

  if (isTelegramSticker) {
    extra = `<div class="form-section">
      <div class="form-label"><span class="form-label-text">format</span><span class="chip-opt" style="font-size:10px">opsional</span></div>
      <div class="preset-row">
        <div class="preset-btn sel" onclick="selFormat('png', this)">png</div>
        <div class="preset-btn" onclick="selFormat('jpg', this)">jpg</div>
        <div class="preset-btn" onclick="selFormat('gif', this)">gif</div>
        <div class="preset-btn" onclick="selFormat('webp', this)">webp</div>
        <div class="preset-btn" onclick="selFormat('wa', this)">wa *</div>
      </div>
      <input type="hidden" id="f-format" value="png">
      <div class="form-hint">Format "wa" cocok untuk stiker WhatsApp dalam ukuran 512x512.</div>
    </div>`;
  }

  return `${fields}${extra}
  <div class="modal-actions">
    <button class="btn-cancel" onclick="closeModal()">Tutup</button>
    <button class="btn-primary" id="sendBtn" onclick="sendReq()">Kirim Request</button>
  </div>
  <div id="responseArea"></div>`;
}

function buildCodeTab(api) {
  const endpoint = api.action.split('?')[0];
  const sampleBody = buildSampleBody(api);
  const bodyString = JSON.stringify(sampleBody, null, 2);
  const isGet = api.method === 'GET';
  const supportsFile = (api.params || []).some((param) => param.type === 'file');
  const isTelegramSticker = endpoint === '/api/telegram/sticker';
  const isTelegramStickerPack = endpoint === '/api/telegram/sticker-pack';
  const isTelegramStickerDownload = endpoint === '/api/telegram/sticker-pack/download';

  let curl;
  let fetchCode;
  let axiosCode;
  let pythonCode;

  if (isTelegramStickerDownload) {
    curl = `# Single pack (\u2264 30 stiker) -> .wasticker langsung
curl -X POST ${BASE_URL}${endpoint} \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://t.me/addstickers/KOSHAKIEBANIYE"}' \\
  --output pack.wasticker

# Multi-part (> 30 stiker) -> .zip berisi N file .wasticker
curl -X POST ${BASE_URL}${endpoint} \\
  -H "Content-Type: application/json" \\
  -d '{"packName":"KOSHAKIEBANIYE","stickersPerPack":30}' \\
  --output pack.zip`;

    fetchCode = `// Auto-download .wasticker / .zip ke perangkat user
const res = await fetch('${BASE_URL}${endpoint}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://t.me/addstickers/KOSHAKIEBANIYE',
    publisher: 'Rex API',
    author: 'Converted via Rex REST API',
    stickersPerPack: 30,
  }),
});
const blob = await res.blob();
const filename = (res.headers.get('content-disposition') || '')
  .match(/filename="?([^"\\;]+)/)?.[1] || 'pack.wasticker';
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = filename;
a.click();`;

    axiosCode = `import axios from 'axios';

const res = await axios.post('${BASE_URL}${endpoint}', {
  url: 'https://t.me/addstickers/KOSHAKIEBANIYE',
  publisher: 'Rex API',
  author: 'Converted via Rex REST API',
}, { responseType: 'arraybuffer' });

console.log('parts:', res.headers['x-sticker-parts']);
console.log('stickers:', res.headers['x-sticker-count']);
// res.data -> Buffer (.wasticker atau .zip)`;

    pythonCode = `import re, requests

r = requests.post(
    '${BASE_URL}${endpoint}',
    json={'url': 'https://t.me/addstickers/KOSHAKIEBANIYE'},
    timeout=180,
)
r.raise_for_status()

cd = r.headers.get('content-disposition', '')
m = re.search(r'filename="?([^";]+)', cd)
filename = m.group(1) if m else 'pack.wasticker'
with open(filename, 'wb') as f:
    f.write(r.content)

print('parts:', r.headers.get('x-sticker-parts'))
print('stickers:', r.headers.get('x-sticker-count'))`;
  } else if (isTelegramSticker) {
    curl = `# Menggunakan file_id
curl -X POST ${BASE_URL}${endpoint} \\
  -H "Content-Type: application/json" \\
  -d '{"fileId":"CAACAgIAAxkBAAEK...","format":"wa"}' \\
  --output sticker.webp

# Menggunakan URL langsung
curl -X POST ${BASE_URL}${endpoint} \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com/sticker.webp","format":"png"}' \\
  --output sticker.png`;

    fetchCode = `// Konversi stiker Telegram ke format WA
const res = await fetch('${BASE_URL}${endpoint}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fileId: 'CAACAgIAAxkBAAEK...', format: 'wa' })
});
const buffer = Buffer.from(await res.arrayBuffer());`;

    axiosCode = `import axios from 'axios';

const res = await axios.post('${BASE_URL}${endpoint}', {
  fileId: 'CAACAgIAAxkBAAEK...',
  botToken: 'OPTIONAL_TOKEN',
  format: 'wa'
}, { responseType: 'arraybuffer' });

const buffer = Buffer.from(res.data);
// res.headers['content-type'] -> image/webp atau image/gif
// res.headers['x-sticker-type'] -> webp | tgs | webm`;

    pythonCode = `import requests

r = requests.post(
    '${BASE_URL}${endpoint}',
    json={
        'fileId': 'CAACAgIAAxkBAAEK...',
        'format': 'wa'
    },
    timeout=60
)

ext = r.headers.get('content-type', '').split('/')[-1] or 'png'
with open(f'sticker.{ext}', 'wb') as f:
    f.write(r.content)

print('Tipe stiker:', r.headers.get('x-sticker-type'))`;
  } else if (isTelegramStickerPack) {
    curl = `curl -X POST ${BASE_URL}${endpoint} \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://t.me/addstickers/KOSHAKIEBANIYE"}'`;

    fetchCode = `const response = await fetch('${BASE_URL}${endpoint}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://t.me/addstickers/KOSHAKIEBANIYE' })
});
const data = await response.json();
console.log(data);`;

    axiosCode = `import axios from 'axios';

const res = await axios.post('${BASE_URL}${endpoint}', {
  url: 'https://t.me/addstickers/KOSHAKIEBANIYE'
});
console.log(res.data);`;

    pythonCode = `import requests

response = requests.post(
    '${BASE_URL}${endpoint}',
    json={'url': 'https://t.me/addstickers/KOSHAKIEBANIYE'}
)
print(response.json())`;
  } else if (supportsFile) {
    curl = `curl -X POST ${BASE_URL}${endpoint} \\
  -F "text=contoh quote" \\
  -F "author=Anonymous" \\
  -F "avatar=@avatar.png"`;

    fetchCode = `const form = new FormData();
form.append('text', 'contoh quote');
form.append('author', 'Anonymous');
form.append('avatar', fileInput.files[0]);

const response = await fetch('${BASE_URL}${endpoint}', {
  method: 'POST',
  body: form
});
const blob = await response.blob();`;

    axiosCode = `import axios from 'axios';

const form = new FormData();
form.append('text', 'contoh quote');
form.append('author', 'Anonymous');
form.append('avatar', fileInput.files[0]);

const res = await axios.post('${BASE_URL}${endpoint}', form, {
  headers: { 'Content-Type': 'multipart/form-data' },
  responseType: 'arraybuffer'
});`;

    pythonCode = `import requests

with open('avatar.png', 'rb') as avatar_file:
    response = requests.post(
        '${BASE_URL}${endpoint}',
        data={'text': 'contoh quote', 'author': 'Anonymous'},
        files={'avatar': avatar_file}
    )
print(response.headers.get('Content-Type'))`;
  } else if (isGet) {
    curl = `curl "${BASE_URL}${endpoint}"`;
    fetchCode = `const response = await fetch('${BASE_URL}${endpoint}');
const data = await response.json();
console.log(data);`;
    axiosCode = `import axios from 'axios';
const res = await axios.get('${BASE_URL}${endpoint}');
console.log(res.data);`;
    pythonCode = `import requests
response = requests.get('${BASE_URL}${endpoint}')
print(response.json())`;
  } else {
    curl = `curl -X POST ${BASE_URL}${endpoint} \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(sampleBody)}'`;

    fetchCode = `const response = await fetch('${BASE_URL}${endpoint}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${bodyString})
});
const data = await response.json();
console.log(data);`;

    axiosCode = `import axios from 'axios';

const res = await axios.post('${BASE_URL}${endpoint}', ${bodyString});
console.log(res.data);`;

    pythonCode = `import requests

response = requests.post(
    '${BASE_URL}${endpoint}',
    json=${JSON.stringify(sampleBody, null, 4).replace(/"/g, "'")},
    headers={'Content-Type': 'application/json'}
)
print(response.json())`;
  }

  return `<div class="code-tabs">
    <div class="ctab active" onclick="switchCode('curl', this)">cURL</div>
    <div class="ctab" onclick="switchCode('fetch', this)">JS Fetch</div>
    <div class="ctab" onclick="switchCode('axios', this)">Axios</div>
    <div class="ctab" onclick="switchCode('python', this)">Python</div>
  </div>
  <div id="code-curl" class="code-block">${escHtml(curl)}<button class="copy-btn" onclick="copyCode('code-curl')">Copy</button></div>
  <div id="code-fetch" class="code-block" style="display:none">${escHtml(fetchCode)}<button class="copy-btn" onclick="copyCode('code-fetch')">Copy</button></div>
  <div id="code-axios" class="code-block" style="display:none">${escHtml(axiosCode)}<button class="copy-btn" onclick="copyCode('code-axios')">Copy</button></div>
  <div id="code-python" class="code-block" style="display:none">${escHtml(pythonCode)}<button class="copy-btn" onclick="copyCode('code-python')">Copy</button></div>`;
}

function switchCode(language, element) {
  document.querySelectorAll('.ctab').forEach((tab) => tab.classList.remove('active'));
  element.classList.add('active');

  ['curl', 'fetch', 'axios', 'python'].forEach((lang) => {
    const block = document.getElementById(`code-${lang}`);
    if (block) block.style.display = lang === language ? 'block' : 'none';
  });
}

function copyCode(id) {
  const block = document.getElementById(id);
  const text = block.innerText.replace(/^Copy$|^Copied!$/gm, '').trim();

  navigator.clipboard.writeText(text).then(() => {
    const button = block.querySelector('.copy-btn');
    button.textContent = 'Copied!';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = 'Copy';
      button.classList.remove('copied');
    }, 1800);
  });
}

function escHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSampleBody(api) {
  if (!api.params) return {};
  const body = {};

  api.params.forEach((param) => {
    if (param.required === false) return;

    if (param.example !== undefined) {
      if (param.type === 'boolean') {
        body[param.name] = String(param.example).toLowerCase() === 'true';
      } else if (param.type === 'number') {
        body[param.name] = Number(param.example);
      } else {
        body[param.name] = param.example;
      }
      return;
    }

    if (param.name === 'preset') body[param.name] = 'bratdeluxe';
    else if (param.name === 'option') body[param.name] = 'hitam';
    else body[param.name] = `<${param.name}>`;
  });

  return body;
}

function buildRequestBodyExample(api) {
  if (!api.params || api.params.length === 0 || api.method === 'GET') return null;

  const supportsFile = api.params.some((param) => param.type === 'file');
  const isTelegramSticker = api.action === '/api/telegram/sticker';

  if (isTelegramSticker) {
    return JSON.stringify({
      fileId: 'CAACAgIAAxkBAAEK... (gunakan salah satu)',
      url: 'https://... (atau ini)',
      botToken: '123456:ABC... (opsional)',
      format: 'wa <- png | jpg | gif | webp | wa',
    }, null, 2);
  }

  if (supportsFile) {
    return api.params.map((param) => {
      if (param.type === 'file') return `${param.name}: <binary image file>`;
      if (param.name === 'option') return `${param.name}: hitam | nerd`;
      if (param.type === 'boolean' && param.example !== undefined) return `${param.name}: ${String(param.example).toLowerCase()}`;
      if (param.type === 'number' && param.example !== undefined) return `${param.name}: ${Number(param.example)}`;
      if (param.example !== undefined) return `${param.name}: ${param.example}`;
      return `${param.name}: <${param.name}>`;
    }).join('\n');
  }

  const body = {};
  api.params.forEach((param) => {
    if (param.name === 'bgColor') body[param.name] = '#e4ff3d (opsional, khusus custom preset)';
    else if (param.name === 'textColor') body[param.name] = '#000000 (opsional)';
    else if (param.name === 'preset') body[param.name] = 'bratdeluxe | brat | custom';
    else if (param.name === 'option') body[param.name] = 'hitam | nerd';
    else if (param.type === 'boolean' && param.example !== undefined) body[param.name] = String(param.example).toLowerCase() === 'true';
    else if (param.type === 'number' && param.example !== undefined) body[param.name] = Number(param.example);
    else if (param.example !== undefined) body[param.name] = param.example;
    else body[param.name] = `<${param.name}>`;
  });

  return JSON.stringify(body, null, 2);
}

function buildResponseExample(api) {
  const action = api.action;

  if (action === '/api/telegram/sticker-pack') {
    return JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'Data sticker pack berhasil diambil',
      data: {
        name: 'KOSHAKIEBANIYE',
        title: 'Contoh Sticker Pack',
        stickers: [
          { fileId: 'CAACAgIAAxkBAAEKxxxxxXXXX', emoji: '🙂' },
        ],
      },
      timestamp: '2026-04-23T10:00:00.000Z',
    }, null, 2);
  }

  if (action === '/api/telegram/sticker-pack/download') {
    return `Content-Type: application/octet-stream  (single pack -> .wasticker)
Content-Type: application/zip               (multi-part -> .zip berisi N .wasticker)
Content-Disposition: attachment; filename="<pack>.wasticker"
X-Sticker-Parts: 1                          (jumlah part dalam respons)
X-Sticker-Count: 24                         (total stiker yang berhasil dikonversi)

[Binary archive — flat layout: title.txt, author.txt, tray.png, 1.webp ... N.webp]`;
  }

  if (action === '/api/telegram/sticker') {
    return `Content-Type: image/webp   (static -> format wa/webp)
Content-Type: image/gif    (animated TGS atau WebM)
Content-Type: image/png    (format png)
X-Sticker-Type: webp | tgs | webm

[Binary image response]`;
  }

  if (
    action.includes('/api/brat/') ||
    action.includes('/api/quote') ||
    action.includes('/api/smeme') ||
    action.includes('/api/miq/') ||
    action === '/mcapi/render/head'
  ) {
    return 'Content-Type: image/png\n\n[Binary image response]';
  }

  if (action.includes('/api/youtube/mp3')) {
    return JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'MP3 download link generated',
      data: {
        title: 'Never Gonna Give You Up',
        download: `${BASE_URL}/downloads/never-gonna-give-you-up.mp3`,
        format: 'audio/mpeg',
        fileSize: '3.20 MB',
        duration: '3 menit, 32 detik',
        author: 'Rick Astley',
      },
      timestamp: '2026-04-18T10:00:00.000Z',
    }, null, 2);
  }

  if (action.includes('/api/youtube/mp4')) {
    return JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'MP4 download link generated',
      data: {
        title: 'Never Gonna Give You Up',
        download: `${BASE_URL}/downloads/never-gonna-give-you-up.mp4`,
        format: 'video/mp4',
        fileSize: '12.40 MB',
        duration: '3 menit, 32 detik',
        quality: '720p',
      },
      timestamp: '2026-04-18T10:00:00.000Z',
    }, null, 2);
  }

  if (action.includes('/api/tiktok/')) {
    return JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'TikTok video data fetched successfully',
      data: {
        title: 'Contoh video TikTok',
        author: {
          name: 'Nama Kreator',
          username: '@username',
        },
        media: {
          video: {
            nowm: 'https://example.com/video-nowm.mp4',
            hd: 'https://example.com/video-hd.mp4',
          },
          audio: 'https://example.com/audio.mp3',
        },
      },
      timestamp: '2026-04-18T10:00:00.000Z',
    }, null, 2);
  }

  if (action.includes('/api/instagram/download')) {
    return JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'Instagram content fetched successfully',
      data: {
        downloadLinks: [
          {
            url: 'https://example.com/instagram-media.mp4',
            type: 'video',
          },
        ],
        count: 1,
      },
      timestamp: '2026-04-18T10:00:00.000Z',
    }, null, 2);
  }

  if (action.includes('/api/gdrive')) {
    return JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'Google Drive link fetched successfully',
      data: {
        data: 'https://drive.google.com/uc?export=download&id=...',
        fileName: 'example.zip',
        fileSize: '1024.00 KB',
        mimetype: 'application/zip',
      },
      timestamp: '2026-04-23T10:00:00.000Z',
    }, null, 2);
  }

  if (action.includes('/api/promosi')) {
    return JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'Promotion analysis completed',
      data: {
        percentage: 88,
        isPromotion: true,
        reason: 'Mengandung ajakan promosi dan penawaran yang jelas.',
      },
      timestamp: '2026-04-23T10:00:00.000Z',
    }, null, 2);
  }

  if (action === '/mcapi/profile') {
    return JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'Minecraft profile fetched successfully',
      data: {
        edition: 'java',
        username: 'Dream',
        id: '8667ba71-b85a-4004-af54-457a9734eed7',
        linked: false,
        textures: {
          skin: 'https://textures.minecraft.net/texture/...',
        },
        java: {
          uuid: '8667ba71-b85a-4004-af54-457a9734eed7',
          username: 'Dream',
        },
      },
      timestamp: '2026-04-23T10:00:00.000Z',
    }, null, 2);
  }

  if (action.includes('/mcapi/profile/:edition/:id/skin')) {
    return 'HTTP/1.1 302 Found\nLocation: https://textures.minecraft.net/texture/...';
  }

  if (action === '/health') {
    return JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'Health check passed',
      data: {
        status: 'healthy',
        uptime: 1234.56,
      },
      timestamp: '2026-04-23T10:00:00.000Z',
    }, null, 2);
  }

  if (action === '/api/status') {
    return JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'API is running',
      data: {
        version: '2.0.0',
        environment: 'development',
        uptime: 1234,
      },
      timestamp: '2026-04-18T10:00:00.000Z',
    }, null, 2);
  }

  return JSON.stringify({
    success: true,
    statusCode: 200,
    message: 'Success',
    data: {},
    timestamp: '2026-04-10T00:00:00.000Z',
  }, null, 2);
}

function getParamDesc(name) {
  const descriptions = {
    text: 'Teks utama yang akan ditampilkan',
    url: 'URL lengkap termasuk https://',
    query: 'Judul video atau URL YouTube langsung',
    image: 'URL gambar sumber',
    name: 'Nama pengirim quote',
    message: 'Isi quote atau pesan',
    author: 'Nama yang ditampilkan pada quote',
    avatar: 'File gambar avatar opsional',
    avatarUrl: 'URL gambar avatar publik opsional',
    option: 'Pilih transformasi AI: hitam atau nerd',
    color: 'Nilai warna atau opsi warna sesuai kebutuhan endpoint',
    preset: 'Pilih tema: bratdeluxe, brat, atau custom',
    bgColor: 'Warna latar dalam format hex, contoh: #e4ff3d',
    textColor: 'Warna teks dalam format hex, contoh: #000000',
    top: 'Teks bagian atas meme',
    bottom: 'Teks bagian bawah meme',
    format: 'Format output: png, jpg, gif, webp, atau wa (WhatsApp sticker)',
    width: 'Lebar output gambar',
    height: 'Tinggi output gambar',
    font: 'Font memegen, contoh: impact',
    layout: 'Posisi layout teks, contoh: top',
    threshold: 'Ambang minimum untuk menandai teks sebagai promosi',
    username: 'Username Minecraft Java atau Bedrock',
    edition: 'Mode pencarian: auto, java, atau bedrock',
    xuid: 'Xbox User ID untuk akun Bedrock',
    uuid: 'UUID akun Minecraft Java',
    skin: 'URL skin Minecraft',
    size: 'Ukuran hasil render kepala',
    id: 'UUID Java atau identifier Bedrock sesuai endpoint',
    fileId: 'Telegram file_id, dapatkan dari @RawDataBot atau via getUpdates di bot kamu',
    botToken: 'Token bot Telegram (opsional jika env TELEGRAM_BOT_TOKEN sudah diset)',
  };

  return descriptions[name] || '';
}

function selPreset(value, element) {
  selectedPreset = value;
  document.querySelectorAll('.preset-btn').forEach((button) => {
    const onclick = button.getAttribute('onclick') || '';
    if (!onclick.includes('selOpt') && !onclick.includes('selFormat')) {
      button.classList.remove('sel');
    }
  });
  element.classList.add('sel');

  const colorWrap = document.getElementById('colorWrap');
  if (colorWrap) colorWrap.style.display = value === 'custom' ? 'block' : 'none';
}

function selOpt(value, element) {
  selectedOption = value;
  document.querySelectorAll('.preset-btn').forEach((button) => {
    const onclick = button.getAttribute('onclick') || '';
    if (onclick.includes('selOpt')) button.classList.remove('sel');
  });
  element.classList.add('sel');

  const hiddenInput = document.getElementById('f-option');
  if (hiddenInput) hiddenInput.value = value;
}

function selFormat(value, element) {
  document.querySelectorAll('.preset-btn').forEach((button) => {
    const onclick = button.getAttribute('onclick') || '';
    if (onclick.includes('selFormat')) button.classList.remove('sel');
  });
  element.classList.add('sel');

  const hiddenInput = document.getElementById('f-format');
  if (hiddenInput) hiddenInput.value = value;
}

function syncC(name) {
  const picker = document.getElementById(`f-${name}-pick`);
  const text = document.getElementById(`f-${name}`);
  if (picker && text) text.value = picker.value;
}

function syncP(name) {
  const text = document.getElementById(`f-${name}`);
  const picker = document.getElementById(`f-${name}-pick`);
  if (picker && text && /^#[0-9a-fA-F]{6}$/.test(text.value)) picker.value = text.value;
}

function sendReq() {
  if (!currentApi) return;

  const api = currentApi;
  const button = document.getElementById('sendBtn');
  button.disabled = true;
  button.textContent = 'Mengirim...';

  const isTelegramSticker = api.action === '/api/telegram/sticker';
  const isTelegramStickerDownload = api.action === '/api/telegram/sticker-pack/download';
  const isBrat = api.name.toLowerCase().includes('brat');
  const isReplicate = api.action === '/api/replicate/generate';

  const body = {};
  if (api.params) {
    api.params.forEach((param) => {
      if (['bgColor', 'textColor', 'preset', 'format'].includes(param.name)) return;

      const input = document.getElementById(`f-${param.name}`);
      if (!input) return;
      if (param.type === 'file') return;
      if (!input.value.trim()) return;

      if (param.type === 'boolean') {
        body[param.name] = input.value.trim().toLowerCase() === 'true';
      } else if (param.type === 'number') {
        body[param.name] = Number(input.value.trim());
      } else {
        body[param.name] = input.value.trim();
      }
    });
  }

  const hasFile = (api.params || []).some((param) => {
    const input = document.getElementById(`f-${param.name}`);
    return param.type === 'file' && input?.files?.length;
  });

  if (isBrat) {
    body.preset = selectedPreset;
    if (selectedPreset === 'custom') {
      const bg = document.getElementById('f-bgColor');
      const textColor = document.getElementById('f-textColor');
      if (bg) body.bgColor = bg.value;
      if (textColor) body.textColor = textColor.value;
    }
  }

  if (isReplicate) {
    const option = document.getElementById('f-option');
    if (option) body.option = option.value;
  }

  if (isTelegramSticker) {
    const format = document.getElementById('f-format');
    if (format) body.format = format.value;
  }

  showLoading();

  const requestOptions = { method: api.method };
  const baseHeaders = {};
  const authedKey = Auth.getApiKey();
  if (authedKey) baseHeaders['X-API-Key'] = authedKey;
  if (api.method !== 'GET') {
    if (hasFile) {
      const form = new FormData();
      Object.entries(body).forEach(([key, value]) => form.append(key, value));

      (api.params || [])
        .filter((param) => param.type === 'file')
        .forEach((param) => {
          const input = document.getElementById(`f-${param.name}`);
          if (input?.files?.[0]) form.append(param.name, input.files[0]);
        });

      requestOptions.body = form;
      if (Object.keys(baseHeaders).length) requestOptions.headers = baseHeaders;
    } else {
      requestOptions.headers = { 'Content-Type': 'application/json', ...baseHeaders };
      requestOptions.body = JSON.stringify(body);
    }
  } else if (Object.keys(baseHeaders).length) {
    requestOptions.headers = baseHeaders;
  }

  fetch(api.action, requestOptions)
    .then((response) => handleApiResponse(response, { isTelegramStickerDownload }))
    .catch((error) => showError(error.message || 'Network error: gagal terhubung ke server.'))
    .finally(() => {
      button.disabled = false;
      button.textContent = 'Kirim Request';
    });
}

// Centralised response handler. Detects:
//   - .wasticker / .zip binary downloads -> trigger browser save dialog
//   - image/* -> render preview + download anchor
//   - application/json -> success envelope (200) or error envelope (4xx/5xx)
//   - 429 -> surface Retry-After hint
async function handleApiResponse(response, { isTelegramStickerDownload } = {}) {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const isOk = response.status >= 200 && response.status < 300;

  // Error path first — backend always emits a JSON envelope on 4xx/5xx.
  if (!isOk) {
    let payload = null;
    if (isJson) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    } else {
      const text = await response.text().catch(() => '');
      payload = text ? { message: text } : null;
    }
    showApiError(response.status, response.headers, payload);
    return;
  }

  // .wasticker (octet-stream) or multi-part .zip -> save to device.
  const isBinaryArchive =
    contentType.includes('application/octet-stream') ||
    contentType.includes('application/zip') ||
    isTelegramStickerDownload;

  if (isBinaryArchive) {
    const blob = await response.blob();
    const filename = parseContentDispositionFilename(response.headers.get('content-disposition'))
      || (contentType.includes('zip') ? 'sticker-pack.zip' : 'sticker-pack.wasticker');
    triggerDownload(blob, filename);
    showDownloadResult({
      filename,
      size: blob.size,
      status: response.status,
      parts: response.headers.get('x-sticker-parts'),
      stickers: response.headers.get('x-sticker-count'),
      contentType,
    });
    return;
  }

  if (contentType.includes('image/')) {
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const ext = contentType.includes('gif')
      ? 'gif'
      : contentType.includes('webp')
        ? 'webp'
        : 'png';
    showImage(url, ext, response.status, contentType);
    return;
  }

  if (isJson) {
    const json = await response.json();
    showJSON(json, response.status);
    return;
  }

  const text = await response.text();
  showError(text || 'Response tidak dikenali');
}

function parseContentDispositionFilename(header) {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8) {
    try { return decodeURIComponent(utf8[1].trim()); } catch { /* fall through */ }
  }
  const ascii = /filename="?([^";]+)"?/i.exec(header);
  return ascii ? ascii[1].trim() : null;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function showDownloadResult({ filename, size, status, parts, stickers, contentType }) {
  const meta = [];
  if (size) meta.push(formatBytes(size));
  if (parts) meta.push(`${parts} part${Number(parts) > 1 ? 's' : ''}`);
  if (stickers) meta.push(`${stickers} stiker`);
  const metaLine = meta.length ? `<div class="img-note">${meta.join(' • ')} • ${escHtml(contentType)}</div>` : '';

  document.getElementById('responseArea').innerHTML = `<div class="response-area">
    <div class="res-bar"><span class="res-label">Response</span><span class="res-status s-ok">${status} OK - File terunduh</span></div>
    <div class="img-result">
      <div style="font-weight:600;margin-bottom:6px">${escHtml(filename)}</div>
      ${metaLine}
      <div class="img-note" style="margin-top:10px">File otomatis terunduh ke perangkat. Impor ke aplikasi Sticker Maker untuk menambahkan ke WhatsApp.</div>
    </div>
  </div>`;
}

function showApiError(status, headers, payload) {
  // Pull human-readable copy from the standard envelope first; fall back to
  // raw text or generic copy so we never display an empty bubble.
  let message = (payload && (payload.message || payload.error || payload.statusMessage)) || '';
  if (!message) {
    if (status === 400) message = 'Parameter request tidak valid. Periksa kembali isian form.';
    else if (status === 401) message = 'Tidak terautentikasi. Cek API key / botToken.';
    else if (status === 403) message = 'Akses ditolak.';
    else if (status === 404) message = 'Resource tidak ditemukan.';
    else if (status === 413) message = 'Payload terlalu besar.';
    else if (status === 429) message = 'Terlalu banyak request. Coba lagi sebentar.';
    else if (status === 502 || status === 503) message = 'Layanan upstream sedang bermasalah.';
    else message = `Request gagal (HTTP ${status}).`;
  }

  const retryAfter = headers && headers.get && headers.get('retry-after');
  if (status === 429 && retryAfter) {
    message += ` Coba lagi dalam ${retryAfter} detik.`;
  }

  const details = payload && payload.errors
    ? `<div class="res-body" style="margin-top:8px">${escHtml(JSON.stringify(payload.errors, null, 2))}</div>`
    : '';

  document.getElementById('responseArea').innerHTML = `<div class="response-area">
    <div class="res-bar"><span class="res-label">Response</span><span class="res-status s-err">${status} Error</span></div>
    <div class="res-body">${escHtml(message)}</div>
    ${details}
  </div>`;
}

function showLoading() {
  document.getElementById('responseArea').innerHTML = `<div class="response-area">
    <div class="res-bar"><span class="res-label">Response</span><span class="res-status s-load">Memuat...</span></div>
    <div class="res-body">Mengirim request ke server...</div>
  </div>`;
}

function showJSON(json, status) {
  const ok = status >= 200 && status < 300;
  document.getElementById('responseArea').innerHTML = `<div class="response-area">
    <div class="res-bar"><span class="res-label">Response</span><span class="res-status ${ok ? 's-ok' : 's-err'}">${status} ${ok ? 'OK' : 'Error'}</span></div>
    <div class="res-body">${JSON.stringify(json, null, 2)}</div>
  </div>`;
}

function showImage(url, ext, status, contentType) {
  document.getElementById('responseArea').innerHTML = `<div class="response-area">
    <div class="res-bar"><span class="res-label">Response</span><span class="res-status s-ok">${status} OK - ${contentType}</span></div>
    <div class="img-result">
      <img src="${url}" alt="Hasil">
      <br>
      <a href="${url}" download="result.${ext}" class="img-dl">Download ${ext.toUpperCase()}</a>
      <div class="img-note">Gunakan hasil ini untuk preview atau unduh filenya langsung.</div>
    </div>
  </div>`;
}

function showError(message) {
  document.getElementById('responseArea').innerHTML = `<div class="response-area">
    <div class="res-bar"><span class="res-label">Response</span><span class="res-status s-err">Error</span></div>
    <div class="res-body">Error: ${message}</div>
  </div>`;
}

const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const sidebar = document.getElementById('sidebar');
const mobileOverlay = document.getElementById('mobileOverlay');

function closeMobileMenu() {
  sidebar.classList.remove('open');
  mobileOverlay.classList.remove('active');
  setTimeout(() => {
    mobileOverlay.style.display = 'none';
  }, 300);
}

function toggleMobileMenu() {
  const isOpen = sidebar.classList.contains('open');
  if (isOpen) {
    closeMobileMenu();
  } else {
    sidebar.classList.add('open');
    mobileOverlay.style.display = 'block';
    setTimeout(() => mobileOverlay.classList.add('active'), 10);
  }
}

if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', toggleMobileMenu);
if (mobileOverlay) mobileOverlay.addEventListener('click', closeMobileMenu);

/* ────────────────────────────────────────────────────────────────────────────
 * AUTH STATE + UI (Phase 4.5)
 * ──────────────────────────────────────────────────────────────────────────── */

const Auth = (() => {
  const TK_KEY = 'rex.token';
  const USR_KEY = 'rex.user';
  const KEY_KEY = 'rex.apiKey';

  function getToken() {
    return localStorage.getItem(TK_KEY);
  }
  function getUser() {
    try {
      const raw = localStorage.getItem(USR_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function getApiKey() {
    return localStorage.getItem(KEY_KEY);
  }
  function setSession(token, user, apiKey) {
    if (token) localStorage.setItem(TK_KEY, token);
    if (user) localStorage.setItem(USR_KEY, JSON.stringify(user));
    if (apiKey) localStorage.setItem(KEY_KEY, apiKey);
  }
  function setApiKey(apiKey) {
    if (apiKey) localStorage.setItem(KEY_KEY, apiKey);
  }
  function clear() {
    localStorage.removeItem(TK_KEY);
    localStorage.removeItem(USR_KEY);
    localStorage.removeItem(KEY_KEY);
  }
  function isAuthed() {
    return !!getToken();
  }
  async function fetchAuthed(url, opts = {}) {
    const token = getToken();
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401) {
      clear();
      renderSidebarAuth();
      Toast.error('Sesi berakhir, silakan login lagi');
      openAuthModal('login');
      throw new Error('Unauthorized');
    }
    return res;
  }
  return { getToken, getUser, getApiKey, setSession, setApiKey, clear, isAuthed, fetchAuthed };
})();

const Toast = (() => {
  function show(message, type = 'info', timeoutMs = 3200) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 280);
    }, timeoutMs);
  }
  return {
    info: (m) => show(m, 'info'),
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error', 4500),
  };
})();

/* ─── SIDEBAR AUTH SLOT ─── */
function renderSidebarAuth() {
  const slot = document.getElementById('authSlot');
  if (!slot) return;
  const user = Auth.getUser();
  if (Auth.isAuthed() && user) {
    const initial = (user.username || '?').charAt(0).toUpperCase();
    slot.innerHTML = `
      <div class="auth-userbox">
        <div class="auth-avatar">${initial}</div>
        <div class="auth-userinfo">
          <div class="auth-username">${escapeHtml(user.username)}</div>
          <div class="auth-useremail">${escapeHtml(user.email)}</div>
        </div>
      </div>
      <button type="button" class="auth-btn primary" onclick="showProfileView()">Profile</button>
      <button type="button" class="auth-btn danger" onclick="doLogout()">Logout</button>
    `;
  } else {
    slot.innerHTML = `
      <button type="button" class="auth-btn primary" onclick="openAuthModal('register')">Daftar</button>
      <button type="button" class="auth-btn" onclick="openAuthModal('login')">Login</button>
    `;
  }
  renderAnonBanner();
}

/* ─── ANON HEADER BANNER ─── */
const ANON_BANNER_DISMISSED_KEY = 'rex.anonBannerDismissed';
function renderAnonBanner() {
  const el = document.getElementById('anonBanner');
  if (!el) return;
  const hide = Auth.isAuthed() || localStorage.getItem(ANON_BANNER_DISMISSED_KEY) === '1';
  if (hide) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = `
    <span class="anon-icon" aria-hidden="true">⚡</span>
    <div class="anon-text">
      Mode <strong>anon</strong>: 30 hit/hari (shared)
      <span class="sep">·</span>
      Daftar gratis untuk <strong>250 hit/hari</strong> + API key personal
    </div>
    <div class="anon-actions">
      <button type="button" class="anon-btn primary" onclick="openAuthModal('register')">Daftar gratis</button>
      <button type="button" class="anon-btn" onclick="openAuthModal('login')">Login</button>
    </div>
    <button type="button" class="anon-dismiss" aria-label="Tutup" title="Tutup" onclick="dismissAnonBanner()">✕</button>
  `;
}
function dismissAnonBanner() {
  localStorage.setItem(ANON_BANNER_DISMISSED_KEY, '1');
  renderAnonBanner();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/* ─── AUTH MODAL ─── */
function openAuthModal(mode) {
  const overlay = document.getElementById('authOverlay');
  const titleEl = document.getElementById('authTitle');
  const subEl = document.getElementById('authSub');
  const body = document.getElementById('authBody');
  if (mode === 'register') {
    titleEl.textContent = 'Daftar Akun';
    subEl.textContent = 'Buat akun baru — kamu otomatis dapat API key dengan kuota 250 hit/hari.';
    body.innerHTML = renderRegisterForm();
    queueMicrotask(() => document.getElementById('regUsername')?.focus());
  } else {
    titleEl.textContent = 'Masuk';
    subEl.textContent = 'Masuk dengan email atau username kamu.';
    body.innerHTML = renderLoginForm();
    queueMicrotask(() => document.getElementById('loginIdentifier')?.focus());
  }
  overlay.classList.add('open');
  overlay.onclick = (event) => {
    if (event.target === overlay) closeAuthModal();
  };
}

function closeAuthModal() {
  document.getElementById('authOverlay').classList.remove('open');
}

function renderLoginForm() {
  return `
    <form class="auth-form" onsubmit="event.preventDefault(); submitLogin();">
      <div class="auth-error" id="loginError" style="display:none"></div>
      <div class="field">
        <label for="loginIdentifier">Email atau Username</label>
        <input id="loginIdentifier" type="text" autocomplete="username" required>
      </div>
      <div class="field">
        <label for="loginPassword">Password</label>
        <input id="loginPassword" type="password" autocomplete="current-password" required>
      </div>
      <button type="submit" class="auth-submit" id="loginSubmit">Masuk</button>
      <div class="auth-switch">Belum punya akun? <a onclick="openAuthModal('register')">Daftar</a></div>
    </form>
  `;
}

function renderRegisterForm() {
  return `
    <form class="auth-form" onsubmit="event.preventDefault(); submitRegister();">
      <div class="auth-error" id="regError" style="display:none"></div>
      <div class="field">
        <label for="regUsername">Username</label>
        <input id="regUsername" type="text" autocomplete="username" minlength="3" maxlength="32" required>
        <div class="hint">Huruf, angka, garis bawah; 3–32 karakter.</div>
      </div>
      <div class="field">
        <label for="regEmail">Email</label>
        <input id="regEmail" type="email" autocomplete="email" required>
      </div>
      <div class="field">
        <label for="regPassword">Password</label>
        <input id="regPassword" type="password" autocomplete="new-password" minlength="8" required>
        <div class="hint">Minimal 8 karakter.</div>
      </div>
      <button type="submit" class="auth-submit" id="regSubmit">Daftar</button>
      <div class="auth-switch">Sudah punya akun? <a onclick="openAuthModal('login')">Masuk</a></div>
    </form>
  `;
}

async function submitLogin() {
  const identifier = document.getElementById('loginIdentifier').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  const submit = document.getElementById('loginSubmit');
  errBox.style.display = 'none';
  submit.disabled = true;
  submit.textContent = 'Memproses…';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      errBox.textContent = json?.message || 'Login gagal';
      errBox.style.display = '';
      return;
    }
    const data = json.data || {};
    Auth.setSession(data.token, data.user, data.apiKey?.key);
    closeAuthModal();
    renderSidebarAuth();
    Toast.success(`Selamat datang kembali, ${data.user.username}`);
    showProfileView();
  } catch (err) {
    errBox.textContent = err.message || 'Network error';
    errBox.style.display = '';
  } finally {
    submit.disabled = false;
    submit.textContent = 'Masuk';
  }
}

async function submitRegister() {
  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const errBox = document.getElementById('regError');
  const submit = document.getElementById('regSubmit');
  errBox.style.display = 'none';
  submit.disabled = true;
  submit.textContent = 'Memproses…';
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      errBox.textContent = json?.message || 'Pendaftaran gagal';
      errBox.style.display = '';
      return;
    }
    const data = json.data || {};
    Auth.setSession(data.token, data.user, data.apiKey?.key);
    closeAuthModal();
    renderSidebarAuth();
    Toast.success(`Akun dibuat, selamat datang ${data.user.username}`);
    showProfileView();
  } catch (err) {
    errBox.textContent = err.message || 'Network error';
    errBox.style.display = '';
  } finally {
    submit.disabled = false;
    submit.textContent = 'Daftar';
  }
}

function doLogout() {
  Auth.clear();
  localStorage.removeItem(ANON_BANNER_DISMISSED_KEY);
  renderSidebarAuth();
  Toast.info('Logout berhasil');
  if (PROFILE_STATE.active) {
    PROFILE_STATE.active = false;
    stopProfilePolling();
    showAll(document.querySelector('.nav-item'));
  }
}

/* ─── PROFILE VIEW ─── */
const PROFILE_STATE = { active: false, pollTimer: null, lastData: null, keyMasked: true };

async function showProfileView() {
  if (!Auth.isAuthed()) {
    openAuthModal('login');
    return;
  }
  setActive(null);
  document.getElementById('activeTitle').textContent = 'Profile';
  document.getElementById('mainContent').innerHTML = `
    <div class="profile-wrap" id="profileWrap">
      <div class="profile-card" style="text-align:center;color:var(--tx2);font-size:13px">
        Memuat profil…
      </div>
    </div>
  `;
  PROFILE_STATE.active = true;
  if (window.innerWidth <= 768) closeMobileMenu();
  await refreshProfile({ initial: true });
  startProfilePolling();
}

async function refreshProfile({ initial = false } = {}) {
  if (!PROFILE_STATE.active || !Auth.isAuthed()) return;
  try {
    const res = await Auth.fetchAuthed('/api/user/profile');
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json?.message || `HTTP ${res.status}`);
    }
    const json = await res.json();
    const data = json.data;
    PROFILE_STATE.lastData = data;
    if (data?.apiKey?.key) Auth.setApiKey(data.apiKey.key);
    renderProfile(data);
  } catch (err) {
    if (initial) {
      const wrap = document.getElementById('profileWrap');
      if (wrap) {
        wrap.innerHTML = `<div class="profile-card auth-error">Gagal memuat: ${escapeHtml(err.message)}</div>`;
      }
    }
  }
}

function renderProfile(data) {
  const wrap = document.getElementById('profileWrap');
  if (!wrap) return;
  const user = data.user || {};
  const apiKey = data.apiKey || {};
  const usage = data.usage || {};
  const initial = (user.username || '?').charAt(0).toUpperCase();
  const created = user.createdAt ? new Date(user.createdAt).toLocaleString('id-ID') : '—';
  const lastLogin = user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('id-ID') : '—';

  const used = Number(usage.used || 0);
  const limit = usage.unlimited ? null : Number(usage.limit || 0);
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const fillClass = pct >= 100 ? 'full' : pct >= 80 ? 'warn' : '';
  const remaining = usage.unlimited ? '∞' : Math.max(0, limit - used);
  const resetIso = usage.resetAt;
  const resetCountdown = resetIso ? formatCountdown(new Date(resetIso) - Date.now()) : '—';

  const masked = PROFILE_STATE.keyMasked;
  const keyDisplay = apiKey.key
    ? (masked ? `rex_${'•'.repeat(28)}` : apiKey.key)
    : 'Tidak ada API key';
  const keyClass = masked && apiKey.key ? 'api-key-text masked' : 'api-key-text';
  const showLabel = masked ? 'Show' : 'Hide';

  const snippet = apiKey.key
    ? `curl -H "X-API-Key: ${apiKey.key}" \\\n  ${window.location.origin}/api/quote`
    : '';

  wrap.innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar">${initial}</div>
      <div>
        <div class="profile-name">${escapeHtml(user.username)}</div>
        <div class="profile-email">${escapeHtml(user.email)}</div>
        <div class="profile-meta">Member sejak ${escapeHtml(created)}</div>
      </div>
    </div>

    <div class="profile-grid">
      <div class="profile-card">
        <div class="profile-card-head">
          <div class="profile-card-title">API Key</div>
          <div class="profile-card-tier">${escapeHtml(apiKey.tier || 'user')}</div>
        </div>
        <div class="api-key-row">
          <div class="${keyClass}" id="apiKeyText">${apiKey.key ? escapeHtml(keyDisplay) : '—'}</div>
          ${apiKey.key ? `
            <button type="button" class="icon-btn" title="${showLabel}" onclick="toggleKeyMask()" aria-label="${showLabel}">${masked ? '👁' : '⊘'}</button>
            <button type="button" class="icon-btn" title="Salin" onclick="copyApiKey()" aria-label="Copy">⧉</button>
          ` : ''}
        </div>
        <div class="api-key-actions">
          <button type="button" class="btn-line accent" onclick="regenerateKey()">Regenerate Key</button>
          ${apiKey.key ? `<button type="button" class="btn-line" onclick="copyApiKey()">Salin Key</button>` : ''}
        </div>
        <div class="profile-row" style="margin-top:14px">
          <div><div class="lbl">Key ID</div><div class="val">${escapeHtml(apiKey.id || '—')}</div></div>
          <div><div class="lbl">Dibuat</div><div class="val">${escapeHtml(apiKey.createdAt ? new Date(apiKey.createdAt).toLocaleString('id-ID') : '—')}</div></div>
        </div>
      </div>

      <div class="profile-card">
        <div class="profile-card-head">
          <div class="profile-card-title">Kuota Harian</div>
          <div class="profile-card-tier" style="background:var(--blue2);color:var(--blue);border-color:rgba(79,158,255,.2)">Live</div>
        </div>
        <div class="quota-row">
          <div class="quota-num">
            ${used}<span class="quota-limit">${usage.unlimited ? ' / ∞' : ` / ${limit}`}</span>
          </div>
          <div class="quota-meta">
            ${remaining} tersisa<br>reset dalam ${resetCountdown}
          </div>
        </div>
        <div class="quota-bar">
          <div class="quota-fill ${fillClass}" style="width:${usage.unlimited ? 100 : pct}%"></div>
        </div>
        <div class="quota-foot">${pct}% terpakai · auto refresh tiap 30 detik</div>
      </div>

      ${snippet ? `
      <div class="profile-card">
        <div class="profile-card-head">
          <div class="profile-card-title">Quick Start</div>
        </div>
        <div class="profile-snippet" id="snippetBox">${escapeHtml(snippet)}<button type="button" class="copy-btn-mini" onclick="copySnippet()" aria-label="Salin">⧉</button></div>
        <div class="quota-foot" style="margin-top:8px">Sertakan header <code>X-API-Key</code> di tiap request. Endpoint "Coba Langsung" otomatis pakai key ini saat kamu login.</div>
      </div>` : ''}
    </div>
  `;
}

function formatCountdown(ms) {
  if (!ms || ms < 0) return '0d';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}j ${m}m`;
  if (m > 0) return `${m}m ${s}d`;
  return `${s}d`;
}

function toggleKeyMask() {
  PROFILE_STATE.keyMasked = !PROFILE_STATE.keyMasked;
  if (PROFILE_STATE.lastData) renderProfile(PROFILE_STATE.lastData);
}

async function copyApiKey() {
  const key = Auth.getApiKey();
  if (!key) return;
  try {
    await navigator.clipboard.writeText(key);
    Toast.success('API key disalin');
  } catch {
    Toast.error('Gagal menyalin');
  }
}

async function copySnippet() {
  const box = document.getElementById('snippetBox');
  if (!box) return;
  const text = box.childNodes[0]?.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    Toast.success('Snippet disalin');
  } catch {
    Toast.error('Gagal menyalin');
  }
}

async function regenerateKey() {
  if (!confirm('Regenerate API key?\nKey lama akan langsung tidak valid. Kuota harian yang sudah terpakai TIDAK ikut tereset.')) return;
  try {
    const res = await Auth.fetchAuthed('/api/user/regenerate-key', { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      Toast.error(json?.message || 'Gagal regenerate');
      return;
    }
    const newKey = json.data?.apiKey?.key;
    if (newKey) Auth.setApiKey(newKey);
    Toast.success('API key di-regenerate');
    PROFILE_STATE.keyMasked = false;
    await refreshProfile();
  } catch (err) {
    Toast.error(err.message || 'Gagal regenerate');
  }
}

function startProfilePolling() {
  stopProfilePolling();
  PROFILE_STATE.pollTimer = setInterval(() => {
    if (!PROFILE_STATE.active || document.hidden) return;
    refreshProfile();
  }, 30000);
}

function stopProfilePolling() {
  if (PROFILE_STATE.pollTimer) {
    clearInterval(PROFILE_STATE.pollTimer);
    PROFILE_STATE.pollTimer = null;
  }
}

// Leave profile view when user clicks any other nav item.
const _origShowAll = window.showAll || showAll;
const _origShowCat = window.showCat || showCat;
window.showAll = function (element) {
  PROFILE_STATE.active = false;
  stopProfilePolling();
  _origShowAll(element);
};
window.showCat = function (category, element) {
  PROFILE_STATE.active = false;
  stopProfilePolling();
  _origShowCat(category, element);
};

document.addEventListener('DOMContentLoaded', renderSidebarAuth);
if (document.readyState !== 'loading') renderSidebarAuth();
