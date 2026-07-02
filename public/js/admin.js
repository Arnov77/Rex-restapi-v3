/**
 * Rex API — admin console (master-only).
 * Surfaces: Health pill, Pool stats, API Keys table, Audit Log.
 */

import { createApp, h, reactive, ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';

const LS_MASTER = 'rex.masterApiKey';
const POLL_HEALTH_MS = 5000;
const POLL_POOL_MS = 5000;

// ─────────────────────────────────────────────────────────────────────
// API client
// ─────────────────────────────────────────────────────────────────────
function makeApi(getKey) {
  async function call(method, path, { body, headers = {}, signal } = {}) {
    const key = getKey();
    if (!key) throw new Error('Master API key not set');
    const reqHeaders = { 'X-API-Key': key, Accept: 'application/json', ...headers };
    if (body !== undefined) reqHeaders['Content-Type'] = 'application/json';
    const res = await fetch(path, {
      method,
      headers: reqHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    let payload = null;
    try { payload = await res.json(); } catch { /* */ }
    if (!res.ok) {
      const msg = payload?.error?.message ?? payload?.message ?? `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.body = payload;
      throw err;
    }
    return payload;
  }
  return {
    listKeys: ({ includeRevoked = true } = {}) =>
      call('GET', `/api/keys/?includeRevoked=${includeRevoked ? 'true' : 'false'}`),
    createKey: (input) => call('POST', '/api/keys/', { body: input }),
    revokeKey: (id) => call('DELETE', `/api/keys/${id}`),
    updateKey: (id, patch) => call('PATCH', `/api/keys/${id}`, { body: patch }),
    regenerateKey: (id) => call('POST', `/api/keys/${id}/regenerate`),
    activateKey: (id) => call('POST', `/api/keys/${id}/activate`),
    poolStats: ({ signal } = {}) => call('GET', '/api/keys/pool-stats', { signal }),
    listAuditLog: ({ limit = 50, offset = 0, action, targetKeyId } = {}) => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (action) params.set('action', action);
      if (targetKeyId) params.set('targetKeyId', targetKeyId);
      return call('GET', `/api/keys/audit-log/?${params}`);
    },
    listUsers: ({ limit = 50, offset = 0, search } = {}) => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (search) params.set('search', search);
      return call('GET', `/api/admin/users/?${params}`);
    },
<<<<<<< HEAD
=======
    listStickerPacks: () => call('GET', '/api/admin/memesticker/packs/'),
    addStickerPack: (body) => call('POST', '/api/admin/memesticker/packs/', { body }),
    setStickerPackActive: (id, active) => call('PATCH', `/api/admin/memesticker/packs/${id}`, { body: { active } }),
    deleteStickerPack: (id) => call('DELETE', `/api/admin/memesticker/packs/${id}`),
>>>>>>> ef8e6ddfefb5b202852d51112a951f2d2b1659af
  };
}



// ─────────────────────────────────────────────────────────────────────
// Health pill
// ─────────────────────────────────────────────────────────────────────
const HealthPill = {
  name: 'HealthPill',
  setup() {
    const state = reactive({ status: 'idle', db: '?', browser: '?', updatedAt: null, error: null });
    let timer = null;
    async function probe() {
      try {
        const res = await fetch('/api/ready', { headers: { Accept: 'application/json' } });
        let body = null;
        try { body = await res.json(); } catch { /* */ }
        if (res.ok && body?.ok) { state.status = 'ok'; } else { state.status = 'err'; }
        state.db = body?.db ?? '?';
        state.browser = body?.browser ?? '?';
        state.error = null;
      } catch (err) {
        state.status = 'err'; state.db = '?'; state.browser = '?'; state.error = err.message;
      }
      state.updatedAt = new Date();
    }
    onMounted(() => { probe(); timer = setInterval(probe, POLL_HEALTH_MS); });
    onBeforeUnmount(() => { if (timer) clearInterval(timer); });
    return () => h('div', { class: 'card' }, [
      h('h3', 'Health'),
      h('div', { class: 'health-pill-row' }, [
        h('div', { class: `pill ${state.status === 'ok' ? 'ok' : state.status === 'err' ? 'err' : 'idle'}` }, [
          h('span', { class: 'dot' }),
          h('span', state.status === 'ok' ? 'Ready' : state.status === 'err' ? 'Degraded' : 'Checking…'),
        ]),
        h('span', { class: 'health-meta' }, state.status === 'idle' ? '—' : `db: ${state.db} · browser: ${state.browser}`),
      ]),
      state.error ? h('div', { class: 'health-meta', style: 'margin-top:8px;color:var(--err)' }, state.error) : null,
      state.updatedAt ? h('div', { class: 'health-meta', style: 'margin-top:6px' }, `Last checked ${state.updatedAt.toLocaleTimeString()}`) : null,
    ]);
  },
};

// ─────────────────────────────────────────────────────────────────────
// Pool stats widget
// ─────────────────────────────────────────────────────────────────────
const PoolStatsWidget = {
  name: 'PoolStatsWidget',
  props: { api: { type: Object, required: true } },
  setup(props) {
    const stats = ref(null);
    const error = ref(null);
    let timer = null;
    let aborter = null;
    async function tick() {
      if (aborter) aborter.abort();
      aborter = new AbortController();
      try {
        const r = await props.api.poolStats({ signal: aborter.signal });
        stats.value = r.data; error.value = null;
      } catch (err) { if (err.name === 'AbortError') return; error.value = err.message; }
    }
    onMounted(() => { tick(); timer = setInterval(tick, POLL_POOL_MS); });
    onBeforeUnmount(() => { if (timer) clearInterval(timer); if (aborter) aborter.abort(); });
    return () => {
      const s = stats.value;
      const fields = [
        { l: 'Size', v: s?.size ?? '—' }, { l: 'Created', v: s?.created ?? '—' },
        { l: 'Busy', v: s?.busy ?? '—', warn: s && s.size > 0 && s.busy === s.size },
        { l: 'Idle', v: s?.idle ?? '—' }, { l: 'Queued', v: s?.queued ?? '—', err: s?.queued > 0 },
        { l: 'Acquired', v: s?.acquireCount ?? '—' }, { l: 'Released', v: s?.releaseCount ?? '—' },
        { l: 'Timeouts', v: s?.timeoutCount ?? '—', err: s?.timeoutCount > 0 },
      ];
      return h('div', { class: 'card' }, [
        h('h3', 'Page Pool'),
        error.value ? h('div', { style: 'color:var(--err);font-size:12px;margin-bottom:8px' }, error.value) : null,
        h('div', { class: 'pool-grid' }, fields.map(({ l, v, warn, err }) =>
          h('div', { class: 'metric' }, [
            h('div', { class: ['v', warn ? 'warn' : '', err ? 'err' : ''].filter(Boolean).join(' ') }, String(v)),
            h('div', { class: 'l' }, l),
          ]))),
      ]);
    };
  },
};



// ─────────────────────────────────────────────────────────────────────
// Auth gate
// ─────────────────────────────────────────────────────────────────────
const AuthGate = {
  name: 'AuthGate',
  emits: ['authed'],
  setup(_, { emit }) {
    const candidate = ref('');
    const error = ref(null);
    const loading = ref(false);
    async function submit() {
      const key = candidate.value.trim();
      if (!key) { error.value = 'Paste a master API key'; return; }
      loading.value = true; error.value = null;
      try {
        const res = await fetch('/api/keys/?includeRevoked=false', { headers: { 'X-API-Key': key, Accept: 'application/json' } });
        if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.error?.message ?? `HTTP ${res.status}`); }
        localStorage.setItem(LS_MASTER, key); emit('authed', key);
      } catch (err) { error.value = err.message; } finally { loading.value = false; }
    }
    return () => h('div', { class: 'auth-gate' }, [
      h('h2', 'Admin access'),
      h('p', 'Paste a master API key to unlock the console. Stored locally in your browser only.'),
      h('label', { for: 'master-key' }, 'Master API key'),
      h('input', { id: 'master-key', class: 'input mono', type: 'password', autocomplete: 'off', placeholder: 'rex_…', value: candidate.value, onInput: (e) => (candidate.value = e.target.value), onKeydown: (e) => { if (e.key === 'Enter') submit(); } }),
      error.value ? h('div', { class: 'err' }, error.value) : null,
      h('div', { style: 'margin-top:16px;display:flex;justify-content:flex-end;gap:8px' }, [
        h('a', { href: '/', class: 'btn ghost' }, 'Cancel'),
        h('button', { class: 'btn primary', disabled: loading.value, onClick: submit }, loading.value ? 'Verifying…' : 'Unlock'),
      ]),
    ]);
  },
};

// ─────────────────────────────────────────────────────────────────────
// Modals
// ─────────────────────────────────────────────────────────────────────
function ModalShell(title, body, footer) {
  return h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
      h('h3', title), body, footer ? h('div', { class: 'actions' }, footer) : null,
    ]),
  ]);
}

const CreateKeyModal = {
  name: 'CreateKeyModal',
  props: { api: { type: Object, required: true } },
  emits: ['close', 'created'],
  setup(props, { emit }) {
    const form = reactive({ name: '', tier: 'user', dailyLimit: '', storeEncrypted: false });
    const error = ref(null);
    const submitting = ref(false);
    async function submit() {
      if (!form.name.trim()) { error.value = 'Name is required'; return; }
      submitting.value = true; error.value = null;
      try {
        const body = { name: form.name.trim(), tier: form.tier, dailyLimit: form.dailyLimit === '' ? null : Number(form.dailyLimit), storeEncrypted: form.storeEncrypted };
        if (body.dailyLimit !== null && (!Number.isInteger(body.dailyLimit) || body.dailyLimit < 0)) throw new Error('Daily limit must be a non-negative integer or empty for unlimited');
        const r = await props.api.createKey(body);
        emit('created', r.data);
      } catch (err) { error.value = err.message; } finally { submitting.value = false; }
    }
    return () => ModalShell('Create new API key',
      h('div', null, [
        h('div', { class: 'field' }, [h('label', 'Name'), h('input', { class: 'input', placeholder: 'e.g. whatsapp-bot-prod', value: form.name, onInput: (e) => (form.name = e.target.value) })]),
        h('div', { class: 'field' }, [h('label', 'Tier'), h('select', { class: 'input', value: form.tier, onChange: (e) => (form.tier = e.target.value) }, [h('option', { value: 'user' }, 'user'), h('option', { value: 'master' }, 'master')])]),
        h('div', { class: 'field' }, [h('label', 'Daily limit (empty = unlimited)'), h('input', { class: 'input', type: 'number', min: '0', step: '1', placeholder: 'e.g. 1000', value: form.dailyLimit, onInput: (e) => (form.dailyLimit = e.target.value) })]),
        h('div', { class: 'field' }, [h('label', { class: 'checkbox' }, [h('input', { type: 'checkbox', checked: form.storeEncrypted, onChange: (e) => (form.storeEncrypted = e.target.checked) }), h('span', 'Store encrypted')]), h('div', { class: 'hint' }, 'Master keys always encrypted. User keys default off.')]),
        error.value ? h('div', { style: 'color:var(--err);font-size:12px;margin-top:8px' }, error.value) : null,
      ]),
      [h('button', { class: 'btn ghost', onClick: () => emit('close') }, 'Cancel'), h('button', { class: 'btn primary', disabled: submitting.value, onClick: submit }, submitting.value ? 'Creating…' : 'Create')],
    );
  },
};

const EditLimitModal = {
  name: 'EditLimitModal',
  props: { api: { type: Object, required: true }, keyRow: { type: Object, required: true } },
  emits: ['close', 'updated'],
  setup(props, { emit }) {
    const value = ref(props.keyRow.dailyLimit == null ? '' : String(props.keyRow.dailyLimit));
    const error = ref(null);
    const submitting = ref(false);
    async function submit() {
      submitting.value = true; error.value = null;
      try {
        const v = value.value === '' ? null : Number(value.value);
        if (v !== null && (!Number.isInteger(v) || v < 0)) throw new Error('Must be non-negative integer or empty');
        const r = await props.api.updateKey(props.keyRow.id, { dailyLimit: v });
        emit('updated', r.data.key);
      } catch (err) { error.value = err.message; } finally { submitting.value = false; }
    }
    return () => ModalShell(`Edit daily limit — ${props.keyRow.name}`,
      h('div', null, [
        h('div', { class: 'field' }, [h('label', 'Daily limit (empty = unlimited)'), h('input', { class: 'input', type: 'number', min: '0', step: '1', value: value.value, onInput: (e) => (value.value = e.target.value), onKeydown: (e) => { if (e.key === 'Enter') submit(); } }), h('div', { class: 'hint' }, `Current: ${props.keyRow.dailyLimit == null ? '\u221E unlimited' : props.keyRow.dailyLimit.toLocaleString() + '/day'}`)]),
        error.value ? h('div', { style: 'color:var(--err);font-size:12px;margin-top:8px' }, error.value) : null,
      ]),
      [h('button', { class: 'btn ghost', onClick: () => emit('close') }, 'Cancel'), h('button', { class: 'btn primary', disabled: submitting.value, onClick: submit }, submitting.value ? 'Saving…' : 'Save')],
    );
  },
};

const ConfirmModal = {
  name: 'ConfirmModal',
  props: { title: { type: String, required: true }, message: { type: String, required: true }, confirmLabel: { type: String, default: 'Confirm' }, danger: { type: Boolean, default: false }, busy: { type: Boolean, default: false } },
  emits: ['close', 'confirm'],
  setup(props, { emit }) {
    return () => ModalShell(props.title, h('p', { style: 'color:var(--fg-mu);font-size:13px' }, props.message), [
      h('button', { class: 'btn ghost', onClick: () => emit('close'), disabled: props.busy }, 'Cancel'),
      h('button', { class: `btn ${props.danger ? 'danger' : 'primary'}`, disabled: props.busy, onClick: () => emit('confirm') }, props.busy ? 'Working…' : props.confirmLabel),
    ]);
  },
};

const PlaintextModal = {
  name: 'PlaintextModal',
  props: { title: { type: String, required: true }, plaintext: { type: String, required: true }, keyName: { type: String, default: '' } },
  emits: ['close'],
  setup(props, { emit }) {
    const copied = ref(false);
    async function copy() { try { await navigator.clipboard.writeText(props.plaintext); copied.value = true; setTimeout(() => (copied.value = false), 1500); } catch { /* */ } }
    return () => ModalShell(props.title,
      h('div', null, [h('p', { class: 'hint', style: 'margin-bottom:8px' }, `Copy this now — shown ONCE${props.keyName ? ` for "${props.keyName}"` : ''}.`), h('div', { class: 'plaintext-box' }, props.plaintext)]),
      [h('button', { class: 'btn', onClick: copy }, copied.value ? 'Copied' : 'Copy'), h('button', { class: 'btn primary', onClick: () => emit('close') }, 'Done')],
    );
  },
};



// ─────────────────────────────────────────────────────────────────────
// Keys table
// ─────────────────────────────────────────────────────────────────────
const KeysTable = {
  name: 'KeysTable',
  props: { api: { type: Object, required: true } },
  emits: ['toast', 'unauth'],
  setup(props, { emit }) {
    const keys = ref([]);
    const loading = ref(false);
    const search = ref('');
    const status = ref('all');
    const modal = reactive({ kind: null, payload: null, busy: false });

    async function refresh() {
      loading.value = true;
      try { const r = await props.api.listKeys({ includeRevoked: true }); keys.value = r.data.keys; }
      catch (err) { if (err.status === 401 || err.status === 403) { emit('unauth'); return; } emit('toast', { kind: 'err', text: `Load failed: ${err.message}` }); }
      finally { loading.value = false; }
    }
    onMounted(refresh);

    const filtered = computed(() => {
      const q = search.value.trim().toLowerCase();
      return keys.value.filter((k) => {
        if (status.value === 'active' && k.revoked) return false;
        if (status.value === 'revoked' && !k.revoked) return false;
        if (q && !k.name.toLowerCase().includes(q)) return false;
        return true;
      });
    });

    function fmtDate(s) { if (!s) return '—'; try { return new Date(s).toLocaleString(); } catch { return s; } }
    function openCreate() { modal.kind = 'create'; modal.payload = null; }
    function openEdit(k) { modal.kind = 'edit'; modal.payload = k; }
    function openRevoke(k) { modal.kind = 'revoke'; modal.payload = k; }
    function openRegen(k) { modal.kind = 'regen'; modal.payload = k; }
    function openActivate(k) { modal.kind = 'activate'; modal.payload = k; }
    function closeModal() { modal.kind = null; modal.payload = null; modal.busy = false; }

    async function doRevoke() { modal.busy = true; try { await props.api.revokeKey(modal.payload.id); emit('toast', { kind: 'ok', text: `Revoked "${modal.payload.name}"` }); closeModal(); refresh(); } catch (err) { emit('toast', { kind: 'err', text: `Revoke failed: ${err.message}` }); modal.busy = false; } }
    async function doRegen() { modal.busy = true; try { const r = await props.api.regenerateKey(modal.payload.id); const name = modal.payload.name; modal.kind = 'plaintext'; modal.payload = { plaintext: r.data.plaintext, name, title: 'Key rotated' }; modal.busy = false; refresh(); } catch (err) { emit('toast', { kind: 'err', text: `Regenerate failed: ${err.message}` }); modal.busy = false; } }
    async function doActivate() { modal.busy = true; try { await props.api.activateKey(modal.payload.id); emit('toast', { kind: 'ok', text: `Activated "${modal.payload.name}"` }); closeModal(); refresh(); } catch (err) { emit('toast', { kind: 'err', text: `Activate failed: ${err.message}` }); modal.busy = false; } }
    function onCreated(data) { const name = data.key.name; modal.kind = 'plaintext'; modal.payload = { plaintext: data.plaintext, name, title: 'Key created' }; refresh(); }
    function onUpdated(updatedKey) { const idx = keys.value.findIndex((k) => k.id === updatedKey.id); if (idx !== -1) keys.value[idx] = updatedKey; emit('toast', { kind: 'ok', text: `Updated "${updatedKey.name}"` }); closeModal(); }

    return () => h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, [
      h('div', { class: 'toolbar' }, [
        h('input', { class: 'input grow', placeholder: 'Search by name…', value: search.value, onInput: (e) => (search.value = e.target.value) }),
        h('select', { class: 'input', style: 'max-width:160px', value: status.value, onChange: (e) => (status.value = e.target.value) }, [h('option', { value: 'all' }, 'All'), h('option', { value: 'active' }, 'Active'), h('option', { value: 'revoked' }, 'Revoked')]),
        h('span', { class: 'count' }, `${filtered.value.length} / ${keys.value.length}${loading.value ? ' · loading…' : ''}`),
        h('button', { class: 'btn', onClick: refresh, disabled: loading.value }, 'Refresh'),
        h('button', { class: 'btn primary', onClick: openCreate }, '+ New key'),
      ]),
      h('div', { class: 'keys-table-wrap' }, h('table', { class: 'keys' }, [
        h('thead', null, h('tr', null, [h('th', 'Name'), h('th', 'Tier'), h('th', 'Status'), h('th', 'Daily limit'), h('th', 'Last used'), h('th', 'Created'), h('th', { style: 'text-align:right' }, 'Actions')])),
        h('tbody', null, [
          !loading.value && filtered.value.length === 0
            ? h('tr', { class: 'empty-row' }, h('td', { colspan: 7 }, keys.value.length === 0 ? 'No API keys yet.' : 'No keys match filter.'))
            : filtered.value.map((k) => h('tr', { key: k.id, class: k.revoked ? 'revoked' : '' }, [
                h('td', null, [h('div', { class: 'name' }, k.name), h('div', { class: 'id-mono' }, k.id)]),
                h('td', null, h('span', { class: `badge tier-${k.tier}` }, k.tier)),
                h('td', null, h('span', { class: `badge status-${k.revoked ? 'revoked' : 'active'}` }, k.revoked ? 'revoked' : 'active')),
                h('td', null, k.dailyLimit == null ? '\u221E unlimited' : k.dailyLimit.toLocaleString()),
                h('td', null, fmtDate(k.lastUsedAt)),
                h('td', null, fmtDate(k.createdAt)),
                h('td', { class: 'actions' }, k.revoked
                  ? [h('button', { class: 'btn sm primary', onClick: () => openActivate(k) }, 'Activate')]
                  : [
                      h('button', { class: 'btn sm', onClick: () => openEdit(k) }, 'Edit limit'),
                      h('button', { class: 'btn sm', onClick: () => openRegen(k) }, 'Regenerate'),
                      h('button', { class: 'btn sm danger', onClick: () => openRevoke(k) }, 'Revoke'),
                    ]),
              ])),
        ]),
      ])),
      // Modals
      modal.kind === 'create' ? h(CreateKeyModal, { api: props.api, onClose: closeModal, onCreated }) : null,
      modal.kind === 'edit' ? h(EditLimitModal, { api: props.api, keyRow: modal.payload, onClose: closeModal, onUpdated }) : null,
      modal.kind === 'revoke' ? h(ConfirmModal, { title: `Revoke "${modal.payload.name}"?`, message: 'The key will stop authenticating immediately.', confirmLabel: 'Revoke key', danger: true, busy: modal.busy, onClose: closeModal, onConfirm: doRevoke }) : null,
      modal.kind === 'regen' ? h(ConfirmModal, { title: `Regenerate "${modal.payload.name}"?`, message: 'A new plaintext will be generated and shown ONCE.', confirmLabel: 'Regenerate', danger: false, busy: modal.busy, onClose: closeModal, onConfirm: doRegen }) : null,
      modal.kind === 'activate' ? h(ConfirmModal, { title: `Activate "${modal.payload.name}"?`, message: 'This will un-revoke the key so it authenticates again.', confirmLabel: 'Activate', danger: false, busy: modal.busy, onClose: closeModal, onConfirm: doActivate }) : null,
      modal.kind === 'plaintext' ? h(PlaintextModal, { title: modal.payload.title, plaintext: modal.payload.plaintext, keyName: modal.payload.name, onClose: closeModal }) : null,
    ]);
  },
};



// ─────────────────────────────────────────────────────────────────────
// Audit Log tab
// ─────────────────────────────────────────────────────────────────────
const ACTION_LABELS = {
  'key.created': { label: 'Created', color: 'var(--ok)' },
  'key.revoked': { label: 'Revoked', color: 'var(--err)' },
  'key.activated': { label: 'Activated', color: 'var(--accent)' },
  'key.regenerated': { label: 'Regenerated', color: 'var(--warn)' },
  'key.updated': { label: 'Updated', color: 'var(--fg-mu)' },
};

const AuditLogTab = {
  name: 'AuditLogTab',
  props: { api: { type: Object, required: true } },
  emits: ['toast'],
  setup(props, { emit }) {
    const entries = ref([]);
    const total = ref(0);
    const loading = ref(false);
    const page = ref(0);
    const filterAction = ref('');
    const PAGE_SIZE = 30;

    async function load() {
      loading.value = true;
      try {
        const opts = { limit: PAGE_SIZE, offset: page.value * PAGE_SIZE };
        if (filterAction.value) opts.action = filterAction.value;
        const r = await props.api.listAuditLog(opts);
        entries.value = r.data.entries;
        total.value = r.data.total;
      } catch (err) {
        emit('toast', { kind: 'err', text: `Audit load failed: ${err.message}` });
      } finally { loading.value = false; }
    }

    onMounted(load);
    watch([page, filterAction], () => { if (filterAction.value !== undefined) { page.value = 0; } load(); });

    function fmtDate(s) { try { return new Date(s).toLocaleString(); } catch { return s; } }
    const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

    return () => h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, [
      // Toolbar
      h('div', { class: 'toolbar' }, [
        h('select', { class: 'input', style: 'max-width:200px', value: filterAction.value, onChange: (e) => { filterAction.value = e.target.value; page.value = 0; load(); } }, [
          h('option', { value: '' }, 'All actions'),
          h('option', { value: 'key.created' }, 'Created'),
          h('option', { value: 'key.revoked' }, 'Revoked'),
          h('option', { value: 'key.activated' }, 'Activated'),
          h('option', { value: 'key.regenerated' }, 'Regenerated'),
          h('option', { value: 'key.updated' }, 'Updated'),
        ]),
        h('span', { class: 'count' }, `${total.value} entries${loading.value ? ' · loading…' : ''}`),
        h('button', { class: 'btn', onClick: load, disabled: loading.value }, 'Refresh'),
      ]),

      // Table
      h('div', { class: 'keys-table-wrap' }, h('table', { class: 'keys' }, [
        h('thead', null, h('tr', null, [
          h('th', 'Time'),
          h('th', 'Action'),
          h('th', 'Target key'),
          h('th', 'Actor'),
          h('th', 'Details'),
        ])),
        h('tbody', null, [
          entries.value.length === 0
            ? h('tr', { class: 'empty-row' }, h('td', { colspan: 5 }, 'No audit entries yet.'))
            : entries.value.map((e) => {
                const act = ACTION_LABELS[e.action] ?? { label: e.action, color: 'var(--fg)' };
                return h('tr', { key: e.id }, [
                  h('td', null, fmtDate(e.createdAt)),
                  h('td', null, h('span', { style: `color:${act.color};font-weight:600;font-size:12px` }, act.label)),
                  h('td', null, [h('div', { class: 'name' }, e.targetKeyName), h('div', { class: 'id-mono' }, e.targetKeyId)]),
                  h('td', null, h('div', { class: 'id-mono' }, e.actorKeyId.slice(0, 8) + '…')),
                  h('td', null, e.metadata ? h('code', { style: 'font-size:11px;color:var(--fg-mu)' }, JSON.stringify(e.metadata)) : '—'),
                ]);
              }),
        ]),
      ])),

      // Pagination
      totalPages.value > 1
        ? h('div', { style: 'display:flex;align-items:center;gap:8px;justify-content:center' }, [
            h('button', { class: 'btn sm', disabled: page.value === 0, onClick: () => { page.value--; load(); } }, '← Prev'),
            h('span', { style: 'font-size:12px;color:var(--fg-mu)' }, `Page ${page.value + 1} / ${totalPages.value}`),
            h('button', { class: 'btn sm', disabled: page.value >= totalPages.value - 1, onClick: () => { page.value++; load(); } }, 'Next →'),
          ])
        : null,
    ]);
  },
};



// ─────────────────────────────────────────────────────────────────────
// Users tab
// ─────────────────────────────────────────────────────────────────────
const UsersTab = {
  name: 'UsersTab',
  props: { api: { type: Object, required: true } },
  emits: ['toast'],
  setup(props, { emit }) {
    const users = ref([]);
    const total = ref(0);
    const loading = ref(false);
    const page = ref(0);
    const search = ref('');
    const PAGE_SIZE = 30;

    async function load() {
      loading.value = true;
      try {
        const opts = { limit: PAGE_SIZE, offset: page.value * PAGE_SIZE };
        if (search.value.trim()) opts.search = search.value.trim();
        const r = await props.api.listUsers(opts);
        users.value = r.data.users;
        total.value = r.data.total;
      } catch (err) {
        emit('toast', { kind: 'err', text: `Users load failed: ${err.message}` });
      } finally { loading.value = false; }
    }

    onMounted(load);

    let searchTimer = null;
    function onSearch(e) {
      search.value = e.target.value;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { page.value = 0; load(); }, 300);
    }

    function fmtDate(s) { if (!s) return '—'; try { return new Date(s).toLocaleString(); } catch { return s; } }
    const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

    return () => h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, [
      // Toolbar
      h('div', { class: 'toolbar' }, [
        h('input', { class: 'input grow', placeholder: 'Search by username or email…', value: search.value, onInput: onSearch }),
        h('span', { class: 'count' }, `${total.value} users${loading.value ? ' · loading…' : ''}`),
        h('button', { class: 'btn', onClick: load, disabled: loading.value }, 'Refresh'),
      ]),

      // Table
      h('div', { class: 'keys-table-wrap' }, h('table', { class: 'keys' }, [
        h('thead', null, h('tr', null, [
          h('th', 'Username'),
          h('th', 'Email'),
          h('th', 'Linked Key'),
          h('th', 'Last login'),
          h('th', 'Registered'),
        ])),
        h('tbody', null, [
          users.value.length === 0
            ? h('tr', { class: 'empty-row' }, h('td', { colspan: 5 }, loading.value ? 'Loading…' : 'No users found.'))
            : users.value.map((u) => h('tr', { key: u.id }, [
                h('td', null, [h('div', { class: 'name' }, u.username), h('div', { class: 'id-mono' }, u.id)]),
                h('td', null, u.email),
                h('td', null, u.apiKeyId
                  ? h('div', { class: 'id-mono' }, u.apiKeyId.slice(0, 8) + '…')
                  : h('span', { style: 'color:var(--fg-dim)' }, 'none')),
                h('td', null, fmtDate(u.lastLoginAt)),
                h('td', null, fmtDate(u.createdAt)),
              ])),
        ]),
      ])),

      // Pagination
      totalPages.value > 1
        ? h('div', { style: 'display:flex;align-items:center;gap:8px;justify-content:center' }, [
            h('button', { class: 'btn sm', disabled: page.value === 0, onClick: () => { page.value--; load(); } }, '\u2190 Prev'),
            h('span', { style: 'font-size:12px;color:var(--fg-mu)' }, `Page ${page.value + 1} / ${totalPages.value}`),
            h('button', { class: 'btn sm', disabled: page.value >= totalPages.value - 1, onClick: () => { page.value++; load(); } }, 'Next \u2192'),
          ])
        : null,
    ]);
  },
};


// ─────────────────────────────────────────────────────────────────────
<<<<<<< HEAD
=======
// Sticker Packs tab (meme sticker packs for /api/tools/random-sticker)
// ─────────────────────────────────────────────────────────────────────
const StickerPacksTab = {
  name: 'StickerPacksTab',
  props: { api: { type: Object, required: true } },
  emits: ['toast'],
  setup(props, { emit }) {
    const packs = ref([]);
    const loading = ref(false);
    const busyId = ref(null);
    const form = reactive({ name: '', label: '' });
    const adding = ref(false);

    async function load() {
      loading.value = true;
      try {
        const r = await props.api.listStickerPacks();
        packs.value = r.data.packs;
      } catch (err) {
        emit('toast', { kind: 'err', text: `Load failed: ${err.message}` });
      } finally { loading.value = false; }
    }
    onMounted(load);

    async function submitAdd() {
      const name = form.name.trim();
      if (!name) { emit('toast', { kind: 'err', text: 'Pack name required' }); return; }
      adding.value = true;
      try {
        await props.api.addStickerPack({ name, label: form.label.trim() || undefined });
        form.name = ''; form.label = '';
        emit('toast', { kind: 'ok', text: `Added pack "${name}"` });
        load();
      } catch (err) {
        emit('toast', { kind: 'err', text: `Add failed: ${err.message}` });
      } finally { adding.value = false; }
    }

    async function toggleActive(pack) {
      busyId.value = pack.id;
      try {
        await props.api.setStickerPackActive(pack.id, !pack.active);
        emit('toast', { kind: 'ok', text: `${!pack.active ? 'Activated' : 'Deactivated'} "${pack.name}"` });
        load();
      } catch (err) {
        emit('toast', { kind: 'err', text: `Update failed: ${err.message}` });
      } finally { busyId.value = null; }
    }

    async function removePack(pack) {
      if (!confirm(`Remove pack "${pack.name}"? This cannot be undone.`)) return;
      busyId.value = pack.id;
      try {
        await props.api.deleteStickerPack(pack.id);
        emit('toast', { kind: 'ok', text: `Removed "${pack.name}"` });
        load();
      } catch (err) {
        emit('toast', { kind: 'err', text: `Delete failed: ${err.message}` });
      } finally { busyId.value = null; }
    }

    function fmtDate(s) { if (!s) return '—'; try { return new Date(s).toLocaleString(); } catch { return s; } }

    return () => h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, [
      h('div', { class: 'card' }, [
        h('h3', 'Add Telegram sticker pack'),
        h('p', { class: 'hint', style: 'margin:4px 0 12px' },
          'Paste the short-name from t.me/addstickers/<name> — e.g. "MemesIndonesia". Powers /api/tools/random-sticker.'),
        h('div', { class: 'toolbar' }, [
          h('input', {
            class: 'input grow', placeholder: 'Pack short-name (required)',
            value: form.name, onInput: (e) => (form.name = e.target.value),
            onKeydown: (e) => { if (e.key === 'Enter') submitAdd(); },
          }),
          h('input', {
            class: 'input grow', placeholder: 'Label (optional)',
            value: form.label, onInput: (e) => (form.label = e.target.value),
            onKeydown: (e) => { if (e.key === 'Enter') submitAdd(); },
          }),
          h('button', { class: 'btn primary', disabled: adding.value, onClick: submitAdd },
            adding.value ? 'Adding…' : '+ Add pack'),
        ]),
      ]),

      h('div', { class: 'toolbar' }, [
        h('span', { class: 'count' }, `${packs.value.length} packs${loading.value ? ' · loading…' : ''}`),
        h('button', { class: 'btn', onClick: load, disabled: loading.value }, 'Refresh'),
      ]),

      h('div', { class: 'keys-table-wrap' }, h('table', { class: 'keys' }, [
        h('thead', null, h('tr', null, [
          h('th', 'Name'), h('th', 'Label'), h('th', 'Status'), h('th', 'Added'),
          h('th', { style: 'text-align:right' }, 'Actions'),
        ])),
        h('tbody', null, [
          packs.value.length === 0
            ? h('tr', { class: 'empty-row' }, h('td', { colspan: 5 },
                loading.value ? 'Loading…' : 'No sticker packs yet. Add one above.'))
            : packs.value.map((p) => h('tr', { key: p.id, class: p.active ? '' : 'revoked' }, [
                h('td', null, [
                  h('div', { class: 'name' }, p.name),
                  h('a', { class: 'id-mono', href: `https://t.me/addstickers/${p.name}`, target: '_blank', rel: 'noopener' },
                    `t.me/addstickers/${p.name}`),
                ]),
                h('td', null, p.label || h('span', { style: 'color:var(--fg-dim)' }, '—')),
                h('td', null, h('span', { class: `badge status-${p.active ? 'active' : 'revoked'}` },
                  p.active ? 'active' : 'inactive')),
                h('td', null, fmtDate(p.created_at)),
                h('td', { class: 'actions' }, [
                  h('button', {
                    class: 'btn sm', disabled: busyId.value === p.id,
                    onClick: () => toggleActive(p),
                  }, p.active ? 'Deactivate' : 'Activate'),
                  h('button', {
                    class: 'btn sm danger', disabled: busyId.value === p.id,
                    onClick: () => removePack(p),
                  }, 'Remove'),
                ]),
              ])),
        ]),
      ])),
    ]);
  },
};


