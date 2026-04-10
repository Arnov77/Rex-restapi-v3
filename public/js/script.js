const BASE_URL = window.location.origin || 'http://localhost:7860';
document.getElementById('baseUrl').textContent = BASE_URL;

// ── Clock ──
function tick() {
  const t = new Date().toLocaleTimeString('id-ID');
  const el = document.getElementById('clock');
  const mel = document.getElementById('mclock');
  if (el) el.textContent = t;
  if (mel) mel.textContent = t;
}
tick();
setInterval(tick, 1000);

// ── State ──
const ICONS = { 'Downloader': '⬇', 'Image Generator': '🎨', 'Status': '🟢' };
let DATA = {};
let currentApi = null;
let activeTab = 'docs';
let selectedPreset = 'bratdeluxe';
let selectedOption = 'hitam';

// ── Load Data ──
fetch('data/apis.json')
  .then(r => r.json())
  .then(data => {
    DATA = data;
    const total = Object.values(data).reduce((a, b) => a + b.length, 0);
    document.getElementById('totalEp').textContent = total;
    document.getElementById('totalCat').textContent = Object.keys(data).length;
    buildNav(data);
    renderAll(data);
    document.getElementById('searchInput').addEventListener('input', e => doSearch(e.target.value));
  });

// ── Navigation ──
function buildNav(data) {
  const nav = document.getElementById('navItems');
  const total = Object.values(data).reduce((a, b) => a + b.length, 0);
  let html = `<a class="nav-item active" onclick="showAll(this)" href="#">
    <span class="nav-icon">🏠</span><span>Semua</span>
    <span class="nav-count">${total}</span>
  </a>`;
  Object.entries(data).forEach(([cat, apis]) => {
    const icon = ICONS[cat] || '📦';
    html += `<a class="nav-item" onclick="showCat('${cat}', this)" href="#${slugify(cat)}">
      <span class="nav-icon">${icon}</span><span>${cat}</span>
      <span class="nav-count">${apis.length}</span>
    </a>`;
  });
  nav.innerHTML = html;
}

function slugify(s) { return s.toLowerCase().replace(/\s+/g, '-'); }

function showAll(el) {
  setActive(el);
  document.getElementById('activeTitle').textContent = 'Semua Endpoint';
  renderAll(DATA);
  if (window.innerWidth <= 768) closeMobileMenu(); // <--- Menutup menu di HP
}

function showCat(cat, el) {
  setActive(el);
  document.getElementById('activeTitle').textContent = cat;
  document.getElementById('mainContent').innerHTML = renderSection(cat, DATA[cat]);
  setTimeout(() => document.getElementById(slugify(cat))?.scrollIntoView({ behavior: 'smooth' }), 50);
  if (window.innerWidth <= 768) closeMobileMenu(); // <--- Menutup menu di HP
}

function setActive(el) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
}

function doSearch(q) {
  if (!q.trim()) { renderAll(DATA); return; }
  const low = q.toLowerCase();
  const filtered = {};
  Object.entries(DATA).forEach(([cat, apis]) => {
    const m = apis.filter(a =>
      a.name.toLowerCase().includes(low) ||
      (a.description || '').toLowerCase().includes(low) ||
      a.action.toLowerCase().includes(low)
    );
    if (m.length) filtered[cat] = m;
  });
  renderAll(filtered);
}

// ── Render Cards ──
function renderAll(data) {
  document.getElementById('mainContent').innerHTML = Object.entries(data)
    .map(([cat, apis]) => renderSection(cat, apis))
    .join('');
}

function renderSection(cat, apis) {
  const icon = ICONS[cat] || '📦';
  return `<div class="section" id="${slugify(cat)}">
    <div class="section-head">
      <div class="section-icon">${icon}</div>
      <div class="section-info">
        <div class="title">${cat}</div>
        <div class="sub">Klik endpoint untuk dokumentasi &amp; uji coba</div>
      </div>
      <div class="ep-count">${apis.length} endpoints</div>
    </div>
    ${apis.map(api => renderCard(api)).join('')}
  </div>`;
}

function renderCard(api) {
  const mc = api.method === 'GET' ? 'm-get' : 'm-post';
  const path = api.action.split('?')[0];
  return `<div class="api-card" onclick="openModal(${esc(api)})">
    <div class="card-row">
      <span class="mtag ${mc}">${api.method}</span>
      <div class="card-info">
        <div class="card-title">${api.name}</div>
        <div class="card-desc">${api.description || ''}</div>
        <div class="card-path">${path}</div>
      </div>
      <button class="test-btn" onclick="event.stopPropagation(); openModal(${esc(api)})">Buka ↗</button>
    </div>
    <div class="params-chips">${buildChips(api)}</div>
  </div>`;
}

