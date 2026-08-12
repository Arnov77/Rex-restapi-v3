/**
 * OverviewTab — dashboard analytics surface.
 *
 * Cards:
 *   Requests Today  — from /api/me/usage (daily counter), rendered as a
 *                     big number + quota usage bar
 *   Daily Quota     — limit/pct from the same source, color-graded
 *                     (accent → warn > 80% → err > 95%)
 *   Active API Key  — masked prefix of the cached key + copy button
 *   Quick Start     — ready-made curl snippet with copy + Regenerate Key
 *   Activity (7d)   — area chart. NOTE: the backend exposes only a single
 *                     daily counter, not a history series. Until a
 *                     history endpoint exists (/api/me/usage?range=7d or
 *                     an audit-log route), we render the locally-recorded
 *                     recent log as per-request points and a deterministic
 *                     placeholder series for days without data. Replace
 *                     `chartPoints()` with a real fetch when available.
 *   Recent Requests — the locally-recorded execution log (method pill,
 *                     path, status color, relative age)
 *   Quota band      — shown when usage > 80% with an upgrade hint
 *
 * Emits:
 *   onToast({ kind, text }) — feedback bubbles (copy, regenerate)
 */

import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue';
import PasswordModal from './PasswordModal.js';

const LS_RECENT = 'rex.recent';

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => undefined);
  }
  // Fallback for blocked clipboards (file://, sandboxed frames).
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

/** Relative age like "2m ago", "1h ago", "3d ago". */
function relativeAge(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm ago';
  const hr = Math.round(m / 60);
  if (hr < 24) return hr + 'h ago';
  return Math.round(hr / 24) + 'd ago';
}

/**
 * 7-day chart points. With only a daily counter available, the series is
 * seeded from the locally-recorded log (last 7 days) plus zeros elsewhere.
 * When the backend gains a history endpoint, swap this body for:
 *   const r = await fetch('/api/me/usage/history?days=7', …);
 *   return r.data;
 */
function chartPoints(recent) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const start = d.getTime();
    const end = start + 86400000;
    const n = (recent || []).filter((e) => e.ts >= start && e.ts < end).length;
    days.push({ label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), value: n });
  }
  return days;
}

