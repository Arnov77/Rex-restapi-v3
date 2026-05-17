/**
 * Rex API playground — Vue 3 entry.
 *
 * Mounts the root component, which composes:
 *   Sidebar          — endpoint nav + footer links + auth widget (bottom)
 *   EndpointList     — searchable grid of operation cards
 *   TryItModal       — schema-driven form + result pane
 *   Toasts           — non-blocking feedback for regenerate / copy
 *
 * Composables:
 *   useAuth()    — login/logout/regenerate state, persisted in localStorage
 *   useOpenApi() — fetches /docs/json once, exposes grouped operations
 *
 * The root component is intentionally thin: it holds three pieces of UI
 * state (active tag, currently-open op, sidebar drawer for mobile) and
 * wires the rest together. Everything domain-specific lives in the
 * composables / child components.
 */

import { createApp, h, ref, onMounted, watch } from 'vue';
import Sidebar from './components/Sidebar.js';
import EndpointList from './components/EndpointList.js';
import TryItModal from './components/TryItModal.js';
import { useAuth } from './auth.js';
import { useOpenApi } from './openapi.js';
import { ApiClient } from './api.js';

const App = {
  name: 'App',
  setup() {
    const auth = useAuth();
    const openapi = useOpenApi();
    const client = new ApiClient(() => auth.snapshot());

    const activeTag = ref('');
    const openOp = ref(null);

    // Mobile drawer state. Desktop ignores this — its sidebar is
    // permanently visible because the CSS @media query overrides the
    // off-canvas transform at viewports ≥861px.
    const drawerOpen = ref(false);
    function closeDrawer() { drawerOpen.value = false; }

    const toasts = ref([]); // { id, kind:'ok'|'err', text }
    let toastSeq = 0;
    function toast(kind, text, ttl = 3500) {
      const id = ++toastSeq;
      toasts.value.push({ id, kind, text });
      setTimeout(() => {
        toasts.value = toasts.value.filter((t) => t.id !== id);
      }, ttl);
    }

    onMounted(async () => {
      await openapi.load();
      // init() is no-op when there's no JWT in localStorage; otherwise
      // confirms the token + pulls fresh user/usage. Kicked off after
      // openapi.load so the spec is ready by the time the user clicks
      // a card (avoids a small race on slow connections).
      auth.init();
    });

    // Lock body scroll while the mobile drawer is open. CSS handles the
    // visual; this just adds the class that triggers it.
    watch(drawerOpen, (open) => {
      const root = document.querySelector('.layout');
      if (!root) return;
      root.classList.toggle('sidebar-open', open);
    });

    // Selecting a tag on mobile usually means "I picked what to look at,
    // close the drawer". On desktop the drawer is irrelevant; closing it
    // is a harmless no-op there.
    function onSelectTag(t) {
      activeTag.value = t;
      closeDrawer();
    }

    // --- render ----------------------------------------------------

    function renderTopbar() {
      // Mobile-only header. CSS hides it on ≥861px viewports.
      return h('header', { class: 'topbar-mobile' }, [
        h('button', {
          class: 'hamburger',
          'aria-label': 'Open menu',
          onClick: () => (drawerOpen.value = true),
        }, '☰'),
        h('a', { class: 'brand', href: '/', style: 'text-decoration:none' }, [
          h('span', { class: 'brand-mark' }, '//'),
          h('span', { class: 'brand-name' }, 'Rex API'),
          h('span', { class: 'brand-ver', style: 'margin-left:auto' }, 'v3'),
        ]),
      ]);
    }

    return () =>
      h('div', { class: 'layout' }, [
        renderTopbar(),

        h(Sidebar, {
          groups: openapi.groups.value,
          activeTag: activeTag.value,
          totalEndpoints: openapi.totalEndpoints.value,
          onSelectTag: onSelectTag,
        }),

        // Backdrop — only visually present when .sidebar-open is set on
        // .layout. Tap-to-close is wired here.
        h('div', {
          class: 'sidebar-backdrop',
          onClick: closeDrawer,
        }),

        h('main', { class: 'main' }, [
          openapi.state.loading
            ? h('div', { class: 'empty' }, 'Loading API spec…')
            : openapi.state.error
              ? h('div', { class: 'empty' }, 'Failed to load /docs/json: ' + openapi.state.error)
              : h(EndpointList, {
                  groups: openapi.groups.value,
                  activeTag: activeTag.value,
                  onSelect: (op) => (openOp.value = op),
                }),
        ]),

        // Modal — keyed on op so re-opening a different endpoint cleanly
        // remounts (clears form + result without manual reset wiring).
        openOp.value && h(TryItModal, {
          key: openOp.value.method + ' ' + openOp.value.path,
          op: openOp.value,
          securitySchemes: openapi.securitySchemes.value,
          apiClient: client,
          onClose: () => (openOp.value = null),
        }),

        // Toasts
        h('div', { class: 'toasts' }, toasts.value.map((t) =>
          h('div', { class: 'toast ' + t.kind, key: t.id }, t.text),
        )),
      ]);
  },
};

createApp(App).mount('#app');