function buildChips(api) {
  if (!api.params || api.params.length === 0) {
    if (api.method === 'GET' && api.action.includes('?')) {
      return api.action.split('?')[1].split('&').map(p => {
        const k = p.split('=')[0];
        return `<div class="chip"><span class="chip-name">${k}</span><span class="chip-type">string</span><span class="chip-opt">query</span></div>`;
      }).join('');
    }
    return '<span class="no-params">Tidak ada parameter</span>';
  }
  return api.params.map(p => {
    const badge = p.required === false
      ? `<span class="chip-opt">opsional</span>`
      : `<span class="chip-req">wajib</span>`;
    const typeBadge = p.type === 'select'
      ? `<span class="chip-sel">select</span>`
      : `<span class="chip-type">${p.type || 'string'}</span>`;
    return `<div class="chip"><span class="chip-name">${p.name}</span>${typeBadge}${badge}</div>`;
  }).join('');
}

function esc(obj) { return JSON.stringify(obj).replace(/"/g, '&quot;'); }

// ── Modal ──
function openModal(api) {
  currentApi = api;
  activeTab = 'docs';
  selectedPreset = 'bratdeluxe';
  selectedOption = 'hitam';

  const mc = api.method === 'GET' ? 'm-get' : 'm-post';
  document.getElementById('mName').textContent = api.name;
  const mm = document.getElementById('mMethod');
  mm.textContent = api.method;
  mm.className = 'mtag ' + mc;
  document.getElementById('mPath').textContent = api.action.split('?')[0];
  document.getElementById('mDesc').textContent = api.description || '';

  buildTabs(api);
  document.getElementById('overlay').classList.add('open');
  document.getElementById('overlay').onclick = e => {
    if (e.target === document.getElementById('overlay')) closeModal();
  };
}

function closeModal() {
  document.getElementById('overlay').classList.remove('open');
  currentApi = null;
}

function buildTabs(api) {
  const isGet = api.method === 'GET';
  const tabs = isGet ? ['docs'] : ['docs', 'try', 'code'];
  const labels = { docs: '📄 Dokumentasi', try: '▶ Coba Langsung', code: '</> Kode Integrasi' };
  document.getElementById('tabRow').innerHTML = tabs.map(t =>
    `<div class="tab ${t === activeTab ? 'active' : ''}" onclick="switchTab('${t}')">${labels[t]}</div>`
  ).join('');
  renderTabBody(api, activeTab);
}

function switchTab(t) {
  activeTab = t;
  buildTabs(currentApi);
}

function renderTabBody(api, tab) {
  const body = document.getElementById('tabBody');
  if (tab === 'docs') body.innerHTML = buildDocsTab(api);
  else if (tab === 'try') body.innerHTML = buildTryTab(api);
  else if (tab === 'code') body.innerHTML = buildCodeTab(api);
}

// ── Tab: Dokumentasi ──
function buildDocsTab(api) {
  const isGet = api.method === 'GET';
  let paramSection = '';

  if (api.params && api.params.length > 0) {
    const rows = api.params.map(p => {
      const req = p.required === false
        ? '<span class="popt">opsional</span>'
        : '<span class="preq">wajib</span>';
      const typeStr = p.type === 'select' ? 'select (string)' : (p.type || 'string');
      const desc = getParamDesc(p.name, api);
      const example = p.example ? `<div class="pexample">Contoh: ${p.example}</div>` : '';
      return `<tr>
        <td><span class="pname">${p.name}</span></td>
        <td><span class="ptype-badge">${typeStr}</span></td>
        <td>${req}</td>
        <td><span class="pdesc">${desc}</span>${example}</td>
      </tr>`;
    }).join('');
    paramSection = `<div style="margin-bottom:18px">
      <div class="section-sub-label">Parameter</div>
      <table class="param-table">
        <thead><tr><th>Nama</th><th>Tipe</th><th>Status</th><th>Keterangan</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  } else if (isGet && api.action.includes('?')) {
    paramSection = `<div style="margin-bottom:18px">
      <div class="section-sub-label">Query Parameters</div>
      <div class="info-box">Parameter sudah tertanam di URL. Gunakan endpoint langsung di browser.</div>
    </div>`;
  } else {
    paramSection = `<div style="margin-bottom:18px">
      <div class="info-box">Endpoint ini tidak membutuhkan parameter.</div>
    </div>`;
  }

  const reqBody = buildRequestBodyExample(api);
  const reqSection = reqBody ? `<div style="margin-bottom:18px">
    <div class="section-sub-label">Request Body (JSON)</div>
    <div class="response-schema">${reqBody}</div>
  </div>` : '';

  const resExample = buildResponseExample(api);
  const getBtn = isGet
    ? `<div style="margin-top:16px"><button class="get-open-btn" onclick="window.open('${api.action}','_blank')">Buka Endpoint di Browser ↗</button></div>`
    : '';

  return `${paramSection}${reqSection}
  <div style="margin-bottom:0">
    <div class="section-sub-label">Contoh Response</div>
    <div class="response-schema">${resExample}</div>
  </div>
  ${getBtn}`;
}

// ── Tab: Try It ──
function buildTryTab(api) {
  const isBrat = api.name.toLowerCase().includes('brat');
  const isGemini = api.name.toLowerCase().includes('gemini') || api.name.toLowerCase().includes('ai image');
  let fields = '';

  if (api.params) {
    api.params.forEach(p => {
      if (isBrat && (p.name === 'bgColor' || p.name === 'textColor' || p.name === 'preset')) return;
      const req = p.required === false
        ? `<span class="chip-opt" style="font-size:10px">opsional</span>`
        : `<span class="chip-req" style="font-size:10px">wajib</span>`;
      const hint = p.example || `masukkan ${p.name}`;
      const inputType = (p.name === 'url' || p.name === 'image') ? 'url' : 'text';
      const desc = getParamDesc(p.name, api);
      fields += `<div class="form-section">
        <div class="form-label"><span class="form-label-text">${p.name}</span>${req}</div>
        <input type="${inputType}" class="form-input" id="f-${p.name}" placeholder="${hint}">
        ${desc ? `<div class="form-hint">${desc}</div>` : ''}
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
    <button class="btn-primary" id="sendBtn" onclick="sendReq()">Kirim Request ↗</button>
  </div>
  <div id="responseArea"></div>`;
}

// ── Tab: Code ──
function buildCodeTab(api) {
  const endpoint = api.action.split('?')[0];
  const sampleBody = buildSampleBody(api);
  const bodyStr = JSON.stringify(sampleBody, null, 2);

  const curl = `curl -X POST ${BASE_URL}${endpoint} \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(sampleBody)}'`;

  const fetchCode = `const response = await fetch('${BASE_URL}${endpoint}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${bodyStr})
});

const contentType = response.headers.get('content-type');
if (contentType && contentType.includes('image/')) {
  // Response berupa gambar (brat, dll)
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  document.querySelector('img').src = url;
} else {
  // Response JSON
  const data = await response.json();
  console.log(data);
}`;

  const axiosCode = `import axios from 'axios';

// Untuk endpoint yang return gambar:
const res = await axios.post('${BASE_URL}${endpoint}',
  ${bodyStr},
  { responseType: 'arraybuffer' }
);
const blob = new Blob([res.data], { type: res.headers['content-type'] });
const url = URL.createObjectURL(blob);

// Untuk endpoint yang return JSON:
// const res = await axios.post('${BASE_URL}${endpoint}', ${JSON.stringify(sampleBody)});
// console.log(res.data);`;

  const pythonCode = `import requests

response = requests.post(
    '${BASE_URL}${endpoint}',
    json=${JSON.stringify(sampleBody, null, 4).replace(/"/g, "'")},
    headers={'Content-Type': 'application/json'}
)

# Jika response gambar (brat, dll):
if 'image' in response.headers.get('Content-Type', ''):
    with open('output.png', 'wb') as f:
        f.write(response.content)
    print('Gambar disimpan!')
else:
    data = response.json()
    print(data)`;

  return `<div class="code-tabs">
    <div class="ctab active" onclick="switchCode('curl', this)">cURL</div>
    <div class="ctab" onclick="switchCode('fetch', this)">JS Fetch</div>
    <div class="ctab" onclick="switchCode('axios', this)">Axios</div>
    <div class="ctab" onclick="switchCode('python', this)">Python</div>
  </div>
  <div id="code-curl" class="code-block">${escHtml(curl)}<button class="copy-btn" onclick="copyCode('code-curl')">Copy</button></div>
  <div id="code-fetch" class="code-block" style="display:none">${escHtml(fetchCode)}<button class="copy-btn" onclick="copyCode('code-fetch')">Copy</button></div>
  <div id="code-axios" class="code-block" style="display:none">${escHtml(axiosCode)}<button class="copy-btn" onclick="copyCode('code-axios')">Copy</button></div>
  <div id="code-python" class="code-block" style="display:none">${escHtml(pythonCode)}<button class="copy-btn" onclick="copyCode('code-python')">Copy</button></div>
  <div style="margin-top:14px" class="info-box">
    <span style="font-family:var(--mono);font-size:10px;color:var(--tx3);display:block;margin-bottom:4px">CATATAN</span>
    Endpoint <code style="font-family:var(--mono);color:var(--accent);font-size:11px">${endpoint}</code>
    mengembalikan data binary image/png (atau image/gif untuk video). Tangani response sebagai buffer, bukan JSON.
  </div>`;
}

function switchCode(lang, el) {
  document.querySelectorAll('.ctab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['curl', 'fetch', 'axios', 'python'].forEach(l => {
    const block = document.getElementById('code-' + l);
    if (block) block.style.display = l === lang ? 'block' : 'none';
  });
}

function copyCode(id) {
  const block = document.getElementById(id);
  const text = block.innerText.replace(/^Copy$|^Copied!$/gm, '').trim();
  navigator.clipboard.writeText(text).then(() => {
    const btn = block.querySelector('.copy-btn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1800);
  });
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Helpers ──
function buildSampleBody(api) {
  if (!api.params) return {};
  const body = {};
  api.params.forEach(p => {
    if (p.required === false) return;
    if (p.example) body[p.name] = p.example;
    else if (p.name === 'preset') body[p.name] = 'bratdeluxe';
    else if (p.name === 'option') body[p.name] = 'hitam';
    else body[p.name] = `<${p.name}>`;
  });
  return body;
}

function buildRequestBodyExample(api) {
  if (!api.params || api.params.length === 0 || api.method === 'GET') return null;
  const body = {};
  api.params.forEach(p => {
    if (p.name === 'bgColor') body[p.name] = '#e4ff3d  (opsional, khusus custom preset)';
    else if (p.name === 'textColor') body[p.name] = '#000000  (opsional)';
    else if (p.name === 'preset') body[p.name] = 'bratdeluxe | brat | custom';
    else if (p.name === 'option') body[p.name] = 'hitam | nerd';
    else if (p.example) body[p.name] = p.example;
    else body[p.name] = `<${p.name}>`;
  });
  return JSON.stringify(body, null, 2);
}

function buildResponseExample(api) {
  const isBrat = api.name.toLowerCase().includes('brat');
  const isYT = api.action.includes('youtube');
  const isTikTok = api.action.includes('tiktok');
  const isIG = api.action.includes('instagram');
  if (isBrat) return `// Content-Type: image/png\n// Untuk Brat GIF  : image/gif\n\n[Binary Image Buffer]`;
  if (isYT) return JSON.stringify({ success: true, statusCode: 200, message: 'MP3 download link generated', data: { title: 'Nama Video', download: 'http://localhost:7860/download/nama-video.mp3', format: 'audio/mpeg', fileSize: '3.2 MB', duration: '3 menit, 32 detik', author: 'Channel Name' } }, null, 2);
  if (isTikTok) return JSON.stringify({ success: true, statusCode: 200, data: { title: 'Judul Video', author: { name: 'Nama', username: '@username' }, media: { video: { nowm: 'https://...', hd: 'https://...' } } } }, null, 2);
  if (isIG) return JSON.stringify({ success: true, statusCode: 200, data: { downloadLinks: [{ url: 'https://...', type: 'video' }], count: 1 } }, null, 2);
  return JSON.stringify({ success: true, statusCode: 200, message: 'Success', data: {}, timestamp: '2026-04-10T00:00:00.000Z' }, null, 2);
}

function getParamDesc(name) {
  const descs = {
    text: 'Teks yang akan ditampilkan di gambar',
    url: 'URL lengkap termasuk https://',
    query: 'Judul video/lagu atau URL YouTube langsung',
    image: 'URL gambar yang ingin dimodifikasi dengan AI',
    name: 'Nama pengirim pesan',
    message: 'Isi pesan yang akan ditampilkan',
    option: 'Pilih transformasi AI: hitam atau nerd',
    preset: 'Pilih tema: bratdeluxe (default), brat, atau custom',
    bgColor: 'Hex color background, contoh: #e4ff3d',
    textColor: 'Hex color teks, contoh: #000000',
  };
  return descs[name] || '';
}

// ── Preset & Color ──
function selPreset(v, el) {
  selectedPreset = v;
  document.querySelectorAll('.preset-btn').forEach(b => {
    if (!b.getAttribute('onclick').includes('selOpt')) b.classList.remove('sel');
  });
  el.classList.add('sel');
  const cw = document.getElementById('colorWrap');
  if (cw) cw.style.display = v === 'custom' ? 'block' : 'none';
}

function selOpt(v, el) {
  selectedOption = v;
  document.querySelectorAll('.preset-btn').forEach(b => {
    if (b.getAttribute('onclick').includes('selOpt')) b.classList.remove('sel');
  });
  el.classList.add('sel');
  const hi = document.getElementById('f-option');
  if (hi) hi.value = v;
}

function syncC(name) {
  const p = document.getElementById(`f-${name}-pick`);
  const t = document.getElementById(`f-${name}`);
  if (p && t) t.value = p.value;
}

function syncP(name) {
  const t = document.getElementById(`f-${name}`);
  const p = document.getElementById(`f-${name}-pick`);
  if (p && t && /^#[0-9a-fA-F]{6}$/.test(t.value)) p.value = t.value;
}

// ── Send Request ──
function sendReq() {
  if (!currentApi) return;
  const api = currentApi;
  const btn = document.getElementById('sendBtn');
  btn.disabled = true;
  btn.textContent = 'Mengirim...';

  const body = {};
  if (api.params) {
    api.params.forEach(p => {
      if (p.name === 'bgColor' || p.name === 'textColor' || p.name === 'preset') return;
      const el = document.getElementById(`f-${p.name}`);
      if (el && el.value.trim()) body[p.name] = el.value.trim();
    });
  }

  const isBrat = api.name.toLowerCase().includes('brat');
  const isGemini = api.name.toLowerCase().includes('gemini') || api.name.toLowerCase().includes('ai image');

  if (isBrat) {
    body.preset = selectedPreset;
    if (selectedPreset === 'custom') {
      const bg = document.getElementById('f-bgColor');
      const tc = document.getElementById('f-textColor');
      if (bg) body.bgColor = bg.value;
      if (tc) body.textColor = tc.value;
    }
  }
  if (isGemini) {
    const opt = document.getElementById('f-option');
    if (opt) body.option = opt.value;
  }

  showLoading();

  fetch(api.action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  .then(async res => {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('image/')) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const ext = ct.includes('gif') ? 'gif' : 'png';
      showImage(url, ext, res.status, ct);
    } else {
      const json = await res.json();
      showJSON(json, res.status);
    }
  })
  .catch(err => showError(err.message))
  .finally(() => {
    btn.disabled = false;
    btn.textContent = 'Kirim Request ↗';
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

function showImage(url, ext, status, ct) {
  document.getElementById('responseArea').innerHTML = `<div class="response-area">
    <div class="res-bar"><span class="res-label">Response</span><span class="res-status s-ok">${status} OK — ${ct}</span></div>
    <div class="img-result">
      <img src="${url}" alt="Hasil">
      <br>
      <a href="${url}" download="result.${ext}" class="img-dl">⬇ Download ${ext.toUpperCase()}</a>
      <div class="img-note">Gunakan URL ini langsung sebagai src di app kamu, atau unduh file-nya.</div>
    </div>
  </div>`;
}

function showError(msg) {
  document.getElementById('responseArea').innerHTML = `<div class="response-area">
    <div class="res-bar"><span class="res-label">Response</span><span class="res-status s-err">Error</span></div>
    <div class="res-body">Error: ${msg}</div>
  </div>`;
}

// ── Mobile Sidebar Menu ──
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const sidebar = document.getElementById('sidebar');
const mobileOverlay = document.getElementById('mobileOverlay');

function closeMobileMenu() {
  sidebar.classList.remove('open');
  mobileOverlay.classList.remove('active');
  setTimeout(() => mobileOverlay.style.display = 'none', 300);
}

function toggleMobileMenu() {
  const isOpen = sidebar.classList.contains('open');
  if (isOpen) {
    closeMobileMenu();
  } else {
    sidebar.classList.add('open');
    mobileOverlay.style.display = 'block';
    // Timeout sedikit agar animasi CSS berjalan
    setTimeout(() => mobileOverlay.classList.add('active'), 10);
  }
}

if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', toggleMobileMenu);
if (mobileOverlay) mobileOverlay.addEventListener('click', closeMobileMenu);