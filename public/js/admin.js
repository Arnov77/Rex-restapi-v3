/**
 * Rex API — admin console (master-only).
 *
 * Single-page Vue app, mounted at /admin. Mirrors the dashboard's
 * importmap-only / no-build setup so we don't introduce a toolchain just
 * for an operator surface.
 *
 * Auth model: master API key (X-API-Key header) cached in localStorage
 * under 'rex.masterApiKey'. We deliberately keep this distinct from
 * 'rex.apiKey' (the user-tier key the dashboard caches for /api/me/*) —
 * mixing them would leak admin power into the user-tier playground, and
 * a logout from the dashboard shouldn't blow away an operator's master
 * credential.
 *
 * Surfaces:
 *   1. Health pill         → polls /api/ready
 *   2. Pool stats widget   → polls /api/keys/pool-stats (master)
 *   3. API keys table      → /api/keys/* CRUD with search + status filter
 *
 * Polling cadence is conservative (5s) — these widgets exist for at-a-
 * glance situational awareness, not real-time monitoring. Anything that
 * needs sub-second resolution belongs in a proper metrics pipeline.
 */

import { createApp, h, reactive, ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';

const LS_MASTER = 'rex.masterApiKey';
const POLL_HEALTH_MS = 5000;
const POLL_POOL_MS = 5000;

// ─────────────────────────────────────────────────────────────────────
// API client — minimal master-key flavored fetcher.
// ─────────────────────────────────────────────────────────────────────
function makeApi(getKey) {
  async function call(method, path, { body, headers = {}, signal } = {}) {
    const key = getKey();
    if (!key) throw new Error('Master API key not set');
    const res = await fetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': key,
        Accept: 'application/json',
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    let payload = null;
    try { payload = await res.json(); } catch { /* empty body / non-JSON */ }
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
    poolStats: ({ signal } = {}) => call('GET', '/api/keys/pool-stats', { signal }),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Health pill — ping /api/ready (no auth required).
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
        if (res.ok && body?.ok) {
          state.status = 'ok';
        } else {
          // 503 still returns a structured body with db/browser fields.
          state.status = 'err';
        }
        state.db = body?.db ?? '?';
        state.browser = body?.browser ?? '?';
        state.error = null;
      } catch (err) {
        state.status = 'err';
        state.db = '?';
        state.browser = '?';
        state.error = err.message;
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
        h('span', { class: 'health-meta' },
          state.status === 'idle'
            ? '—'
            : `db: ${state.db} · browser: ${state.browser}`),
      ]),
      state.error
        ? h('div', { class: 'health-meta', style: 'margin-top:8px;color:var(--err)' }, state.error)
        : null,
      state.updatedAt
        ? h('div', { class: 'health-meta', style: 'margin-top:6px' },
            `Last checked ${state.updatedAt.toLocaleTimeString()}`)
        : null,
    ]);
  },
};

