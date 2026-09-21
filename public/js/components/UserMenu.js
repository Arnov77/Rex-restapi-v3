/**
 * UserMenu — avatar in the topbar that opens account actions.
 *
 * Takes over what the sidebar's me-card used to do, so the sidebar can
 * go away entirely and the layout stops shifting between tabs. Reads the
 * same auth singleton, so nothing about sign-in state changes.
 */

import { h, ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useAuth } from '../auth.js';

export default {
  name: 'UserMenu',
  setup() {
    const auth = useAuth();
    const open = ref(false);
    let rootEl = null;

    const pwOpen = ref(false);
    const pwCurrent = ref('');
    const pwNext = ref('');
    const pwBusy = ref(false);
    const pwError = ref(null);
    const pwDone = ref(false);

    const delOpen = ref(false);
    const delPw = ref('');
    const delBusy = ref(false);
    const delError = ref(null);

    function openDel() {
      open.value = false;
      delPw.value = '';
      delError.value = null;
      delOpen.value = true;
    }

    async function submitDel() {
      if (delBusy.value || !delPw.value) return;
      delBusy.value = true;
      delError.value = null;
      try {
        const res = await fetch('/api/me/delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.state.jwt}`,
          },
          body: JSON.stringify({ password: delPw.value }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          delError.value = data?.error?.message || `Gagal menghapus (${res.status})`;
          return;
        }
        auth.logout();
        window.location.href = '/';
      } catch (err) {
        delError.value = err.message || String(err);
      } finally {
        delBusy.value = false;
      }
    }

    function openPw() {
      open.value = false;
      pwCurrent.value = '';
      pwNext.value = '';
      pwError.value = null;
      pwDone.value = false;
      pwOpen.value = true;
    }

    async function submitPw() {
      if (pwBusy.value || !pwCurrent.value || pwNext.value.length < 8) return;
      pwBusy.value = true;
      pwError.value = null;
      try {
        const res = await fetch('/api/me/password/change', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.state.jwt}`,
          },
          body: JSON.stringify({ currentPassword: pwCurrent.value, newPassword: pwNext.value }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          pwError.value = data?.error?.message || `Gagal menyimpan (${res.status})`;
          return;
        }
        pwDone.value = true;
        pwCurrent.value = '';
        pwNext.value = '';
      } catch (err) {
        pwError.value = err.message || String(err);
      } finally {
        pwBusy.value = false;
      }
    }

    const user = computed(() => auth.state.user);
    const initial = computed(() => {
      const u = user.value;
      return (u?.displayName || u?.username || u?.email || '?').charAt(0).toUpperCase();
    });
    const tierLabel = computed(() => {
      const t = user.value?.tier || 'free';
      return t.charAt(0).toUpperCase() + t.slice(1);
    });

    function onDocClick(e) {
      if (rootEl && !rootEl.contains(e.target)) open.value = false;
    }
    function onEsc(e) {
      if (e.key === 'Escape') { open.value = false; pwOpen.value = false; delOpen.value = false; }
    }
    onMounted(() => {
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onEsc);
    });
    onBeforeUnmount(() => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onEsc);
    });

    function loginHref() {
      let path = window.location.pathname.replace(/\.html$/i, '');
      if (path === '/index') path = '/';
      return '/login?next=' + encodeURIComponent(path + window.location.search + window.location.hash);
    }

    function logout() {
      open.value = false;
      auth.logout();
      window.location.href = '/';
    }

    return () => {
      if (!auth.isAuthenticated.value) {
        return h('a', { class: 'btn primary sm', href: loginHref() }, 'Masuk');
      }

      const modal = pwOpen.value && h('div', {
        class: 'pw-backdrop',
        onClick: (e) => { if (e.target === e.currentTarget) pwOpen.value = false; },
      }, [
        h('div', { class: 'pw-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pw-title' }, [
          h('h3', { id: 'pw-title' }, 'Ganti kata sandi'),

          pwDone.value
            ? h('div', { class: 'pw-ok' }, 'Kata sandi berhasil diganti.')
            : [
                h('label', { class: 'pw-label', for: 'pw-cur' }, 'Kata sandi saat ini'),
                h('input', {
                  id: 'pw-cur', type: 'password', class: 'input', autocomplete: 'current-password',
                  value: pwCurrent.value, onInput: (e) => (pwCurrent.value = e.target.value),
                }),
                h('label', { class: 'pw-label', for: 'pw-new' }, 'Kata sandi baru'),
                h('input', {
                  id: 'pw-new', type: 'password', class: 'input', autocomplete: 'new-password',
                  placeholder: 'Minimal 8 karakter',
                  value: pwNext.value, onInput: (e) => (pwNext.value = e.target.value),
                  onKeydown: (e) => { if (e.key === 'Enter') submitPw(); },
                }),
                pwError.value && h('div', { class: 'pw-err' }, pwError.value),
              ],

          h('div', { class: 'pw-actions' }, pwDone.value
            ? [h('button', { type: 'button', class: 'btn primary', onClick: () => (pwOpen.value = false) }, 'Selesai')]
            : [
                h('button', { type: 'button', class: 'btn', onClick: () => (pwOpen.value = false) }, 'Batal'),
                h('button', {
                  type: 'button', class: 'btn primary',
                  disabled: pwBusy.value || !pwCurrent.value || pwNext.value.length < 8,
                  onClick: submitPw,
                }, pwBusy.value ? 'Menyimpan…' : 'Simpan'),
              ]),
        ]),
      ]);

      const hasPw = !!user.value?.hasPassword;
      const delModal = delOpen.value && h('div', {
        class: 'pw-backdrop',
        onClick: (e) => { if (e.target === e.currentTarget) delOpen.value = false; },
      }, [
        h('div', { class: 'pw-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'del-title' }, [
          h('h3', { id: 'del-title' }, 'Hapus akun'),
          h('p', { class: 'del-warn' },
            'Akun, API key, shortlink, dan riwayat pemakaianmu akan dihapus permanen. ' +
            'Bot atau aplikasi yang memakai key ini langsung berhenti bekerja. Tidak bisa dibatalkan.'),

          hasPw
            ? [
                h('label', { class: 'pw-label', for: 'del-pw' }, 'Masukkan kata sandi untuk konfirmasi'),
                h('input', {
                  id: 'del-pw', type: 'password', class: 'input', autocomplete: 'current-password',
                  value: delPw.value, onInput: (e) => (delPw.value = e.target.value),
                  onKeydown: (e) => { if (e.key === 'Enter') submitDel(); },
                }),
                delError.value && h('div', { class: 'pw-err' }, delError.value),
              ]
            : h('div', { class: 'pw-err' }, [
                'Akun ini belum punya kata sandi. ',
                h('a', { href: '/dashboard#keys', style: 'color:inherit;font-weight:600' }, 'Buat kata sandi dulu'),
                ' untuk konfirmasi penghapusan.',
              ]),

          h('div', { class: 'pw-actions' }, [
            h('button', { type: 'button', class: 'btn', onClick: () => (delOpen.value = false) }, 'Batal'),
            hasPw && h('button', {
              type: 'button', class: 'btn del-confirm',
              disabled: delBusy.value || !delPw.value,
              onClick: submitDel,
            }, delBusy.value ? 'Menghapus…' : 'Hapus permanen'),
          ]),
        ]),
      ]);

      return h('div', {
        class: 'usermenu',
        ref: (el) => (rootEl = el),
      }, [
        modal,
        delModal,
        h('button', {
          type: 'button',
          class: 'usermenu-avatar',
          'aria-haspopup': 'menu',
          'aria-expanded': String(open.value),
          'aria-label': 'Menu akun',
          onClick: (e) => { e.stopPropagation(); open.value = !open.value; },
        }, initial.value),

        open.value && h('div', { class: 'usermenu-pop', role: 'menu' }, [
          h('div', { class: 'usermenu-head' }, [
            h('div', { class: 'usermenu-name' },
              user.value?.displayName || '@' + (user.value?.username || '')),
            user.value?.displayName && h('div', { class: 'usermenu-handle' }, '@' + user.value.username),
            user.value?.email && h('div', { class: 'usermenu-email' }, user.value.email),
            h('div', { class: 'usermenu-tier' }, tierLabel.value + ' tier'),
          ]),
          h('a', { class: 'usermenu-item', href: '/', role: 'menuitem' }, [
            h('i', { class: 'bi bi-house' }), ' Beranda',
          ]),
          h('a', { class: 'usermenu-item', href: '/dashboard#overview', role: 'menuitem' }, [
            h('i', { class: 'bi bi-graph-up' }), ' Ringkasan pemakaian',
          ]),
          user.value?.hasPassword
            ? h('button', { type: 'button', class: 'usermenu-item', role: 'menuitem', onClick: openPw }, [
                h('i', { class: 'bi bi-key' }), ' Ganti kata sandi',
              ])
            : h('a', { class: 'usermenu-item', href: '/dashboard#keys', role: 'menuitem' }, [
                h('i', { class: 'bi bi-key' }), ' Buat kata sandi',
              ]),
          h('a', { class: 'usermenu-item', href: '/docs', role: 'menuitem' }, [
            h('i', { class: 'bi bi-book' }), ' Dokumentasi',
          ]),
          h('a', {
            class: 'usermenu-item',
            href: 'https://github.com/Arnov77/Rex-restapi-v3',
            target: '_blank', rel: 'noopener', role: 'menuitem',
          }, [
            h('i', { class: 'bi bi-github' }), ' GitHub',
          ]),
          h('button', {
            type: 'button', class: 'usermenu-item danger', role: 'menuitem',
            onClick: openDel,
          }, [
            h('i', { class: 'bi bi-trash' }), ' Hapus akun',
          ]),
          h('button', {
            type: 'button', class: 'usermenu-item danger', role: 'menuitem',
            onClick: logout,
          }, [
            h('i', { class: 'bi bi-box-arrow-right' }), ' Keluar',
          ]),
        ]),
      ]);
    };
  },
};
