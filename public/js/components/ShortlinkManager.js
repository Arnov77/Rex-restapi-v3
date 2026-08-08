/**
 * ShortlinkManager — tab for managing shortlinks.
 *
 * Features:
 *   - List all shortlinks owned by the user
 *   - Create a new shortlink (URL, custom slug, expiry)
 *   - Copy short URL to clipboard
 *   - Delete a shortlink
 *   - Click count per link
 */

import { ref, computed, h, onMounted } from 'vue';
import { useAuth } from '../auth.js';

export default {
  name: 'ShortlinkManager',
  emits: ['toast'],
  setup(_, { emit }) {
    const auth = useAuth();
    const links = ref([]);
    const loading = ref(false);
    const error = ref('');

    // Form state
    const form = ref({ url: '', slug: '', expires_in: '' });
    const formError = ref('');
    const formLoading = ref(false);


    // ── API helpers ────────────────────────────────────────────────────────────
    function authHeaders() {
      const { jwt, apiKey } = auth.snapshot();
      if (apiKey) return { 'X-API-Key': apiKey };
      if (jwt) return { Authorization: `Bearer ${jwt}` };
      return {};
    }

    async function apiFetch(path, init = {}) {
      const headers = { ...authHeaders(), ...(init.headers ?? {}) };
      // Don't set Content-Type for DELETE/GET requests with no body
      if (init.body) headers['Content-Type'] = 'application/json';

      const res = await fetch(path, { ...init, headers });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      return body;
    }

    // ── Load links ─────────────────────────────────────────────────────────────
    async function loadLinks() {
      loading.value = true;
      error.value = '';
      try {
        const r = await apiFetch('/api/tools/shortlink');
        links.value = r.data ?? [];
      } catch (e) {
        error.value = e.message;
      } finally {
        loading.value = false;
      }
    }

    // ── Create link ────────────────────────────────────────────────────────────
    async function createLink() {
      formError.value = '';
      if (!form.value.url) { formError.value = 'URL is required'; return; }
      formLoading.value = true;
      try {
        const body = { url: form.value.url };
        if (form.value.slug.trim()) body.slug = form.value.slug.trim();
        if (form.value.expires_in) body.expires_in = parseInt(form.value.expires_in);

        const r = await apiFetch('/api/tools/shortlink', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        links.value.unshift(r.data);
        form.value = { url: '', slug: '', expires_in: '' };
        emit('toast', { kind: 'ok', text: 'Shortlink created!' });
      } catch (e) {
        emit('toast', { kind: 'err', text: e.message });
      } finally {
        formLoading.value = false;
      }
    }

    // ── Delete link ────────────────────────────────────────────────────────────
    const deletingId = ref('');
    async function deleteLink(id) {
      const confirmed = await showConfirm('Delete this shortlink?');
      if (!confirmed) return;
      deletingId.value = id;
      try {
        await apiFetch(`/api/tools/shortlink/${id}`, { method: 'DELETE' });
        links.value = links.value.filter((l) => l.id !== id);
        emit('toast', { kind: 'ok', text: 'Shortlink deleted!' });
      } catch (e) {
        emit('toast', { kind: 'err', text: 'Failed to delete: ' + e.message });
      } finally {
        deletingId.value = '';
      }
    }

    // ── Copy ──────────────────────────────────────────────────────────────────
    // Modal state
    const modalMsg = ref('');
    const modalType = ref('error'); // 'error' | 'confirm'
    const modalResolve = ref(null);

    function showError(msg) {
      modalMsg.value = msg;
      modalType.value = 'error';
      return new Promise((resolve) => { modalResolve.value = resolve; });
    }

    function showConfirm(msg) {
      modalMsg.value = msg;
      modalType.value = 'confirm';
      return new Promise((resolve) => { modalResolve.value = resolve; });
    }

    function closeModal(result = false) {
      if (modalResolve.value) modalResolve.value(result);
      modalMsg.value = '';
      modalResolve.value = null;
    }

    const copiedId = ref('');
    async function copyUrl(url, id) {
      try {
        await navigator.clipboard.writeText(url);
        copiedId.value = id;
        setTimeout(() => (copiedId.value = ''), 2000);
      } catch {
        // fallback
        const el = document.createElement('textarea');
        el.value = url;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        copiedId.value = id;
        setTimeout(() => (copiedId.value = ''), 2000);
      }
    }

    function formatDate(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleDateString('en-US', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    }

    function isExpired(link) {
      return link.expires_at && new Date(link.expires_at) < new Date();
    }

    onMounted(loadLinks);

    // ── Render ─────────────────────────────────────────────────────────────────
    return () => {
      const isAuth = auth.isAuthenticated.value;

      return h('div', {}, [
        // Header
        h('div', { class: 'main-top' }, [
          h('div', { class: 'main-title-row' }, [
            h('h1', { class: 'main-title' }, 'Shortlinks'),
            h('span', { class: 'main-count' }, links.value.length + ' link'),
          ]),
          h('button', {
            class: 'btn sm',
            onClick: loadLinks,
            disabled: loading.value,
          }, loading.value ? [
            h('i', { class: 'bi bi-arrow-clockwise' }),
            ' Loading…',
            ]
            : [
              h('i', { class: 'bi bi-arrow-clockwise' }),
              ' Refresh',
            ]),
        ]),

        // Auth gate
        !isAuth && h('div', { class: 'auth-gate', style: 'margin-bottom:20px' }, [
          h('div', { class: 'auth-gate-row' }, [
            h('span', { class: 'auth-gate-icon' }, '🔒'),
            h('div', { class: 'auth-gate-text' }, [
              h('strong', {}, 'Sign in required'),
              h('div', {}, 'Sign in to create and manage your shortlinks.'),
            ]),
          ]),
        ]),

        // Create form
        isAuth && h('div', {
          style: 'background:var(--bg-2);border:1px solid var(--b-1);border-radius:var(--r-lg);padding:18px;margin-bottom:24px;',
        }, [
          h('div', { class: 'section-label', style: 'margin-bottom:14px' }, 'Create a new shortlink'),

          // URL input
          h('div', { class: 'field' }, [
            h('div', { class: 'field-label' }, [
              h('span', { class: 'name' }, 'url'),
              h('span', { class: 'req' }, '*'),
            ]),
            h('input', {
              class: 'input',
              type: 'url',
              placeholder: 'https://example.com/very-long-url',
              value: form.value.url,
              onInput: (e) => (form.value.url = e.target.value),
            }),
          ]),

          // Slug + expiry row
          h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px' }, [
            h('div', { class: 'field' }, [
              h('div', { class: 'field-label' }, [
                h('span', { class: 'name' }, 'slug'),
                h('span', { class: 'type' }, 'optional'),
              ]),
              h('input', {
                class: 'input',
                type: 'text',
                placeholder: 'custom-slug (auto-generated if empty)',
                value: form.value.slug,
                onInput: (e) => (form.value.slug = e.target.value),
              }),
            ]),
            h('div', { class: 'field' }, [
              h('div', { class: 'field-label' }, [
                h('span', { class: 'name' }, 'expires_in'),
                h('span', { class: 'type' }, 'days, optional'),
              ]),
              h('input', {
                class: 'input',
                type: 'number',
                placeholder: '30 (leave empty for permanent)',
                value: form.value.expires_in,
                min: 1, max: 365,
                onInput: (e) => (form.value.expires_in = e.target.value),
              }),
            ]),
          ]),

          // Error / success
          formError.value && h('div', { style: 'color:var(--err);font-size:13px;margin-bottom:8px' }, formError.value),

          h('button', {
            class: 'btn primary',
            onClick: createLink,
            disabled: formLoading.value,
          }, formLoading.value ? 'Creating…' : '+ Create shortlink'),
        ]),

        // Error state
        error.value && h('div', { class: 'empty', style: 'color:var(--err);margin-bottom:16px' }, error.value),

        // Loading state
        loading.value && h('div', { class: 'empty' }, [
          h('span', { class: 'spinner', style: 'margin-right:8px' }),
          'Loading shortlinks…',
        ]),

        // Empty state
        !loading.value && !error.value && links.value.length === 0 && h('div', { class: 'empty' },
          isAuth ? 'No shortlinks yet. Create your first one above!' : 'Sign in to view your shortlinks.',
        ),

        // Modal
        modalMsg.value && h('div', {
          style: 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);',
          onClick: (e) => { if (e.target === e.currentTarget) closeModal(false); },
        }, [
          h('div', {
            style: 'background:var(--bg-2);border:1px solid var(--b-1);border-radius:var(--r-lg);padding:24px;max-width:340px;width:90%;',
          }, [
            h('div', { style: 'margin-bottom:16px;line-height:1.5;color:var(--fg);' }, modalMsg.value),
            h('div', { style: 'display:flex;justify-content:flex-end;gap:8px;' }, [
              modalType.value === 'confirm' && h('button', {
                class: 'btn sm',
                onClick: () => closeModal(false),
              }, 'Cancel'),
              h('button', {
                class: modalType.value === 'confirm' ? 'btn sm danger' : 'btn sm primary',
                onClick: () => closeModal(modalType.value === 'confirm' ? true : false),
              }, modalType.value === 'confirm' ? 'Delete' : 'OK'),
            ]),
          ]),
        ]),

        // Link list
        !loading.value && links.value.length > 0 && h('div', {
          style: 'display:flex;flex-direction:column;gap:10px;',
        }, links.value.map((link) =>
          h('div', {
            key: link.id,
            style: `background:var(--bg-2);border:1px solid ${isExpired(link) ? 'rgba(239,68,68,0.3)' : 'var(--b-1)'};border-radius:var(--r);padding:14px 16px;`,
          }, [
            // Top row — short URL + actions
            h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap' }, [
              h('span', {
                style: 'font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--accent);',
              }, link.short_url),

              // Expired badge
              isExpired(link) && h('span', {
                style: 'font-size:11px;padding:2px 6px;border-radius:4px;background:rgba(239,68,68,0.12);color:var(--err);',
              }, 'Expired'),

              h('div', { style: 'margin-left:auto;display:flex;gap:6px' }, [
                // Copy button
                h('button', {
                  class: 'btn sm',
                  onClick: () => copyUrl(link.short_url, link.id),
                  title: 'Copy URL',
                }, copiedId.value === link.id ? [
                  h('i', { class: 'bi bi-check2' }),
                  ' Copied',
                  ]
                : [
                  h('i', { class: 'bi bi-copy' }),
                  ' Copy'
                  ]
                ),

                // Open button
                h('a', {
                  class: 'btn sm',
                  href: link.short_url,
                  target: '_blank',
                  rel: 'noopener',
                  title: 'Open link',
                }, '⇗'),

                // Delete button
                h('button', {
                  class: 'btn sm danger',
                  onClick: () => deleteLink(link.id),
                  disabled: deletingId.value === link.id,
                  title: 'Delete',
                }, deletingId.value === link.id ? '…' : h('i', { class: 'bi bi-trash' })),
              ]),
            ]),

            // Destination URL
            h('div', {
              style: 'font-size:12px;color:var(--fg-mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:6px;',
              title: link.url,
            }, '→ ' + link.url),

            // Meta row — clicks + dates
            h('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--fg-dim);' }, [
              h('span', {}, [
                h('i', { class: 'bi bi-eye-fill' }),
                ' ' + link.clicks + ' clicks'
                ]),
                
              h('span', {}, [
                h('i', { class: 'bi bi-calendar-event-fill' }),
                ' ' + formatDate(link.created_at)
                ]),
                
              link.expires_at && h('span', {
                style: isExpired(link) ? 'color:var(--err)' : '',
              }, [
                h('i', { class: 'bi bi-alarm-fill' }),
                ' Expires: ' + formatDate(link.expires_at)
                ]),
                
              !link.expires_at && h('span', {}, [
                h('i', { class: 'bi bi-infinity' }),
                ' Permanent'
                ]),
            ]),
          ]),
        )),
      ]);
    };
  },
};