// ─────────────────────────────────────────────────────────────────────
// Pool stats widget — hits the new master-only /api/keys/pool-stats.
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
        stats.value = r.data;
        error.value = null;
      } catch (err) {
        if (err.name === 'AbortError') return;
        error.value = err.message;
      }
    }

    onMounted(() => { tick(); timer = setInterval(tick, POLL_POOL_MS); });
    onBeforeUnmount(() => { if (timer) clearInterval(timer); if (aborter) aborter.abort(); });

    return () => {
      const s = stats.value;
      const fields = [
        { l: 'Size',     v: s?.size ?? '—' },
        { l: 'Created',  v: s?.created ?? '—' },
        { l: 'Busy',     v: s?.busy ?? '—', warn: s && s.size > 0 && s.busy === s.size },
        { l: 'Idle',     v: s?.idle ?? '—' },
        { l: 'Queued',   v: s?.queued ?? '—', err: s?.queued > 0 },
        { l: 'Acquired', v: s?.acquireCount ?? '—' },
        { l: 'Released', v: s?.releaseCount ?? '—' },
        { l: 'Timeouts', v: s?.timeoutCount ?? '—', err: s?.timeoutCount > 0 },
      ];
      return h('div', { class: 'card' }, [
        h('h3', 'Page Pool'),
        error.value
          ? h('div', { style: 'color:var(--err);font-size:12px;margin-bottom:8px' }, error.value)
          : null,
        h('div', { class: 'pool-grid' },
          fields.map(({ l, v, warn, err }) =>
            h('div', { class: 'metric' }, [
              h('div', { class: ['v', warn ? 'warn' : '', err ? 'err' : ''].filter(Boolean).join(' ') },
                String(v)),
              h('div', { class: 'l' }, l),
            ]),
          ),
        ),
      ]);
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// Auth gate — collects + validates the master key on first visit.
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
      loading.value = true;
      error.value = null;
      try {
        // Round-trip through /api/keys/ as the cheapest auth check —
        // master-only, returns small payload, gives us a real 401/403
        // if the key is bad or non-master.
        const res = await fetch('/api/keys/?includeRevoked=false', {
          headers: { 'X-API-Key': key, Accept: 'application/json' },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        }
        localStorage.setItem(LS_MASTER, key);
        emit('authed', key);
      } catch (err) {
        error.value = err.message;
      } finally {
        loading.value = false;
      }
    }

    return () => h('div', { class: 'auth-gate' }, [
      h('h2', 'Admin access'),
      h('p', 'Paste a master API key to unlock the console. Stored locally in your browser only.'),
      h('label', { for: 'master-key' }, 'Master API key'),
      h('input', {
        id: 'master-key',
        class: 'input mono',
        type: 'password',
        autocomplete: 'off',
        placeholder: 'rex_…',
        value: candidate.value,
        onInput: (e) => (candidate.value = e.target.value),
        onKeydown: (e) => { if (e.key === 'Enter') submit(); },
      }),
      error.value ? h('div', { class: 'err' }, error.value) : null,
      h('div', { style: 'margin-top:16px;display:flex;justify-content:flex-end;gap:8px' }, [
        h('a', { href: '/', class: 'btn ghost' }, 'Cancel'),
        h('button', { class: 'btn primary', disabled: loading.value, onClick: submit },
          loading.value ? 'Verifying…' : 'Unlock'),
      ]),
    ]);
  },
};

// ─────────────────────────────────────────────────────────────────────
// Modals — Create / Edit / Confirm / RevealPlaintext.
// Tiny dialogs colocated here; not worth extracting into separate files.
// ─────────────────────────────────────────────────────────────────────
function ModalShell(title, body, footer) {
  return h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
      h('h3', title),
      body,
      footer ? h('div', { class: 'actions' }, footer) : null,
    ]),
  ]);
}

