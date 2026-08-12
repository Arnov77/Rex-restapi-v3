/**
 * ApiKeysTab — API key management surface.
 *
 * Jobs:
 *   - See the cached key (masked by default)
 *   - Copy it to the clipboard
 *   - Reveal via the account password (POST /api/me/key/reveal — mirrors
 *     /profile's reveal gate)
 *   - Regenerate (invalidates the old key server-side, caches the new one)
 *   - Revoke (clears the device cache; full invalidation still lives in
 *     /profile until the backend ships a DELETE key endpoint)
 *
 * State model — three states, NOT two:
 *   1. signedOut       → emptyState with "Sign in" (unchanged)
 *   2. signedIn + cachedKey  → keyCard (unchanged)
 *   3. signedIn + NO cachedKey → uncachedState: the account DOES have a key,
 *      it just isn't stored on this device (different browser, friend's
 *      login, cleared storage). Reveal asks for the account password and
 *      fetches the plaintext from the server; Regenerate issues a fresh
 *      one. Showing "Sign in" here would be wrong — the user IS signed in.
 *
 * Emits:
 *   onToast({ kind, text }) — feedback bubbles
 */

import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue';
import PasswordModal from './PasswordModal.js';

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => undefined);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.body.removeChild(ta);
  return Promise.resolve(ok);
}

