/**
 * Rex API dashboard — Vue 3 entry (redesigned, tabbed workspace).
 *
 * Surfaces:
 *   Overview          — stat cards, quota meter, active key, Quick Start,
 *                       7-day activity chart, recent requests log
 *   Endpoints         — the existing searchable playground (groups grid,
 *                       schema-driven Try-It modal with auth-gate)
 *   API Keys          — view/copy the cached key, regenerate, revoke
 *   Shortlinks        — the existing ShortlinkManager
 *
 * Routing is tag-based (single `activeTag` ref), matching the original
 * architecture so all existing components stay untouched:
 *   '__overview__'            Overview tab
 *   ''                        Endpoints (all)
 *   '<tag>'                   Endpoints filtered by tag
 *   '__shortlinks__'          Shortlinks manager
 *   '__apikeys__'              API Keys tab
 *
 * PERFORMANCE: the default view is Endpoints, so its components
 * (Sidebar, EndpointList, TryItModal) are static imports and load on
 * page start. The three other tabs are lazy-loaded (dynamic import())
 * the first time they are opened — their code never hits the network
 * unless the user navigates there. A lazy component renders a small
 * placeholder while the chunk downloads.
 *
 * Composables / child components:
 *   useAuth()          — login/logout/regenerate state, persisted in localStorage
 *   useOpenApi()       — fetches /docs/json once, exposes grouped operations
 *   Sidebar            — endpoint nav + footer links + auth widget (bottom)
 *   EndpointList       — searchable grid of operation cards
 *   TryItModal         — schema-driven form + result pane
 *   OverviewTab        — analytics cards + chart + recent log (lazy)
 *   ApiKeysTab         — key view/regenerate/revoke surface (lazy)
 *   ShortlinkManager   — the existing shortlink manager (lazy)
 *   Toasts             — non-blocking feedback
 *
 * The root component stays intentionally thin: it holds four pieces of
 * UI state (active tag, currently-open op, mobile drawer, recent-request
 * log) and wires the rest together. Everything domain-specific lives in
 * the composables / child components.
 */

import { createApp, h, ref, computed, onMounted, watch, defineAsyncComponent } from 'vue';
import Sidebar from './components/Sidebar.js';
import EndpointList from './components/EndpointList.js';
import TryItModal from './components/TryItModal.js';
import { useAuth } from './auth.js';
import { useOpenApi } from './openapi.js';
import { ApiClient } from './api.js';

// Lazy-only tabs: fetched on first navigation, not at page load.
// (OverviewTab: ~20 KB — has the usage poller + chart; it isn't needed
// until the user opens the Overview tab.)
const OverviewTab = defineAsyncComponent(() => import('./components/OverviewTab.js'));
const ApiKeysTab = defineAsyncComponent(() => import('./components/ApiKeysTab.js'));
const ShortlinkManager = defineAsyncComponent(() => import('./components/ShortlinkManager.js'));

// Shared placeholder shown while a lazy tab's chunk downloads. On
// typical mobile 4G this is rarely longer than one frame, but the
// placeholder keeps layout stable (same height band as a tab).
function renderLazyPlaceholder(label) {
  return h('div', { class: 'lazy-placeholder', role: 'status', 'aria-label': `Loading ${label}…` }, [
    h('span', { class: 'lazy-spinner' }),
    h('span', {}, `Loading ${label}…`),
  ]);
}

const LS_RECENT = 'rex.recent';
const LS_ONBOARDING = 'rex.onboardingSeen';
const RECENT_MAX = 12;

/**
 * Read-only recent-request log, persisted in localStorage.
 *
 * The backend has no "request history" endpoint — usage is a single
 * daily counter (/api/me/usage). Recording each playground execution
 * client-side is what makes the Overview's "Recent Requests" log and
 * the 7-day chart possible without a schema change. A server-side
 * history API (an audit-log endpoint) is the right long-term fix; this
 * gives the UX today at zero backend cost.
 */
function loadRecent() {
  try {
    const raw = localStorage.getItem(LS_RECENT);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(-RECENT_MAX) : [];
  } catch { return []; }
}