const CreateKeyModal = {
  name: 'CreateKeyModal',
  props: { api: { type: Object, required: true } },
  emits: ['close', 'created'],
  setup(props, { emit }) {
    const form = reactive({
      name: '',
      tier: 'user',
      dailyLimit: '',
      storeEncrypted: false,
    });
    const error = ref(null);
    const submitting = ref(false);

    async function submit() {
      if (!form.name.trim()) { error.value = 'Name is required'; return; }
      submitting.value = true;
      error.value = null;
      try {
        const body = {
          name: form.name.trim(),
          tier: form.tier,
          // empty string = unlimited (null); otherwise a non-negative int
          dailyLimit: form.dailyLimit === '' ? null : Number(form.dailyLimit),
          storeEncrypted: form.storeEncrypted,
        };
        if (body.dailyLimit !== null && (!Number.isInteger(body.dailyLimit) || body.dailyLimit < 0)) {
          throw new Error('Daily limit must be a non-negative integer or empty for unlimited');
        }
        const r = await props.api.createKey(body);
        emit('created', r.data); // { plaintext, key }
      } catch (err) {
        error.value = err.message;
      } finally {
        submitting.value = false;
      }
    }

    return () => ModalShell('Create new API key',
      h('div', null, [
        h('div', { class: 'field' }, [
          h('label', 'Name'),
          h('input', {
            class: 'input',
            placeholder: 'e.g. whatsapp-bot-prod',
            value: form.name,
            onInput: (e) => (form.name = e.target.value),
          }),
        ]),
        h('div', { class: 'field' }, [
          h('label', 'Tier'),
          h('select', {
            class: 'input',
            value: form.tier,
            onChange: (e) => (form.tier = e.target.value),
          }, [
            h('option', { value: 'user' }, 'user'),
            h('option', { value: 'master' }, 'master'),
          ]),
        ]),
        h('div', { class: 'field' }, [
          h('label', 'Daily limit (empty = unlimited)'),
          h('input', {
            class: 'input',
            type: 'number',
            min: '0',
            step: '1',
            placeholder: 'e.g. 1000',
            value: form.dailyLimit,
            onInput: (e) => (form.dailyLimit = e.target.value),
          }),
        ]),
        h('div', { class: 'field' }, [
          h('label', { class: 'checkbox' }, [
            h('input', {
              type: 'checkbox',
              checked: form.storeEncrypted,
              onChange: (e) => (form.storeEncrypted = e.target.checked),
            }),
            h('span', 'Store encrypted (allow Reveal later)'),
          ]),
          h('div', { class: 'hint' },
            'Master keys are always stored encrypted. User keys default to off (plaintext shown once).'),
        ]),
        error.value ? h('div', { style: 'color:var(--err);font-size:12px;margin-top:8px' }, error.value) : null,
      ]),
      [
        h('button', { class: 'btn ghost', onClick: () => emit('close') }, 'Cancel'),
        h('button', { class: 'btn primary', disabled: submitting.value, onClick: submit },
          submitting.value ? 'Creating…' : 'Create'),
      ],
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
      submitting.value = true;
      error.value = null;
      try {
        const v = value.value === '' ? null : Number(value.value);
        if (v !== null && (!Number.isInteger(v) || v < 0)) {
          throw new Error('Daily limit must be a non-negative integer or empty for unlimited');
        }
        const r = await props.api.updateKey(props.keyRow.id, { dailyLimit: v });
        emit('updated', r.data.key);
      } catch (err) {
        error.value = err.message;
      } finally {
        submitting.value = false;
      }
    }

    return () => ModalShell(`Edit daily limit — ${props.keyRow.name}`,
      h('div', null, [
        h('div', { class: 'field' }, [
          h('label', 'Daily limit (empty = unlimited)'),
          h('input', {
            class: 'input',
            type: 'number',
            min: '0',
            step: '1',
            value: value.value,
            onInput: (e) => (value.value = e.target.value),
            onKeydown: (e) => { if (e.key === 'Enter') submit(); },
          }),
          h('div', { class: 'hint' },
            `Current: ${props.keyRow.dailyLimit == null ? 'unlimited' : props.keyRow.dailyLimit}`),
        ]),
        error.value ? h('div', { style: 'color:var(--err);font-size:12px;margin-top:8px' }, error.value) : null,
      ]),
      [
        h('button', { class: 'btn ghost', onClick: () => emit('close') }, 'Cancel'),
        h('button', { class: 'btn primary', disabled: submitting.value, onClick: submit },
          submitting.value ? 'Saving…' : 'Save'),
      ],
    );
  },
};

