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
  'Downloader': 'DL',
  'Image Generator': 'IMG',
  'Utilities': 'UTIL',
  'Minecraft': 'MC',
  'Status': 'OK',
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
    document.getElementById('searchInput').addEventListener('input', (event) => doSearch(event.target.value));
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
  setTimeout(() => document.getElementById(slugify(category))?.scrollIntoView({ behavior: 'smooth' }), 50);
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
  const labels = { docs: 'Dokumentasi', try: 'Coba Langsung', code: 'Kode Integrasi' };
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
      const description = getParamDesc(param.name);
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
  const isGemini = api.name.toLowerCase().includes('gemini');
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
      const description = getParamDesc(param.name);
      fields += `<div class="form-section">
        <div class="form-label"><span class="form-label-text">${param.name}</span>${required}</div>
        <input type="${inputType}" class="form-input" id="f-${param.name}" ${inputType === 'file' ? 'accept="image/*"' : `placeholder="${hint}"`}>
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

  if (isGemini) {
    extra = `<div class="form-section">
      <div class="form-label"><span class="form-label-text">option</span><span class="chip-req" style="font-size:10px">wajib</span></div>
      <div class="preset-row">
        <div class="preset-btn sel" onclick="selOpt('hitam', this)">hitam</div>
        <div class="preset-btn" onclick="selOpt('nerd', this)">nerd</div>
      </div>
      <input type="hidden" id="f-option" value="hitam">
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

  const curl = supportsFile
    ? `curl -X POST ${BASE_URL}${endpoint} \\
  -F "text=contoh quote" \\
  -F "author=Anonymous" \\
  -F "avatar=@avatar.png"`
    : isGet
    ? `curl "${BASE_URL}${endpoint}"`
    : `curl -X POST ${BASE_URL}${endpoint} \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(sampleBody)}'`;

  const fetchCode = supportsFile
    ? `const form = new FormData();
form.append('text', 'contoh quote');
form.append('author', 'Anonymous');
form.append('avatar', fileInput.files[0]);

const response = await fetch('${BASE_URL}${endpoint}', {
  method: 'POST',
  body: form
});

const blob = await response.blob();`
    : isGet
    ? `const response = await fetch('${BASE_URL}${endpoint}');
const contentType = response.headers.get('content-type');
if (contentType && contentType.includes('image/')) {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  document.querySelector('img').src = url;
} else {
  const data = await response.json();
  console.log(data);
}`
    : `const response = await fetch('${BASE_URL}${endpoint}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${bodyString})
});

const contentType = response.headers.get('content-type');
if (contentType && contentType.includes('image/')) {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  document.querySelector('img').src = url;
} else {
  const data = await response.json();
  console.log(data);
}`;

  const axiosCode = supportsFile
    ? `import axios from 'axios';

const form = new FormData();
form.append('text', 'contoh quote');
form.append('author', 'Anonymous');
form.append('avatar', fileInput.files[0]);

const res = await axios.post('${BASE_URL}${endpoint}', form, {
  headers: { 'Content-Type': 'multipart/form-data' },
  responseType: 'arraybuffer'
});
console.log(res.data);`
    : isGet
    ? `import axios from 'axios';

const res = await axios.get('${BASE_URL}${endpoint}');
console.log(res.data);`
    : `import axios from 'axios';

const res = await axios.post('${BASE_URL}${endpoint}', ${bodyString}, {
  responseType: 'arraybuffer'
});
console.log(res.data);`;

  const pythonCode = supportsFile
    ? `import requests

with open('avatar.png', 'rb') as avatar_file:
    response = requests.post(
        '${BASE_URL}${endpoint}',
        data={'text': 'contoh quote', 'author': 'Anonymous'},
        files={'avatar': avatar_file}
    )

print(response.headers.get('Content-Type'))`
    : isGet
    ? `import requests

response = requests.get('${BASE_URL}${endpoint}')
print(response.headers.get('Content-Type'))
print(response.content[:20])`
    : `import requests

response = requests.post(
    '${BASE_URL}${endpoint}',
    json=${JSON.stringify(sampleBody, null, 4).replace(/"/g, "'")},
    headers={'Content-Type': 'application/json'}
)

print(response.headers.get('Content-Type'))
print(response.content[:20])`;

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

  if (supportsFile) {
    const fields = api.params.map((param) => {
      if (param.type === 'file') return `${param.name}: <binary image file>`;
      if (param.name === 'option') return `${param.name}: hitam | nerd`;
      if (param.type === 'boolean' && param.example !== undefined) return `${param.name}: ${String(param.example).toLowerCase()}`;
      if (param.type === 'number' && param.example !== undefined) return `${param.name}: ${Number(param.example)}`;
      if (param.example !== undefined) return `${param.name}: ${param.example}`;
      return `${param.name}: <${param.name}>`;
    });
    return fields.join('\n');
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
  if (action.includes('/api/brat/') || action.includes('/api/quote') || action.includes('/api/smeme') || action.includes('/api/miq/') || action === '/mcapi/render/head') {
    return 'Content-Type: image/png\n\n[Binary image response]';
  }
  if (action.includes('/api/youtube/mp3')) {
    return JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'MP3 download link generated',
      data: {
        title: 'Never Gonna Give You Up',
        download: `${BASE_URL}/download/never-gonna-give-you-up.mp3`,
        format: 'audio/mpeg',
        fileSize: '3.20 MB',
        duration: '3 menit, 32 detik',
        author: 'Rick Astley'
      },
      timestamp: '2026-04-18T10:00:00.000Z'
    }, null, 2);
  }
  if (action.includes('/api/youtube/mp4')) {
    return JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'MP4 download link generated',
      data: {
        title: 'Never Gonna Give You Up',
        download: `${BASE_URL}/download/never-gonna-give-you-up.mp4`,
        format: 'video/mp4',
        fileSize: '12.40 MB',
        duration: '3 menit, 32 detik',
        quality: '720p'
      },
      timestamp: '2026-04-18T10:00:00.000Z'
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
          username: '@username'
        },
        media: {
          video: {
            nowm: 'https://example.com/video-nowm.mp4',
            hd: 'https://example.com/video-hd.mp4'
          },
          audio: 'https://example.com/audio.mp3'
        }
      },
      timestamp: '2026-04-18T10:00:00.000Z'
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
            type: 'video'
          }
        ],
        count: 1
      },
      timestamp: '2026-04-18T10:00:00.000Z'
    }, null, 2);
  }
  if (action.includes('/api/gdrive')) {
    return JSON.stringify({
      status: 200,
      creator: 'Arnov',
      result: {
        data: 'https://drive.google.com/uc?export=download&id=...',
        fileName: 'example.zip',
        fileSize: '1024.00 KB',
        mimetype: 'application/zip'
      }
    }, null, 2);
  }
  if (action.includes('/api/promosi')) {
    return JSON.stringify({
      status: 200,
      creator: 'Arnov',
      result: {
        percentage: 88,
        isPromotion: true,
        reason: 'Mengandung ajakan promosi dan penawaran yang jelas.'
      }
    }, null, 2);
  }
  if (action === '/mcapi/profile') {
    return JSON.stringify({
      ok: true,
      data: {
        edition: 'java',
        username: 'Dream',
        id: '8667ba71-b85a-4004-af54-457a9734eed7',
        linked: false,
        textures: {
          skin: 'https://textures.minecraft.net/texture/...'
        },
        java: {
          uuid: '8667ba71-b85a-4004-af54-457a9734eed7',
          username: 'Dream'
        }
      }
    }, null, 2);
  }
  if (action.includes('/mcapi/profile/:edition/:id/skin')) {
    return 'HTTP/1.1 302 Found\nLocation: https://textures.minecraft.net/texture/...';
  }
  if (action === '/health') {
    return JSON.stringify({
      status: 'healthy',
      timestamp: '2026-04-18T10:00:00.000Z',
      uptime: 1234.56
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
        uptime: 1234
      },
      timestamp: '2026-04-18T10:00:00.000Z'
    }, null, 2);
  }
  return JSON.stringify({ success: true, statusCode: 200, message: 'Success', data: {}, timestamp: '2026-04-10T00:00:00.000Z' }, null, 2);
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
    color: 'Untuk Make It A Quote gunakan true atau false. Untuk smeme isi warna teks seperti white,black',
    preset: 'Pilih tema: bratdeluxe, brat, atau custom',
    bgColor: 'Warna latar dalam format hex, contoh: #e4ff3d',
    textColor: 'Warna teks dalam format hex, contoh: #000000',
    top: 'Teks bagian atas meme',
    bottom: 'Teks bagian bawah meme',
    format: 'Format output: png, jpg, gif, atau webp',
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
  };
  return descriptions[name] || '';
}