function pushRecent(entry) {
  try {
    const arr = loadRecent();
    arr.push({
      method: entry.method,
      path: entry.path,
      status: entry.status,
      elapsedMs: entry.elapsedMs,
      ts: Date.now(),
    });
    localStorage.setItem(LS_RECENT, JSON.stringify(arr.slice(-RECENT_MAX)));
  } catch { /* quota errors are fine — log is non-critical */ }
}

/**
 * Onboarding checklist — 3 activation steps shown once on first login.
 *
 * Stored server-side nowhere (localStorage flag), and each item's done
 * state derives from REAL runtime state rather than manual ticks:
 *   copyKey   — the device has a cached X-API-Key
 *   firstCall — at least one request has been recorded locally
 *   explored  — user clicked "View docs" from the checklist itself
 * Dismissing is also permanent per device.
 */
function checklistState(auth, recentCount) {
  return {
    seen: localStorage.getItem(LS_ONBOARDING) === '1',
    items: [
      { id: 'copyKey', title: 'Copy your API key', hint: 'Open the API Keys tab and copy your key to the clipboard.', done: !!auth.state.apiKey },
      { id: 'firstCall', title: 'Make your first request', hint: 'Try any endpoint from the playground — we\u2019ll log it here automatically.', done: recentCount > 0 },
      { id: 'explored', title: 'Explore the documentation', hint: 'Read the full reference to see every parameter and example.', done: false, action: '/docs' },
    ],
  };
}