const ConfirmModal = {
  name: 'ConfirmModal',
  props: {
    title: { type: String, required: true },
    message: { type: String, required: true },
    confirmLabel: { type: String, default: 'Confirm' },
    danger: { type: Boolean, default: false },
    busy: { type: Boolean, default: false },
  },
  emits: ['close', 'confirm'],
  setup(props, { emit }) {
    return () => ModalShell(props.title,
      h('p', { style: 'color:var(--fg-mu);font-size:13px' }, props.message),
      [
        h('button', { class: 'btn ghost', onClick: () => emit('close'), disabled: props.busy }, 'Cancel'),
        h('button', {
          class: `btn ${props.danger ? 'danger' : 'primary'}`,
          disabled: props.busy,
          onClick: () => emit('confirm'),
        }, props.busy ? 'Working…' : props.confirmLabel),
      ],
    );
  },
};

const PlaintextModal = {
  name: 'PlaintextModal',
  props: {
    title: { type: String, required: true },
    plaintext: { type: String, required: true },
    keyName: { type: String, default: '' },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const copied = ref(false);
    async function copy() {
      try {
        await navigator.clipboard.writeText(props.plaintext);
        copied.value = true;
        setTimeout(() => (copied.value = false), 1500);
      } catch { /* ignore */ }
    }
    return () => ModalShell(props.title,
      h('div', null, [
        h('p', { class: 'hint', style: 'margin-bottom:8px' },
          `Copy this now — it will not be shown again${props.keyName ? ` for "${props.keyName}"` : ''}.`),
        h('div', { class: 'plaintext-box' }, props.plaintext),
      ]),
      [
        h('button', { class: 'btn', onClick: copy }, copied.value ? 'Copied' : 'Copy'),
        h('button', { class: 'btn primary', onClick: () => emit('close') }, 'Done'),
      ],
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// Keys table — list, search, filter, action wiring.
// ─────────────────────────────────────────────────────────────────────
const KeysTable = {
  name: 'KeysTable',
  props: { api: { type: Object, required: true } },
  emits: ['toast', 'unauth'],
  setup(props, { emit }) {
    const keys = ref([]);
    const loading = ref(false);
    const search = ref('');
    const status = ref('all'); // 'all' | 'active' | 'revoked'

    const modal = reactive({ kind: null, payload: null, busy: false });

    async function refresh() {
      loading.value = true;
      try {
        const r = await props.api.listKeys({ includeRevoked: true });
        keys.value = r.data.keys;
      } catch (err) {
        if (err.status === 401 || err.status === 403) { emit('unauth'); return; }
        emit('toast', { kind: 'err', text: `Load failed: ${err.message}` });
      } finally {
        loading.value = false;
      }
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

    function fmtDate(s) {
      if (!s) return '—';
      try { return new Date(s).toLocaleString(); } catch { return s; }
    }

    function openCreate() { modal.kind = 'create'; modal.payload = null; }
    function openEdit(k)  { modal.kind = 'edit';   modal.payload = k; }
    function openRevoke(k){ modal.kind = 'revoke'; modal.payload = k; }
    function openRegen(k) { modal.kind = 'regen';  modal.payload = k; }
    function closeModal() { modal.kind = null; modal.payload = null; modal.busy = false; }

    async function doRevoke() {
      modal.busy = true;
      try {
        await props.api.revokeKey(modal.payload.id);
        emit('toast', { kind: 'ok', text: `Revoked "${modal.payload.name}"` });
        closeModal();
        refresh();
      } catch (err) {
        emit('toast', { kind: 'err', text: `Revoke failed: ${err.message}` });
        modal.busy = false;
      }
    }

    async function doRegen() {
      modal.busy = true;
      try {
        const r = await props.api.regenerateKey(modal.payload.id);
        // Stash the rotated key, swap the modal to show plaintext, refresh
        // the table so the updatedAt column reflects the rotation.
        const name = modal.payload.name;
        modal.kind = 'plaintext';
        modal.payload = { plaintext: r.data.plaintext, name, title: 'Key rotated' };
        modal.busy = false;
        refresh();
      } catch (err) {
        emit('toast', { kind: 'err', text: `Regenerate failed: ${err.message}` });
        modal.busy = false;
      }
    }

    function onCreated(data) {
      // data: { plaintext, key }
      const name = data.key.name;
      modal.kind = 'plaintext';
      modal.payload = { plaintext: data.plaintext, name, title: 'Key created' };
      refresh();
    }

    function onUpdated(updatedKey) {
      const idx = keys.value.findIndex((k) => k.id === updatedKey.id);
      if (idx !== -1) keys.value[idx] = updatedKey;
      emit('toast', { kind: 'ok', text: `Updated "${updatedKey.name}"` });
      closeModal();
    }

    return () => h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, [
      // Toolbar
      h('div', { class: 'toolbar' }, [
        h('input', {
          class: 'input grow',
          placeholder: 'Search by name…',
          value: search.value,
          onInput: (e) => (search.value = e.target.value),
        }),
        h('select', {
          class: 'input',
          style: 'max-width:160px',
          value: status.value,
          onChange: (e) => (status.value = e.target.value),
        }, [
          h('option', { value: 'all' }, 'All'),
          h('option', { value: 'active' }, 'Active'),
          h('option', { value: 'revoked' }, 'Revoked'),
        ]),
        h('span', { class: 'count' },
          `${filtered.value.length} / ${keys.value.length}${loading.value ? ' · loading…' : ''}`),
        h('button', { class: 'btn', onClick: refresh, disabled: loading.value }, 'Refresh'),
        h('button', { class: 'btn primary', onClick: openCreate }, '+ New key'),
      ]),

      // Table
      h('div', { class: 'keys-table-wrap' },
        h('table', { class: 'keys' }, [
          h('thead', null, h('tr', null, [
            h('th', 'Name'),
            h('th', 'Tier'),
            h('th', 'Status'),
            h('th', 'Daily limit'),
            h('th', 'Last used'),
            h('th', 'Created'),
            h('th', { style: 'text-align:right' }, 'Actions'),
          ])),
          h('tbody', null, [
            !loading.value && filtered.value.length === 0
              ? h('tr', { class: 'empty-row' }, h('td', { colspan: 7 },
                  keys.value.length === 0 ? 'No API keys yet.' : 'No keys match the current filter.'))
              : filtered.value.map((k) =>
                  h('tr', { key: k.id, class: k.revoked ? 'revoked' : '' }, [
                    h('td', null, [
                      h('div', { class: 'name' }, k.name),
                      h('div', { class: 'id-mono' }, k.id),
                    ]),
                    h('td', null, h('span', { class: `badge tier-${k.tier}` }, k.tier)),
                    h('td', null, h('span', { class: `badge status-${k.revoked ? 'revoked' : 'active'}` },
                      k.revoked ? 'revoked' : 'active')),
                    h('td', null, k.dailyLimit == null ? 'unlimited' : k.dailyLimit),
                    h('td', null, fmtDate(k.lastUsedAt)),
                    h('td', null, fmtDate(k.createdAt)),
                    h('td', { class: 'actions' }, [
                      h('button', {
                        class: 'btn sm',
                        disabled: k.revoked,
                        onClick: () => openEdit(k),
                      }, 'Edit limit'),
                      h('button', {
                        class: 'btn sm',
                        disabled: k.revoked,
                        onClick: () => openRegen(k),
                      }, 'Regenerate'),
                      h('button', {
                        class: 'btn sm danger',
                        disabled: k.revoked,
                        onClick: () => openRevoke(k),
                      }, 'Revoke'),
                    ]),
                  ]),
                ),
          ]),
        ]),
      ),

      // Modals
      modal.kind === 'create'
        ? h(CreateKeyModal, {
            api: props.api,
            onClose: closeModal,
            onCreated: onCreated,
          })
        : null,
      modal.kind === 'edit'
        ? h(EditLimitModal, {
            api: props.api,
            keyRow: modal.payload,
            onClose: closeModal,
            onUpdated: onUpdated,
          })
        : null,
      modal.kind === 'revoke'
        ? h(ConfirmModal, {
            title: `Revoke "${modal.payload.name}"?`,
            message: 'This is permanent. The key will stop authenticating immediately. Today\'s usage counter is preserved.',
            confirmLabel: 'Revoke key',
            danger: true,
            busy: modal.busy,
            onClose: closeModal,
            onConfirm: doRevoke,
          })
        : null,
      modal.kind === 'regen'
        ? h(ConfirmModal, {
            title: `Regenerate "${modal.payload.name}"?`,
            message: 'A new plaintext will be generated and shown ONCE. Existing clients using the old secret will start failing immediately.',
            confirmLabel: 'Regenerate',
            danger: false,
            busy: modal.busy,
            onClose: closeModal,
            onConfirm: doRegen,
          })
        : null,
      modal.kind === 'plaintext'
        ? h(PlaintextModal, {
            title: modal.payload.title,
            plaintext: modal.payload.plaintext,
            keyName: modal.payload.name,
            onClose: closeModal,
          })
        : null,
    ]);
  },
};

// ─────────────────────────────────────────────────────────────────────
// Root app — wires auth gate + main surface together.
// ─────────────────────────────────────────────────────────────────────
const App = {
  name: 'AdminApp',
  setup() {
    const masterKey = ref(localStorage.getItem(LS_MASTER));
    const api = makeApi(() => masterKey.value);

    const toasts = ref([]);
    let toastSeq = 0;
    function pushToast({ kind, text }, ttl = 3500) {
      const id = ++toastSeq;
      toasts.value.push({ id, kind, text });
      setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, ttl);
    }

    function onAuthed(key) { masterKey.value = key; }
    function onUnauth() {
      // Server rejected our cached key (revoked, demoted, or regenerated
      // out from under us). Wipe + bounce back to the gate.
      localStorage.removeItem(LS_MASTER);
      masterKey.value = null;
      pushToast({ kind: 'err', text: 'Master key rejected — re-authenticate' });
    }
    function logout() {
      localStorage.removeItem(LS_MASTER);
      masterKey.value = null;
    }

    // Re-key Vue subtrees when the credential changes so any stale fetch
    // state inside child components is dropped wholesale (cheaper than
    // threading a "reset" prop everywhere).
    watch(masterKey, () => { /* trigger reactivity for v-if */ });

    return () => {
      if (!masterKey.value) {
        return h('div', { class: 'admin' }, [
          renderHeader(false),
          h(AuthGate, { onAuthed }),
          renderToasts(toasts.value),
        ]);
      }

      return h('div', { class: 'admin' }, [
        renderHeader(true, logout),
        h('div', { class: 'observability' }, [
          h(HealthPill),
          h(PoolStatsWidget, { api, key: masterKey.value }),
        ]),
        h(KeysTable, {
          api,
          key: masterKey.value,
          onToast: pushToast,
          onUnauth,
        }),
        renderToasts(toasts.value),
      ]);
    };
  },
};

function renderHeader(authed, logout) {
  return h('header', { class: 'admin-header' }, [
    h('div', { class: 'brand' }, [
      h('span', { class: 'brand-mark' }, '//'),
      h('span', null, 'Rex API'),
    ]),
    h('div', { class: 'crumbs' }, [
      h('a', { href: '/' }, 'Home'),
      ' / ',
      h('span', null, 'admin'),
    ]),
    h('div', { class: 'spacer' }),
    h('div', { class: 'links' }, [
      h('a', { href: '/dashboard' }, 'Dashboard'),
      h('a', { href: '/docs' }, 'API docs'),
      authed
        ? h('button', { class: 'btn sm ghost', onClick: logout }, 'Lock')
        : null,
    ]),
  ]);
}

function renderToasts(list) {
  return h('div', { class: 'toasts' },
    list.map((t) => h('div', { class: `toast ${t.kind}`, key: t.id }, t.text)),
  );
}

createApp(App).mount('#admin-app');
