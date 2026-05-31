/**
 * Sidebar — brand, endpoint nav, action button row, and a compact user
 * card (when logged in).
 *
 * Auth surface lives on dedicated /login and /profile pages;
 * the sidebar only shows a "Login" button (logged-out) or a user card
 * with a Logout button (logged-in). This keeps the sidebar focused on
 * the actual job — picking what endpoint to try.
 */

import { computed, h } from 'vue';
import { useAuth } from '../auth.js';

export default {
  name: 'Sidebar',
  props: {
    groups: { type: Array, required: true },
    activeTag: { type: String, default: '' },
    totalEndpoints: { type: Number, default: 0 },
  },
  emits: ['selectTag'],
  setup(props, { emit }) {
    const auth = useAuth();

    // Avatar initial — username first, fall back to email, then '?'.
    const initial = computed(() => {
      const u = auth.state.user;
      return (u?.username?.[0] || u?.email?.[0] || '?').toUpperCase();
    });

    // The tier label shown next to the username. We don't have full
    // tier data on the user record; infer from the API key the user
    // has cached. Master keys are issued by ops, so any user with a
    // cached master key is staff. Otherwise everyone is "Free" (we
    // intentionally don't ship a "Pro" tier yet — when we do, this
    // will read from the user record instead).
    const tierLabel = computed(() => {
      // Future-proof: if the auth state ever exposes a tier directly,
      // prefer that over inference.
      const tier = auth.state.user?.tier;
      if (tier === 'master') return 'Staff';
      if (tier === 'pro') return 'Pro';
      return 'Free';
    });

    // Build the next= param so /login can bring the user back to
    // wherever they were. Includes the path + hash so a re-opened
    // dashboard with #op=… re-opens the same endpoint modal.
    //
    // Strip a trailing .html so the next= param matches our clean-URL
    // convention even when the user happens to be on the legacy
    // /<page>.html form (still served by @fastify/static for back-
    // compat). Without this the address bar shows
    // /login?next=%2Fdashboard.html and the post-login redirect drops
    // them right back on the un-canonical URL — exactly the eyesore
    // we just fixed at every other layer. The /index → / map handles
    // the unlikely case where someone hand-typed /index.html, which
    // would otherwise 404 after stripping.
    function loginHref() {
      let path = window.location.pathname.replace(/\.html$/i, '');
      if (path === '/index') path = '/';
      const next = encodeURIComponent(path + window.location.search + window.location.hash);
      return `/login?next=${next}`;
    }

    function onLogout() {
      auth.logout();
      // Stay on the dashboard — the page just downgrades to anonymous.
      // No redirect to /login, which would be jarring after a
      // deliberate logout.
    }

    /**
     * Action button row — Back / Swagger / GitHub + Login OR Profile/Logout.
     * One horizontal row so it reads as a toolbar. Wraps on narrow
     * sidebars (mobile drawer is 86vw, plenty of room).
     */
    function renderActions() {
      return h('div', { class: 'sidebar-actions' }, [
        h('a', { class: 'btn sm', href: '/', title: 'Back to home' }, [
          h('i', { class: 'bi bi-arrow-left' }),
          h('span', { class: 'lbl' }, 'Home'),
        ]),
        h('a', { class: 'btn sm', href: '/docs', target: '_blank', rel: 'noopener', title: 'Swagger reference' }, [
          h('i', { class: 'bi bi-arrow-up-right' }),
          h('span', { class: 'lbl' }, 'Docs'),
        ]),
        h('a', { class: 'btn sm', href: 'https://github.com/Arnov77/', target: '_blank', rel: 'noopener', title: 'Source on GitHub' }, [
          h('i', { class: 'bi bi-github' }),
          h('span', { class: 'lbl' }, 'GitHub'),
        ]),
      ]);
    }

    /**
     * Compact user card — clickable strip that opens /profile for
     * the full picture (usage chart, regenerate key, etc.). The Logout
     * button sits inside but stops propagation so a click on it doesn't
     * also navigate to /profile.
     */
    function renderUserCard() {
      const u = auth.state.user;
      return h('a', {
        class: 'me-card',
        href: '/profile',
        title: 'View profile and usage',
      }, [
        h('div', { class: 'me-avatar' }, initial.value),
        h('div', { class: 'me-meta' }, [
          h('div', { class: 'me-name' }, '@' + u.username),
          h('div', { class: 'me-tier' }, tierLabel.value + ' tier'),
        ]),
        h('button', {
          class: 'me-logout',
          title: 'Sign out',
          onClick: (e) => { e.preventDefault(); e.stopPropagation(); onLogout(); },
        }, [
          h('i', { class: 'bi bi-box-arrow-right' }),
          ]),
      ]);
    }

    function renderLoginButton() {
      return h('a', {
        class: 'btn primary full',
        href: loginHref(),
      }, 'Sign in / Register');
    }

    return () =>
      h('aside', { class: 'sidebar' }, [
        // Brand (hidden on mobile because the topbar already shows it).
        h('a', { class: 'brand', href: '/', style: 'text-decoration:none' }, [
          h('span', { class: 'brand-mark' }, '//'),
          h('span', { class: 'brand-name' }, 'Rex API'),
          h('span', { class: 'brand-ver' }, 'v3'),
        ]),

        // Endpoint groups nav — primary content. flex:1 + overflow-y so
        // a long list scrolls independently of the (pinned-bottom)
        // footer block.
        h('div', { class: 'sidebar-nav-wrap' }, [
          h('div', { class: 'section-label' }, 'Endpoints'),
          h('div', { class: 'nav' }, [
            h('button', {
              class: ['nav-item', props.activeTag === '' && 'active'],
              onClick: () => emit('selectTag', ''),
            }, [
              h('span', {}, 'All'),
              h('span', { class: 'count' }, props.totalEndpoints),
            ]),
            ...props.groups.map((g) =>
              h('button', {
                class: ['nav-item', props.activeTag === g.tag && 'active'],
                onClick: () => emit('selectTag', g.tag),
              }, [
                h('span', { style: 'text-transform:capitalize' }, g.tag.replace(/-/g, ' ')),
                h('span', { class: 'count' }, g.ops.length),
              ]),
            ),
          ]),

          h('div', { class: 'section-label', style: 'margin-top:16px' }, 'Tools'),
          h('div', { class: 'nav' }, [
            h('button', {
              class: ['nav-item', props.activeTag === '__shortlinks__' && 'active'],
              onClick: () => emit('selectTag', '__shortlinks__'),
            }, [
              h('span', {}, [
                h('i', { class: 'bi bi-link-45deg'}),
                ' Shortlinks',
              ]),
            ]),
          ]),
        ]),

        // Footer block — actions + auth surface. Tucked at the bottom
        // and ordered so the auth state is the very last thing users
        // see (closest to where they'd reach with their thumb on mobile).
        h('div', { class: 'sidebar-foot' }, [
          renderActions(),
          auth.isAuthenticated.value ? renderUserCard() : renderLoginButton(),
        ]),
      ]);
  },
};