// ─────────────────────────────────────────────────────────────────────
>>>>>>> ef8e6ddfefb5b202852d51112a951f2d2b1659af
// Root app — tabs: Keys | Users | Audit Log
// ─────────────────────────────────────────────────────────────────────
const App = {
  name: 'AdminApp',
  setup() {
    const masterKey = ref(localStorage.getItem(LS_MASTER));
    const api = makeApi(() => masterKey.value);
    const activeTab = ref('keys'); // 'keys' | 'users' | 'audit'

    const toasts = ref([]);
    let toastSeq = 0;
    function pushToast({ kind, text }, ttl = 3500) {
      const id = ++toastSeq;
      toasts.value.push({ id, kind, text });
      setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, ttl);
    }

    function onAuthed(key) { masterKey.value = key; }
    function onUnauth() { localStorage.removeItem(LS_MASTER); masterKey.value = null; pushToast({ kind: 'err', text: 'Master key rejected — re-authenticate' }); }
    function logout() { localStorage.removeItem(LS_MASTER); masterKey.value = null; }

    return () => {
      if (!masterKey.value) {
        return h('div', { class: 'admin' }, [renderHeader(false), h(AuthGate, { onAuthed }), renderToasts(toasts.value)]);
      }

      return h('div', { class: 'admin' }, [
        renderHeader(true, logout),
        h('div', { class: 'observability' }, [h(HealthPill), h(PoolStatsWidget, { api, key: masterKey.value })]),

        // Tab bar
        h('div', { class: 'toolbar', style: 'border-bottom:1px solid var(--b-1);padding-bottom:8px' }, [
          h('button', { class: `btn ${activeTab.value === 'keys' ? 'primary' : 'ghost'}`, onClick: () => (activeTab.value = 'keys') }, 'API Keys'),
          h('button', { class: `btn ${activeTab.value === 'users' ? 'primary' : 'ghost'}`, onClick: () => (activeTab.value = 'users') }, 'Users'),
<<<<<<< HEAD
=======
          h('button', { class: `btn ${activeTab.value === 'stickers' ? 'primary' : 'ghost'}`, onClick: () => (activeTab.value = 'stickers') }, 'Sticker Packs'),
>>>>>>> ef8e6ddfefb5b202852d51112a951f2d2b1659af
          h('button', { class: `btn ${activeTab.value === 'audit' ? 'primary' : 'ghost'}`, onClick: () => (activeTab.value = 'audit') }, 'Audit Log'),
        ]),

        // Tab content
        activeTab.value === 'keys'
          ? h(KeysTable, { api, key: masterKey.value, onToast: pushToast, onUnauth })
          : activeTab.value === 'users'
            ? h(UsersTab, { api, key: masterKey.value, onToast: pushToast })
<<<<<<< HEAD
            : h(AuditLogTab, { api, key: masterKey.value, onToast: pushToast }),
=======
            : activeTab.value === 'stickers'
              ? h(StickerPacksTab, { api, key: masterKey.value, onToast: pushToast })
              : h(AuditLogTab, { api, key: masterKey.value, onToast: pushToast }),
>>>>>>> ef8e6ddfefb5b202852d51112a951f2d2b1659af

        renderToasts(toasts.value),
      ]);
    };
  },
};

function renderHeader(authed, logout) {
  return h('header', { class: 'admin-header' }, [
    h('div', { class: 'brand' }, [h('span', { class: 'brand-mark' }, '//'), h('span', null, 'Rex API')]),
    h('div', { class: 'crumbs' }, [h('a', { href: '/' }, 'Home'), ' / ', h('span', null, 'admin')]),
    h('div', { class: 'spacer' }),
    h('div', { class: 'links' }, [
      h('a', { href: '/dashboard' }, 'Dashboard'),
      h('a', { href: '/docs' }, 'API docs'),
      authed ? h('button', { class: 'btn sm ghost', onClick: logout }, 'Lock') : null,
    ]),
  ]);
}

function renderToasts(list) {
  return h('div', { class: 'toasts' }, list.map((t) => h('div', { class: `toast ${t.kind}`, key: t.id }, t.text)));
}

<<<<<<< HEAD
createApp(App).mount('#admin-app');
=======
createApp(App).mount('#admin-app');
>>>>>>> ef8e6ddfefb5b202852d51112a951f2d2b1659af