const App = {
  name: 'App',
  setup() {
    const auth = useAuth();
    const openapi = useOpenApi();
    const client = new ApiClient(() => auth.snapshot());

    const activeTag = ref('');
    const openOp = ref(null);
    const drawerOpen = ref(false);
    const onboardingDismissed = ref(localStorage.getItem(LS_ONBOARDING) === '1');
    const recent = ref(loadRecent());

    const toasts = ref([]); // { id, kind:'ok'|'err', text }
    let toastSeq = 0;
    function toast(kind, text, ttl = 3500) {
      const id = ++toastSeq;
      toasts.value.push({ id, kind, text });
      setTimeout(() => {
        toasts.value = toasts.value.filter((t) => t.id !== id);
      }, ttl);
    }

    /** Record a request into the local log + Overview log + onboarding. */
    function recordRequest(entry) {
      pushRecent(entry);
      recent.value = loadRecent();
    }

    onMounted(async () => {
      await openapi.load();
      // init() is no-op when there's no JWT in localStorage; otherwise
      // confirms the token + pulls fresh user/usage. Kicked off after
      // openapi.load so the spec is ready by the time the user clicks
      // a card (avoids a small race on slow connections).
      auth.init();
    });

    // Mobile drawer state. Desktop ignores this — its sidebar is
    // permanently visible because the CSS @media query overrides the
    // off-canvas transform at viewports ≥861px.
    watch(drawerOpen, (open) => {
      const root = document.querySelector('.layout');
      if (!root) return;
      root.classList.toggle('sidebar-open', open);
    });

    function closeDrawer() { drawerOpen.value = false; }

    function onSelectTag(t) {
      activeTag.value = t;
      closeDrawer();
    }

    // --- Onboarding ---------------------------------------------------

    function onboardingMarkExplored() {
      const state = checklistState(auth, recent.value.length);
      const explored = state.items.find((i) => i.id === 'explored');
      if (explored) explored.done = true;
    }

    function dismissOnboarding() {
      onboardingDismissed.value = true;
      localStorage.setItem(LS_ONBOARDING, '1');
    }

    // --- Derived tab labels -------------------------------------------

    const tabLabels = computed(() => ({
      '__overview__': 'Overview',
      '': 'Endpoints',
      '__apikeys__': 'API Keys',
      '__shortlinks__': 'Shortlinks',
    }));

    // --- Render -------------------------------------------------------

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

    /**
     * Tab bar — replaces the previous implicit "sidebar is the nav" model
     * with an explicit workspace navigator. The Overview tab is the new
     * entry point (analytics), Endpoints keeps the existing playground,
     * API Keys moves key management out of /profile, Shortlinks keeps
     * the existing manager.
     */
    function renderTabBar() {
      const tabs = ['__overview__', '', '__apikeys__', '__shortlinks__'];
      return h('nav', { class: 'tabbar', 'aria-label': 'Dashboard tabs' }, [
        ...tabs.map((t) => {
          const active = activeTag.value === t;
          return h('button', {
            class: ['tab-btn', active && 'active'],
            'aria-current': active ? 'page' : undefined,
            onClick: () => onSelectTag(t),
          }, tabLabels.value[t]);
        }),
      ]);
    }

    /** Onboarding checklist banner — shown once until dismissed. */
    function renderOnboarding() {
      if (onboardingDismissed.value) return null;
      if (!auth.isAuthenticated.value) return null;

      const state = checklistState(auth, recent.value.length);
      const allDone = state.items.every((i) => i.done);
      if (allDone && !state.items.some((i) => i.action)) return null;

      return h('section', { class: 'onboarding', 'aria-label': 'Getting started checklist' }, [
        h('div', { class: 'onboarding-head' }, [
          h('div', { class: 'onboarding-title' }, [
            h('span', { class: 'onboarding-icon' }, '☑'),
            h('strong', {}, 'Welcome, @' + (auth.state.user?.username ?? 'there') + ' — finish setting up in 3 steps'),
          ]),
          h('button', {
            class: 'onboarding-dismiss',
            'aria-label': 'Dismiss checklist',
            onClick: dismissOnboarding,
          }, '✕'),
        ]),
        h('ol', { class: 'onboarding-list' }, state.items.map((item, idx) =>
          h('li', { class: 'onboarding-item' }, [
            h('span', { class: ['onboarding-step', item.done && 'done'] }, item.done ? '✓' : String(idx + 1)),
            h('div', { class: 'onboarding-copy' }, [
              h('span', { class: ['onboarding-title-text', item.done && 'done'] }, item.title),
              h('span', { class: 'onboarding-hint' }, item.hint),
            ]),
            item.action
              ? h('a', { class: 'btn sm primary', href: item.action, target: '_blank', rel: 'noopener', onClick: onboardingMarkExplored }, 'View docs')
              : h('span', { class: 'onboarding-action' }, item.done ? 'Done' : ''),
          ]),
        )),
      ]);
    }

    function renderMain() {
      if (openapi.state.loading) {
        return h('div', { class: 'empty' }, 'Loading API spec…');
      }
      // NOTE: a failed spec load no longer blocks the whole dashboard.
      // Overview, API Keys and Shortlinks don't need the OpenAPI spec at
      // all, so we only show the error on the Endpoints tab (the one
      // consumer). The banner doubles as a retry — click it to reload.
      if (openapi.state.error && activeTag.value === '') {
        return h('div', { class: 'empty' }, [
          'Failed to load /docs/json: ' + openapi.state.error,
          ' ',
          h('a', { href: '#', onClick: (e) => { e.preventDefault(); void openapi.load(); }, style: 'color:var(--accent)' }, 'Retry'),
        ]);
      }
      if (activeTag.value === '__overview__') {
        return h(OverviewTab, {
          auth,
          client,
          recent: recent.value,
          openapi,
          onToast: ({ kind, text }) => toast(kind, text),
          onSelectTag,
        });
      }
      if (activeTag.value === '__apikeys__') {
        return h(ApiKeysTab, {
          auth,
          onToast: ({ kind, text }) => toast(kind, text),
        });
      }
      if (activeTag.value === '__shortlinks__') {
        return h(ShortlinkManager, {
          onToast: ({ kind, text }) => toast(kind, text),
        });
      }
      return h(EndpointList, {
        groups: openapi.groups.value,
        activeTag: activeTag.value,
        onSelect: (op) => (openOp.value = op),
      });
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
          renderTabBar(),
          renderOnboarding(),
          renderMain(),
        ]),

        // Modal — keyed on op so re-opening a different endpoint cleanly
        // remounts (clears form + result without manual reset wiring).
        openOp.value && h(TryItModal, {
          key: openOp.value.method + ' ' + openOp.value.path,
          op: openOp.value,
          securitySchemes: openapi.securitySchemes.value,
          apiClient: client,
          onResult: (entry) => recordRequest(entry),
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