function selPreset(value, element) {
  selectedPreset = value;
  document.querySelectorAll('.preset-btn').forEach((button) => {
    if (!button.getAttribute('onclick').includes('selOpt')) button.classList.remove('sel');
  });
  element.classList.add('sel');
  const colorWrap = document.getElementById('colorWrap');
  if (colorWrap) colorWrap.style.display = value === 'custom' ? 'block' : 'none';
}

function selOpt(value, element) {
  selectedOption = value;
  document.querySelectorAll('.preset-btn').forEach((button) => {
    if (button.getAttribute('onclick').includes('selOpt')) button.classList.remove('sel');
  });
  element.classList.add('sel');
  const hiddenInput = document.getElementById('f-option');
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

  const body = {};
  if (api.params) {
    api.params.forEach((param) => {
      if (['bgColor', 'textColor', 'preset'].includes(param.name)) return;
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

  const isBrat = api.name.toLowerCase().includes('brat');
  const isGemini = api.name.toLowerCase().includes('gemini');
  const hasFile = (api.params || []).some((param) => param.type === 'file' && document.getElementById(`f-${param.name}`)?.files?.length);

  if (isBrat) {
    body.preset = selectedPreset;
    if (selectedPreset === 'custom') {
      const bg = document.getElementById('f-bgColor');
      const textColor = document.getElementById('f-textColor');
      if (bg) body.bgColor = bg.value;
      if (textColor) body.textColor = textColor.value;
    }
  }

  if (isGemini) {
    const option = document.getElementById('f-option');
    if (option) body.option = option.value;
  }

  showLoading();

  const requestOptions = { method: api.method };

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
    } else {
      requestOptions.headers = { 'Content-Type': 'application/json' };
      requestOptions.body = JSON.stringify(body);
    }
  }

  fetch(api.action, requestOptions)
    .then(async (response) => {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('image/')) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const ext = contentType.includes('gif') ? 'gif' : 'png';
        showImage(url, ext, response.status, contentType);
        return;
      }

      if (contentType.includes('application/json')) {
        const json = await response.json();
        showJSON(json, response.status);
        return;
      }

      const text = await response.text();
      showError(text || 'Response tidak dikenali');
    })
    .catch((error) => showError(error.message))
    .finally(() => {
      button.disabled = false;
      button.textContent = 'Kirim Request';
    });
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
