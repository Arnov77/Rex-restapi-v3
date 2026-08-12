/**
 * Rex API — redesigned hero behavior.
 *
 * Vanilla JS, no dependencies (the landing page stays framework-free for
 * Core Web Vitals; see redesign guide §4.3). Responsibilities:
 *
 *   1. statusPill      — live /api/health check; upgrades the pill from
 *                        "Checking…" to operational/degraded/down.
 *   2. typing effect   — types the curl command in the code preview,
 *                        like a developer demoing the API.
 *   3. copy button     — copies the request + a highlighted response.
 *   4. live preview    — optional: if the preview card has
 *                        data-mode="live", it hits the real endpoint and
 *                        renders a syntax-highlighted JSON response with
 *                        real latency. Falls back gracefully.
 */
(function () {
  'use strict';

  var prefersReducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 1. Status pill (CLS-safe: only text is ever replaced) ───────── */
  (function initStatusPill() {
    var pill = document.getElementById('statusPill');
    var text = document.getElementById('statusPillText');
    if (!pill || !text) return;

    function setPill(state, label) {
      pill.setAttribute('data-state', state);
      text.textContent = label;
    }

    setPill('ok', 'Checking API health…');

    fetch('/api/health', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (j) {
        if (j && j.ok) {
          setPill('ok', 'All systems operational · v' + (j.version || '3'));
        } else {
          setPill('err', 'API reported an issue');
        }
      })
      .catch(function () {
        /*
          If the health endpoint is unreachable we never show a false
          "operational" pill — the dot simply goes grey and the text
          explains the check failed. This matches the current site's
          contract (pill hidden on failure) but stays visible for
          transparency.
        */
        setPill('warn', 'Could not verify API status');
      });
  })();

  /* ── 2. Typing effect on the curl command ─────────────────────────── */
  (function initTyping() {
    var el = document.getElementById('cpRequest');
    if (!el) return;

    var FULL = 'curl -H "Authorization: Bearer rex_…" https://rex-api.com/api/ai/imagegen';
    el.textContent = '';

    if (prefersReducedMotion) { el.textContent = FULL; return; }

    var i = 0;
    function type() {
      if (i <= FULL.length) {
        el.textContent = FULL.slice(0, i++);
        setTimeout(type, 14 + Math.random() * 26);
      } else {
        /* Cursor stays blinking next to the finished command. */
        var cursor = document.querySelector('.cp-cursor');
        if (cursor && el.parentNode) el.parentNode.insertBefore(cursor, el.nextSibling);
      }
    }
    setTimeout(type, 600);
  })();

  /* ── 3. Copy button ──────────────────────────────────────────────── */
  (function initCopy() {
    var btn = document.getElementById('cpCopy');
    var requestEl = document.getElementById('cpRequest');
    if (!btn || !requestEl) return;

    btn.addEventListener('click', function () {
      var snippet = '# Rex API — quick start\n' + requestEl.textContent + '\n\n' +
        '# Response (sample): { "success": true, "data": { ... } }';

      var done = function () {
        btn.innerHTML =
          '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
          'stroke-width="1.8" aria-hidden="true">' +
          '<path d="M3 8.5 6.5 12 13 4.5"/></svg>Copied!';
        setTimeout(function () {
          btn.innerHTML =
            '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
            'stroke-width="1.6" aria-hidden="true">' +
            '<rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.6"/>' +
            '<path d="M3 10.5V3.5a1.5 1.5 0 0 1 1.5-1.5H11"/></svg>Copy';
        }, 1800);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(snippet)
          .then(done)
          .catch(function () { fallbackCopy(snippet, done); });
      } else {
        fallbackCopy(snippet, done);
      }

      function fallbackCopy(text, cb) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
          var ok = document.execCommand('copy');
          if (!ok) { /* clipboard blocked by browser sandbox — still notify user */ }
        } catch (e) { /* noop */ }
        document.body.removeChild(ta);
        cb();
      }
    });
  })();

  /* ── 4. Optional live endpoint preview ──────────────────────────────
   *
   * If the preview card carries data-mode="live" and data-endpoint,
   * this block calls the real API (public endpoints need no auth) and
   * re-renders the response pane with real latency + real JSON. When
   * the endpoint requires a key, or the call fails, we silently keep
   * the static demo — never a broken hero.
   */
  (function initLivePreview() {
    var card = document.getElementById('codePreview');
    if (!card || card.getAttribute('data-mode') !== 'live') return;

    var endpoint = card.getAttribute('data-endpoint');
    var responseEl = document.getElementById('cpResponse');
    var badgeEl = document.getElementById('cpBadge');
    var latencyEl = document.getElementById('cpLatency');
    if (!endpoint || !responseEl) return;

    var start = performance.now();
    fetch(endpoint, { headers: { Accept: 'application/json' } })
      .then(function (r) {
        var ms = Math.round(performance.now() - start);
        var ok = r.ok;
        badgeEl.textContent = r.status + (ok ? ' OK' : '');
        badgeEl.classList.toggle('err', !ok);
        if (!ok) throw new Error('non-2xx');
        return r.json().then(function (j) { return { j: j, ms: ms }; });
      })
      .then(function (res) {
        responseEl.innerHTML = highlight(
          JSON.stringify(res.j, null, 2)
        );
        latencyEl.innerHTML = '<strong>' + res.ms + '</strong> ms';
      })
      .catch(function () { /* keep the static demo; never break the hero */ });

    /* Tiny JSON highlighter — no library needed for the demo pane. */
    function highlight(json) {
      return json
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(
          /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
          function (m) {
            var cls = 'n'; /* number */
            if (/^"/.test(m)) { cls = /:$/.test(m) ? 'k' : 's'; }
            else if (/true|false/.test(m)) { cls = 'b'; }
            else if (/null/.test(m)) { cls = 'c'; }
            return '<span class="' + cls + '">' + m + '</span>';
          }
        );
    }
  })();
})();