export default {
  name: 'ApiKeysTab',
  props: {
    auth: { type: Object, required: true },
  },
  emits: ['onToast'],
  setup(props, { emit }) {
    const revealed = ref(false);
    const regenerating = ref(false);
    const revealing = ref(false);

    // Password modal state — replaces the vanilla window.prompt() calls.
    // modalMode: 'reveal' | 'regen' | null (null === closed).
    const modalMode = ref(null);
    const modalLoading = ref(false);
    const modalError = ref(null);

    const hasKey = computed(() => !!props.auth.state.apiKey);
    // Signed in but the device never cached a key (different browser,
    // friend's login, cleared localStorage, or a freshly provisioned key).
    const signedInNoKey = computed(() => props.auth.isAuthenticated.value && !hasKey.value);
    const keyLabel = computed(() => {
      const k = props.auth.state.apiKey;
      if (!k) return null;
      return k.length > 10 ? k.slice(0, 8) + '•••' + k.slice(-4) : '••••••••';
    });

    function copyKey() {
      if (!props.auth.state.apiKey) return;
      copyText(props.auth.state.apiKey).then((ok) => {
        emit('onToast', { kind: ok === false ? 'err' : 'ok', text: ok === false ? 'Copy blocked — select the key manually' : 'API key copied to clipboard' });
      });
    }

    function toggleReveal() {
      if (!props.auth.state.apiKey) return;
      if (!revealed.value) {
        // The cached key was generated at register/regenerate time; we
        // don't keep a server-readable plaintext reference for user-tier
        // keys, so a raw "peek" isn't possible without re-authenticating.
        emit('onToast', { kind: 'err', text: 'User keys can only be revealed once (at registration). Regenerate a new key below if needed.' });
        return;
      }
      revealed.value = false;
    }

    function openReveal() {
      if (!signedInNoKey.value || revealing.value || regenerating.value) return;
      modalMode.value = 'reveal';
      modalLoading.value = false;
      modalError.value = null;
    }

    async function submitReveal(password) {
      if (revealing.value || !signedInNoKey.value) return;
      revealing.value = true;
      modalLoading.value = true;
      modalError.value = null;
      try {
        const res = await fetch('/api/me/key/reveal', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${props.auth.state.jwt}`,
          },
          body: JSON.stringify({ password }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          // Wrong password / server error stays INSIDE the modal (inline
          // error + retry) instead of a toast — no browser prompt ever.
          const msg = data?.error?.message || data?.error || (res.status === 401 ? 'Wrong password' : `Server error ${res.status}`);
          modalError.value = msg;
          return;
        }
        const data = await res.json();
        const plaintext = data?.data?.plaintext || data?.plaintext;
        if (!plaintext) {
          emit('onToast', { kind: 'err', text: 'Server returned no key — regenerate instead if it was never stored.' });
          return;
        }
        props.auth.setApiKey(plaintext);
        revealed.value = true;
        emit('onToast', { kind: 'ok', text: 'API key revealed and saved on this device' });
        modalMode.value = null;
      } catch (err) {
        // Wrong password / server error stays INSIDE the modal (inline
        // error + retry) instead of a toast + browser prompt.
        if (err?.message !== 'redirecting') {
          modalError.value = err?.message || 'Reveal failed — check your password and try again';
        }
      } finally {
        revealing.value = false;
        modalLoading.value = false;
      }
    }

    function openRegenerate() {
      if (regenerating.value || revealing.value) return;
      modalMode.value = 'regen';
      modalLoading.value = false;
      modalError.value = null;
    }

    async function submitRegenerate(password) {
      if (regenerating.value) return;
      regenerating.value = true;
      modalLoading.value = true;
      modalError.value = null;
      try {
        await props.auth.regenerateKey(password);
        revealed.value = false;
        emit('onToast', { kind: 'ok', text: 'New API key generated — it\u2019s active on this device now' });
        modalMode.value = null;
      } catch (err) {
        modalError.value = err?.message || 'Regeneration failed — check your password and try again';
      } finally {
        regenerating.value = false;
        modalLoading.value = false;
      }
    }

    // window.prompt() replaced by the styled PasswordModal — openRegenerate
    // and submitRegenerate are defined above (declarative UI, no browser
    // prompt).

    // Revoke confirmation — styled modal, no window.confirm() (native
    // dialogs break the dark theme and leak the page origin in the title).
    const confirmOpen = ref(false);

    function revokeKey() {
      if (!props.auth.state.apiKey) return;
      confirmOpen.value = true;
    }

    function confirmRevoke() {
      confirmOpen.value = false;
      // The backend has no user-tier DELETE-key endpoint today (keys are
      // row-level and unencrypted per user), so this is a device-scoped
      // revoke; a server-side invalidation still requires going through
      // /profile.
      props.auth.setApiKey(null);
      revealed.value = false;
      emit('onToast', { kind: 'ok', text: 'Key removed from this device' });
    }

    // Esc / backdrop / Cancel close without doing anything — same
    // semantics as the "cancel" branch of the old window.confirm().
    function cancelRevoke() {
      confirmOpen.value = false;
    }

    // Esc while the dialog is open — same pattern as PasswordModal: one
    // window-level keydown listener added around the component's lifetime,
    // gated by confirmOpen so it only acts while the dialog is visible.
    function escGuard(e) {
      if (e.key === 'Escape' && confirmOpen.value) cancelRevoke();
    }
    onMounted(() => window.addEventListener('keydown', escGuard));
    onBeforeUnmount(() => window.removeEventListener('keydown', escGuard));

    function revokeConfirmModal() {
      if (!confirmOpen.value) return null;
      return h('div', {
        class: 'overlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Remove API key',
        onClick: (e) => { if (e.target.classList.contains('overlay')) cancelRevoke(); },
      }, [
        h('div', { class: 'modal confirm-modal', onClick: (e) => e.stopPropagation() }, [
          h('div', { class: 'modal-head' }, [
            h('div', { class: 'title' }, [
              h('h2', {}, 'Remove API key'),
              h('p', { class: 'desc' }, 'Your bots will keep working until you regenerate the key server-side.'),
            ]),
            h('button', { class: 'modal-close', onClick: cancelRevoke, ariaLabel: 'Close' }, '\u2715'),
          ]),
          h('div', { class: 'modal-foot' }, [
            h('button', { class: 'btn', onClick: cancelRevoke, type: 'button' }, 'Cancel'),
            h('button', { class: 'btn danger', onClick: confirmRevoke, type: 'button' }, 'Remove key'),
          ]),
        ]),
      ]);
    }

    // --- Render ----------------------------------------------------------

    function header() {
      let count = 'No key on this device';
      if (hasKey.value) count = '1 active key on this device';
      else if (signedInNoKey.value) count = 'Key lives on your account, not this device';
      return h('div', { class: 'main-top' }, [
        h('div', { class: 'main-title-row' }, [
          h('h1', { class: 'main-title' }, 'API Keys'),
          h('span', { class: 'main-count' }, count),
        ]),
      ]);
    }

    // State 1: genuinely signed out.
    function emptyState() {
      return h('div', { class: 'empty' }, [
        h('strong', { style: 'display:block;margin-bottom:6px;color:var(--fg)' }, 'No API key on this device'),
        h('span', { style: 'color:var(--fg-mu);font-size:13px' },
          'Sign in first — keys are issued automatically at registration. If a key was created on another device, copy it in manually.',
        ),
        h('a', { class: 'btn primary', style: 'margin-top:14px', href: '/login?next=/dashboard' }, 'Sign in'),
      ]);
    }

    // State 3: signed in, but this device has never cached the key.
    function uncachedState() {
      return h('div', { class: 'card key-card key-card-none' }, [
        h('div', { class: 'key-row' }, [
          h('div', { class: 'key-glyph' }, '⚿'),
          h('div', { class: 'key-body' }, [
            h('div', { class: 'key-name-row' }, [
              h('strong', { class: 'key-name' }, '••••••••••••••••'),
              h('span', { class: ['key-badge', 'badge-dim'] }, 'On account'),
            ]),
            h('div', { class: 'key-meta' }, [
              h('span', {}, 'X-API-Key header'),
              h('span', { class: 'key-sep' }, '·'),
              h('span', {}, 'Your account key isn\u2019t stored on this device'),
            ]),
          ]),
            h('div', { class: 'key-actions' }, [
            h('button', { class: 'btn sm', onClick: openReveal, disabled: revealing.value || regenerating.value }, revealing.value ? 'Revealing…' : 'Reveal'),
            h('button', { class: 'btn sm', onClick: openRegenerate, disabled: regenerating.value || revealing.value }, regenerating.value ? 'Regenerating…' : 'Regenerate'),
          ]),
        ]),
        h('div', { class: 'key-note' }, [
          h('span', { class: 'key-note-icon' }, 'ℹ'),
          h('span', {}, 'Signed in as @' + (props.auth.state.user?.username ?? '') + ' — your account has a key, but this device never stored one (new browser, another person\u2019s login, or cleared storage). Reveal needs your account password; regenerate issues a fresh key that replaces the old one everywhere.'),
        ]),
      ]);
    }

    // State 2: cached key present.
    function keyCard() {
      return h('div', { class: 'card key-card' }, [
        h('div', { class: 'key-row' }, [
          h('div', { class: 'key-glyph' }, '⚿'),
          h('div', { class: 'key-body' }, [
            h('div', { class: 'key-name-row' }, [
              h('strong', { class: 'key-name' }, revealed.value ? props.auth.state.apiKey : keyLabel.value),
              h('span', { class: ['key-badge', 'badge-ok'] }, 'Active'),
            ]),
            h('div', { class: 'key-meta' }, [
              h('span', {}, 'X-API-Key header'),
              h('span', { class: 'key-sep' }, '·'),
              h('span', {}, 'Issued at registration'),
            ]),
          ]),
          h('div', { class: 'key-actions' }, [
            h('button', { class: 'btn sm', onClick: copyKey }, '⎘ Copy'),
            h('button', { class: 'btn sm', onClick: toggleReveal }, revealed.value ? 'Hide' : 'Reveal'),
            h('button', { class: 'btn sm danger', onClick: revokeKey }, 'Remove'),
          ]),
        ]),
        h('div', { class: 'key-note' }, [
          h('span', { class: 'key-note-icon' }, 'ℹ'),
          h('span', {}, 'The plaintext key lives only on devices where you\u2019ve signed in. Regenerate to issue a fresh key everywhere at once.'),
        ]),
        h('div', { class: 'key-actions-row' }, [
          h('button', {
            class: 'btn primary full',
            onClick: openRegenerate,
            disabled: regenerating.value || revealing.value,
          }, regenerating.value ? 'Regenerating…' : 'Regenerate key'),
        ]),
      ]);
    }

    function passwordModal() {
      if (!modalMode.value) return null;
      const isRegen = modalMode.value === 'regen';
      return h(PasswordModal, {
        title: isRegen ? 'Regenerate API key' : 'Reveal API key',
        hint: isRegen
          ? 'Your current key will stop working immediately — every device and bot using it must switch to the new one.'
          : 'User keys are revealed once (at registration). Re-authenticate with your account password to cache it on this device.',
        actionLabel: isRegen ? 'Regenerate key' : 'Reveal key',
        danger: isRegen,
        loading: modalLoading.value,
        error: modalError.value,
        onConfirm: isRegen ? submitRegenerate : submitReveal,
        onCancel: () => { modalMode.value = null; },
        onClose: () => { modalMode.value = null; },
      });
    }

    return () =>
      h('div', { class: 'apikeys' }, [
        header(),
        hasKey.value ? keyCard() : signedInNoKey.value ? uncachedState() : emptyState(),
        passwordModal(),
        revokeConfirmModal(),
      ]);
  },
};