export default {
  name: 'OverviewTab',
  props: {
    auth: { type: Object, required: true },
    client: { type: Object, required: true },
    recent: { type: Array, default: () => [] },
    openapi: { type: Object, required: true },
  },
  emits: ['onToast', 'selectTag'],
  setup(props, { emit }) {
    // Password modal state — replaces the vanilla window.prompt() call for
    // key regeneration. When the modal closes, everything resets so the
    // next open starts clean.
    const regenModalOpen = ref(false);
    const regenLoading = ref(false);
    const regenError = ref(null);

    const maskedKey = computed(() => {
      const k = props.auth.state.apiKey;
      if (!k) return null;
      return k.length > 8 ? k.slice(0, 7) + '…' + k.slice(-3) : '••••••';
    });

    const used = computed(() => props.auth.state.usage?.used ?? 0);
    const limit = computed(() => props.auth.state.usage?.limit ?? 0);
    const pct = computed(() => (limit.value ? Math.min(100, Math.round((used.value / limit.value) * 100)) : 0));

    // Color grade: accent by default, warn > 80%, err > 95%.
    const meterTone = computed(() =>
      pct.value > 95 ? 'err' : pct.value > 80 ? 'warn' : 'accent',
    );

    const points = computed(() => chartPoints(props.recent));
    const maxVal = computed(() => Math.max(10, ...points.value.map((p) => p.value)));

    // --- Live usage refresh ---------------------------------------------
    //
    // The "Requests today" and quota cards read the server's daily counter
    // (/api/me/usage) — a single point-in-time snapshot fetched at page
    // boot. Requests made OUTSIDE the dashboard (curl, bots, other tabs)
    // still increment that counter server-side, but without a re-fetch
    // the cards stay frozen at the boot value while activity piles up.
    //
    // Fix: re-pull the counter on a gentle interval (30s) while the user
    // is signed in, plus an immediate catch-up refresh when this tab is
    // mounted (covers users who idle on another tab). Polling — not
    // pushing — because the backend exposes no usage events/webhooks;
    // 30s is a sensible middle ground between freshness and cost.
    const USAGE_POLL_MS = 30000;
    let usageTimer = null;

    function pollUsage() {
      if (props.auth.isAuthenticated.value) {
        props.auth.refreshUsage().catch(() => {}); // stale snapshot beats silent failure
      }
    }

    onMounted(() => {
      pollUsage(); // catch-up: usage may have moved while on another tab
      usageTimer = setInterval(pollUsage, USAGE_POLL_MS);
    });
    onBeforeUnmount(() => {
      if (usageTimer) clearInterval(usageTimer);
    });

    // Signed-in users who have never minted a key see an inline CTA.
    const noKeyCta = computed(() =>
      props.auth.isAuthenticated.value && !props.auth.state.apiKey,
    );

    function copyKey() {
      if (!props.auth.state.apiKey) return;
      copyText(props.auth.state.apiKey).then((ok) => {
        emit('onToast', { kind: ok === false ? 'err' : 'ok', text: ok === false ? 'Copy blocked — reveal your key in Settings instead' : 'API key copied to clipboard' });
      });
    }

    function copyQuickStart() {
      const key = props.auth.state.apiKey || 'YOUR_API_KEY';
      const snippet = `curl -H "X-API-Key: ${key}" "https://${window.location.host}/api/ai/chat" \\
  -d '{"prompt": "Hello, Rex"}'`;
      copyText(snippet).then((ok) => {
        emit('onToast', { kind: ok === false ? 'err' : 'ok', text: ok === false ? 'Copy blocked — select the snippet manually' : 'Quick Start snippet copied' });
      });
    }

    function openRegenModal() {
      if (!props.auth.isAuthenticated.value) {
        emit('onToast', { kind: 'err', text: 'Sign in first — key regeneration requires your account' });
        return;
      }
      regenModalOpen.value = true;
      regenLoading.value = false;
      regenError.value = null;
    }

    async function submitRegenerate(password) {
      if (regenLoading.value) return;
      regenLoading.value = true;
      regenError.value = null;
      try {
        await props.auth.regenerateKey(password);
        regenModalOpen.value = false;
        emit('onToast', { kind: 'ok', text: 'New API key generated — it\u2019s active now' });
      } catch (err) {
        // Wrong password / server error stays INSIDE the modal (inline
        // error + retry) instead of a toast + browser prompt.
        regenError.value = err?.message || 'Regeneration failed — check your password and try again';
      } finally {
        regenLoading.value = false;
      }
    }

    // Signed-in users without a cached key get a one-tap affordance to the
    // API Keys tab where the Reveal flow lives (no dead-end text).
    function goToApiKeys() {
      // Event name must match the prop app.js passes ('onSelectTag' binds
      // to the emitted event 'selectTag' in Vue 3 — same convention the
      // Sidebar and Recent-requests card use).
      emit('selectTag', '__apikeys__');
    }

    function regenModal() {
      if (!regenModalOpen.value) return null;
      return h(PasswordModal, {
        title: 'Regenerate API key',
        hint: 'Your current key will stop working immediately — every device and bot using it must switch to the new one.',
        actionLabel: 'Regenerate key',
        danger: true,
        loading: regenLoading.value,
        error: regenError.value,
        onConfirm: submitRegenerate,
        onCancel: () => { regenModalOpen.value = false; },
        onClose: () => { regenModalOpen.value = false; },
      });
    }

    // --- Stat card -------------------------------------------------------

    function statCard({ icon, label, value, unit, meta, tone, children }) {
      return h('div', { class: ['stat-card', tone && 'tone-' + tone] }, [
        h('div', { class: 'stat-icon' }, icon),
        h('div', { class: 'stat-body' }, [
          h('div', { class: 'stat-label' }, label),
          h('div', { class: 'stat-value' }, [
            h('strong', {}, value),
            unit && h('span', { class: 'stat-unit' }, unit),
          ]),
          meta && h('div', { class: 'stat-meta' }, meta),
          ...(children ? [children] : []),
        ]),
      ]);
    }

    function usageMeter({ used, limit, pct, tone }) {
      if (!limit) return h('div', { class: 'stat-meta' }, '—');
      return h('div', { class: 'stat-meter' }, [
        h('div', { class: 'meter-bar' }, [
          h('div', { class: ['meter-fill', tone && 'tone-' + tone], style: `width:${pct}%` }),
        ]),
        h('div', { class: 'meter-labels' }, [
          h('span', {}, `${used} / ${limit}`),
          h('span', { class: 'meter-pct' }, pct + '%'),
        ]),
      ]);
    }

    // --- 7-day chart -----------------------------------------------------
    // Pure SVG, no chart library — keeps the bundle at zero extra bytes
    // and the draw at a single paint (LCP-friendly).

    function renderChart() {
      const data = points.value;
      const w = 720, hpx = 180;
      const pad = { l: 36, r: 12, t: 16, b: 26 };
      const cw = w - pad.l - pad.r;
      const ch = hpx - pad.t - pad.b;
      const step = cw / (data.length - 1);
      const scale = (v) => ch - (v / maxVal.value) * ch;

      const pathD = data.map((p, i) => {
        const x = pad.l + i * step;
        const y = pad.t + scale(p.value);
        return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
      const areaD = pathD + ` L${(pad.l + (data.length - 1) * step).toFixed(1)},${(pad.t + ch).toFixed(1)} L${pad.l.toFixed(1)},${(pad.t + ch).toFixed(1)} Z`;

      return h('svg', {
        class: 'chart-svg',
        viewBox: `0 0 ${w} ${hpx}`,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': 'Requests per day, last 7 days',
      }, [
        // gridlines
        ...[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = pad.t + ch * (1 - f);
          return h('line', { x1: pad.l, y1: y, x2: w - pad.r, y2: y, class: 'chart-grid' });
        }),
        // y-axis labels
        ...[0, 0.5, 1].map((f) => {
          const y = pad.t + ch * (1 - f);
          return h('text', { x: pad.l - 8, y: y + 4, class: 'chart-ylabel' }, String(Math.round(maxVal.value * f)));
        }),
        h('path', { d: areaD, class: 'chart-area' }),
        h('path', { d: pathD, class: 'chart-line', fill: 'none' }),
        // points
        ...data.map((p, i) => h('circle', {
          cx: pad.l + i * step,
          cy: pad.t + scale(p.value),
          r: 3,
          class: 'chart-dot',
        })),
        // x-axis labels
        ...data.map((p, i) => h('text', {
          x: pad.l + i * step,
          y: hpx - 6,
          class: 'chart-xlabel',
          'text-anchor': 'middle',
        }, p.label)),
      ]);
    }

    function renderChartCard() {
      return h('div', { class: 'card chart-card' }, [
        h('div', { class: 'card-head' }, [
          h('h2', { class: 'card-title' }, 'Requests — last 7 days'),
          h('span', { class: 'card-meta' }, props.recent.length + ' recorded'),
        ]),
        renderChart(),
      ]);
    }

    // --- Recent requests log ---------------------------------------------

    function recentItem(entry) {
      return h('div', { class: 'recent-row', key: entry.ts + entry.path }, [
        h('span', { class: ['method-tag', 'method-' + entry.method] }, entry.method),
        h('span', { class: 'recent-path' }, entry.path),
        h('span', { class: ['recent-status', 'status-' + String(entry.status).charAt(0) + 'xx'] }, entry.status),
        h('span', { class: 'recent-age' }, relativeAge(entry.ts)),
      ]);
    }

    function renderRecentCard() {
      const rows = [...props.recent].reverse();
      return h('div', { class: 'card' }, [
        h('div', { class: 'card-head' }, [
          h('h2', { class: 'card-title' }, 'Recent requests'),
          h('button', {
            class: 'card-action',
            onClick: () => emit('selectTag', ''),
          }, 'Open playground →'),
        ]),
        rows.length === 0
          ? h('div', { class: 'empty-sm' }, 'No requests yet — run an endpoint from the playground and it will appear here.')
          : h('div', { class: 'recent-list' }, rows.map(recentItem)),
        h('div', { class: 'card-foot' }, 'Recorded locally in this browser · UTC'),
      ]);
    }

    // --- Quick Start card ------------------------------------------------

    function renderQuickStart() {
      const snippet = `curl -H "X-API-Key: ${props.auth.state.apiKey || 'YOUR_API_KEY'}" \\\n  "https://${window.location.host}/api/ai/chat" \\\n  -d '{"prompt": "Hello, Rex"}'`;
      return h('div', { class: 'card quickstart-card' }, [
        h('div', { class: 'card-head' }, [
          h('h2', { class: 'card-title' }, 'Quick Start'),
        ]),
        h('p', { class: 'quickstart-desc' }, 'Make your first API request with cURL — copy, run, done.'),
        h('div', { class: 'snippet' }, [
          h('pre', {}, snippet),
          h('button', {
            class: 'snippet-copy',
            title: 'Copy snippet',
            'aria-label': 'Copy Quick Start snippet',
            onClick: copyQuickStart,
          }, '⎘'),
        ]),
        noKeyCta.value
          ? h('a', { class: 'btn primary full', href: '/register?next=/dashboard' }, 'Register to get a key')
          : h('div', { class: 'quickstart-actions' }, [
              h('button', { class: 'btn primary full', onClick: openRegenModal }, 'Regenerate key'),
            ]),
      ]);
    }

    // --- Quota warning band ----------------------------------------------

    function renderQuotaBand() {
      if (!props.auth.isAuthenticated.value) return null;
      if (pct.value <= 80) return null;
      const tone = pct.value > 95 ? 'err' : 'warn';
      return h('div', { class: ['quota-band', 'tone-' + tone] }, [
        h('span', { class: 'quota-band-icon' }, tone === 'err' ? '⚠' : '◔'),
        h('div', { class: 'quota-band-copy' }, [
          h('strong', {}, `You\u2019re using ${pct.value}% of your daily quota`),
          h('span', {}, 'Upgrade your plan for higher limits and priority support.'),
        ]),
        h('a', { class: 'btn sm', href: '/#tiers' }, 'View plans'),
      ]);
    }

    // --- Main render -----------------------------------------------------

    function renderSignedOut() {
      return h('div', { class: 'card empty' }, [
        h('h2', { class: 'card-title', style: 'margin-bottom:8px' }, 'Sign in to see your analytics'),
        h('p', { style: 'color:var(--fg-mu);font-size:13px;max-width:420px' },
          'Usage stats, your API key, and the activity chart appear here after you sign in. The playground is still open to everyone.'),
        h('a', { class: 'btn primary', href: '/login?next=/dashboard' }, 'Sign in / Register'),
      ]);
    }

    return () => {
      const overview = h('div', { class: 'overview' }, [
        // Title row (matches EndpointList's main-top for consistency)
        h('div', { class: 'main-top' }, [
          h('div', { class: 'main-title-row' }, [
            h('h1', { class: 'main-title' }, 'Dashboard'),
            h('span', { class: 'main-count' },
              props.auth.isAuthenticated.value ? '@' + (props.auth.state.user?.username ?? '') : 'Guest',
            ),
          ]),
        ]),

        props.auth.isAuthenticated.value ? h('div', { class: 'overview-grid' }, [
          // Row 1: stat cards
          statCard({
            icon: '▲',
            label: 'Requests today',
            value: used.value,
            meta: limit.value ? 'of ' + limit.value + ' daily limit' : 'per-IP anonymous limit',
          }),
          statCard({
            icon: '◔',
            label: 'Daily quota',
            value: limit.value || '—',
            unit: limit.value ? '/day' : '',
            children: usageMeter({ used: used.value, limit: limit.value, pct: pct.value, tone: meterTone.value }),
          }),
          statCard({
            icon: '⚿',
            label: 'Active API key',
            value: maskedKey.value || 'None',
            meta: props.auth.state.apiKey ? 'X-API-Key header' : 'No key cached on this device',
            tone: 'glow',
            children: noKeyCta.value
              ? h('button', { class: 'stat-cta', onClick: goToApiKeys }, 'Reveal key')
              : null,
          }),
          renderQuickStart(),

          // Row 2: chart + recent log
          renderChartCard(),
          renderRecentCard(),

          renderQuotaBand(),
        ]) : renderSignedOut(),

        regenModal(),
      ]);

      return overview;
    };
  },
};

