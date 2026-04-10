setInterval(() => {
  const now = new Date();
  document.getElementById('time').textContent = now.toLocaleTimeString('id-ID');
}, 1000);

let allApis = {};
let activeCategory = 'Semua';

fetch('data/apis.json')
  .then(r => r.json())
  .then(data => {
    allApis = data;
    const total = Object.values(data).reduce((a, b) => a + b.length, 0);
    document.getElementById('totalCount').textContent = total + ' Endpoints';
    buildCategoryBar(data);
    renderApis(data);
  })
  .catch(e => console.error('Gagal muat API:', e));

function buildCategoryBar(data) {
  const bar = document.getElementById('categoryBar');
  const cats = ['Semua', ...Object.keys(data)];
  bar.innerHTML = cats.map(cat => `
    <button class="cat-btn ${cat === 'Semua' ? 'active' : ''}" onclick="filterCat('${cat}', this)">${cat}</button>
  `).join('');
}

function filterCat(cat, el) {
  activeCategory = cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const filtered = cat === 'Semua' ? allApis : { [cat]: allApis[cat] };
  renderApis(filtered);
}

function renderApis(data) {
  const grid = document.getElementById('apiGrid');
  grid.innerHTML = '';

  Object.entries(data).forEach(([cat, apis]) => {
    const group = document.createElement('div');
    group.className = 'card-group';
    group.innerHTML = `
      <div class="section-header">
        <span class="section-title">${cat}</span>
        <div class="section-line"></div>
        <span class="section-count">${apis.length}</span>
      </div>
      <div class="cards">${apis.map((api, i) => buildCard(api, i + 1)).join('')}</div>
    `;
    grid.appendChild(group);
  });
}

function buildCard(api, num) {
  const badgeClass = api.method === 'GET' ? 'badge-get' : 'badge-post';
  const endpointShort = api.action.split('?')[0];
  return `
    <div class="api-card" onclick="openModal(${JSON.stringify(api).replace(/"/g, '&quot;')})">
      <div class="card-top">
        <span class="card-name">${api.name}</span>
        <span class="method-badge ${badgeClass}">${api.method}</span>
      </div>
      <p class="card-desc">${api.description || 'Endpoint API'}</p>
      <div class="card-endpoint">${endpointShort}</div>
      <div class="card-footer">
        <button class="try-btn" onclick="event.stopPropagation(); openModal(${JSON.stringify(api).replace(/"/g, '&quot;')})">Coba &rarr;</button>
        <span class="card-num">#${String(num).padStart(2, '0')}</span>
      </div>
    </div>
  `;
}

function openModal(api) {
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');
  const badgeClass = api.method === 'GET' ? 'badge-get' : 'badge-post';

  let formHtml = '';
  if (api.method === 'POST' && api.params) {
    formHtml = api.params.map(p => {
      if (p.name === 'preset' && api.name.toLowerCase().includes('brat')) {
        return `
          <div class="form-group">
            <label class="form-label">preset</label>
            <select id="m-preset" class="form-select" onchange="toggleColorFields()">
              <option value="bratdeluxe">bratdeluxe (default)</option>
              <option value="brat">brat</option>
              <option value="custom">custom</option>
            </select>
          </div>
        `;
      } else if ((p.name === 'bgColor' || p.name === 'textColor') && api.name.toLowerCase().includes('brat')) {
        const label = p.name === 'bgColor' ? 'background color' : 'text color';
        const id = p.name === 'bgColor' ? 'm-bgColor' : 'm-textColor';
        return `<div class="form-group color-fields" id="field-${p.name}"><label class="form-label">${label}</label><input type="text" id="${id}" class="form-input" placeholder="#FF5733 atau red"></div>`;
      } else {
        return `
          <div class="form-group">
            <label class="form-label">${p.name}</label>
            <input type="text" id="m-${p.name}" class="form-input" placeholder="${p.example || 'masukkan ' + p.name}">
          </div>
        `;
      }
    }).join('');
    formHtml += `<div class="btn-row"><button class="btn-send" onclick="sendPost('${api.action}', ${JSON.stringify(api.params).replace(/"/g, '&quot;')})">Kirim Request</button></div>`;
  } else if (api.method === 'GET') {
    formHtml = `<div class="btn-row"><button class="btn-open" onclick="window.open('${api.action}', '_blank')">Buka di Browser &rarr;</button></div>`;
  }

  content.innerHTML = `
    <p class="modal-title">${api.name}</p>
    <div class="modal-badge-row">
      <span class="method-badge ${badgeClass}">${api.method}</span>
      <span class="modal-endpoint">${api.action}</span>
    </div>
    ${api.description ? `<p class="modal-desc">${api.description}</p>` : ''}
    ${formHtml}
    <div id="responseArea"></div>
  `;

  overlay.classList.add('open');
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

function toggleColorFields() {
  const sel = document.getElementById('m-preset');
  const isCustom = sel && sel.value === 'custom';
  document.querySelectorAll('.color-fields').forEach(el => {
    el.classList.toggle('show', isCustom);
  });
}

function sendPost(endpoint, params) {
  const body = {};
  params.forEach(p => {
    const id = p.name === 'bgColor' ? 'm-bgColor' : p.name === 'textColor' ? 'm-textColor' : `m-${p.name}`;
    const el = document.getElementById(id) || document.getElementById(`m-${p.name}`);
    if (el && el.value.trim()) body[p.name] = el.value.trim();
  });

  const area = document.getElementById('responseArea');
  area.innerHTML = `
    <div class="response-box">
      <div class="response-header">
        <span class="response-label">Response</span>
        <span class="response-status status-loading">Memuat...</span>
      </div>
      <div class="response-body">Mengirim request...</div>
    </div>
  `;

  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  .then(async res => {
    const ct = res.headers.get('content-type') || '';
    const statusEl = area.querySelector('.response-status');
    statusEl.className = 'response-status ' + (res.ok ? 'status-ok' : 'status-err');
    statusEl.textContent = res.status + ' ' + (res.ok ? 'OK' : 'Error');

    if (ct.includes('image/')) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const ext = ct.includes('gif') ? 'gif' : 'png';
      area.querySelector('.response-body').outerHTML = `
        <div class="img-preview">
          <img src="${url}" alt="Result">
          <br>
          <a href="${url}" download="result.${ext}" class="img-download">&#8595; Download ${ext.toUpperCase()}</a>
        </div>
      `;
      return;
    }

    const json = await res.json();
    area.querySelector('.response-body').textContent = JSON.stringify(json, null, 2);
  })
  .catch(err => {
    const statusEl = area.querySelector('.response-status');
    statusEl.className = 'response-status status-err';
    statusEl.textContent = 'Error';
    area.querySelector('.response-body').textContent = 'Error: ' + err.message;
  });
}