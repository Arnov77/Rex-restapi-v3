/**
 * Rex API — landing page behavior (merged, vanilla).
 *
 * Loads deferred so it never blocks rendering (Core Web Vitals,
 * redesign guide §4.3). All behavior is framework-free and survives
 * failure of any single piece: if /api/health or the clipboard API is
 * blocked, the page keeps working with static content.
 *
 *   1. Status pill — three-state liveness check with CLS-safe updates.
 *   2. Code preview — typing effect, copy button, optional live mode.
 *   3. Stat counters — animate social-proof numbers on scroll.
 *   4. Endpoint chips — click any feature endpoint to copy a curl command.
 *   5. FAQPage schema — hydrates FAQ structured data from real content.
 *   6. Footer status — live /api/health ping in the footer.
 *   7. Scroll-aware navbar — slides up when scrolling down past the
 *      hero, slides back down on upward scroll.
 */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 1. Status pill (CLS-safe three-state machine) ─────────────── */
  (function initStatusPill() {
    var pill = document.getElementById('statusPill');
    var text = document.getElementById('statusPillText');
    if (!pill || !text) return;

    // The pill is visible from first paint (guide §4.3 CLS fix). On
    // failure we downgrade the text in place — never hidden/unhidden,
    // so layout cannot shift.
    function setState(state, message) {
      pill.setAttribute('data-state', state);
      text.textContent = message;
      var dot = pill.querySelector('.dot');
      if (dot) { dot.style.background = state === 'ok' ? 'var(--ok)' : state === 'warn' ? 'var(--warn)' : 'var(--err)'; }
    }

    fetch('/api/health', { headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.ok ? r.json() : Promise.reject(r.status);
      })
      .then(function (j) {
        if (j && j.ok) {
          setState('ok', 'All systems operational · v' + (j.version || '?'));
        } else {
          setState('warn', 'Limited availability · check /api/health');
        }
      })
      .catch(function () {
        setState('err', 'Could not verify API status');
      });
  })();

  /* ── 2. Code preview (typing effect + copy + optional live mode) ───
   *
   * Static demo mode by default (zero network cost, never blocks paint).
   * Set data-mode="live" on #codePreview to fetch the real endpoint —
   * a failed live fetch simply keeps the static demo, so the hero
   * never breaks. */
  (function initCodePreview() {
    var el = document.getElementById('codePreview');
    if (!el) return;

    var requestEl = document.getElementById('cpRequest');
    var responseEl = document.getElementById('cpResponse');
    var copyBtn = document.getElementById('cpCopy');
    var badge = document.getElementById('cpBadge');
    var latencyEl = document.getElementById('cpLatency');
    var mode = el.getAttribute('data-mode') || 'demo';

    /* Typing effect over the static curl command. */
    if (!reduced && requestEl) {
      var full = requestEl.textContent.trim();
      requestEl.textContent = '';
      var i = 0;
      function type() {
        if (i <= full.length) {
          requestEl.textContent = full.slice(0, i);
          i++;
          setTimeout(type, 22 + Math.random() * 18);
        }
      }
      type();
    }

    /* Copy button: copies request + response, with fallback. */
    if (copyBtn && requestEl && responseEl) {
      copyBtn.addEventListener('click', function () {
        var snippet = requestEl.textContent.trim() + '\n\n' + responseEl.textContent.replace('Copy', '').trim();
        var done = function () {
          copyBtn.classList.add('copied');
          copyBtn.lastChild && (copyBtn.childNodes[copyBtn.childNodes.length - 1].nodeValue = ' Copied!');
          setTimeout(function () {
            copyBtn.classList.remove('copied');
            copyBtn.childNodes[copyBtn.childNodes.length - 1].nodeValue = ' Copy';
          }, 1800);
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(snippet).then(done).catch(done);
        } else {
          done();
        }
      });
    }

    /* Live mode: fetch the real endpoint and render the real response. */
    if (mode === 'live') {
      var endpoint = el.getAttribute('data-endpoint') || '/api/health';
      var start = performance.now();
      fetch(endpoint, { headers: { Accept: 'application/json' } })
        .then(function (r) {
          var ms = Math.round(performance.now() - start);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json().then(function (j) { return { j: j, ms: ms }; });
        })
        .then(function (res) {
          if (responseEl) {
            responseEl.textContent = JSON.stringify(res.j, null, 2);
          }
          if (latencyEl) {
            latencyEl.innerHTML = '<strong>' + res.ms + '</strong> ms';
          }
        })
        .catch(function () {
          /* Live fetch failed: keep the static demo, mark the badge. */
          if (badge) { badge.textContent = 'demo'; badge.classList.add('err'); }
        });
    }
  })();

  /* ── 3. Animated stat counters ─────────────────────────────────── */
  (function initCounters() {
    var stats = document.querySelectorAll('.stat[data-count]');
    if (!stats.length) return;

    var finish = function (el) {
      var target = parseInt(el.getAttribute('data-count'), 10);
      var span = el.querySelector('.accent');
      if (span) span.textContent = target;
    };

    if (!('IntersectionObserver' in window)) { stats.forEach(finish); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var el = e.target;
        var target = parseInt(el.getAttribute('data-count'), 10);
        var span = el.querySelector('.accent');
        if (!span) return;
        if (reduced) { span.textContent = target; return; }

        var start = performance.now();
        var duration = 900;
        function tick(now) {
          var p = Math.min((now - start) / duration, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          span.textContent = Math.round(target * eased);
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.4 });

    stats.forEach(function (el) { io.observe(el); });
  })();

  /* ── 4. Endpoint chips: copy a ready-made curl command ─────────── */
  (function initEndpointChips() {
    document.querySelectorAll('.feat-endpoint[data-endpoint]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var endpoint = btn.getAttribute('data-endpoint');
        var method = (btn.querySelector('.method') || { textContent: 'GET' }).textContent.trim();
        var snippet = '# Rex API — ' + endpoint + '\ncurl -H "Authorization: Bearer rex_YOUR_KEY" ' +
          (method === 'POST' ? '-X POST ' : '') +
          'https://rexapi.my.id' + endpoint;

        var original = btn.innerHTML;
        var copied = function () {
          btn.innerHTML = '<span class="method">COPIED</span>' + endpoint;
          setTimeout(function () { btn.innerHTML = original; }, 1600);
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(snippet).then(copied).catch(function () {
            btn.innerHTML = '<span class="method">SELECT MANUALLY</span>' + endpoint;
            setTimeout(function () { btn.innerHTML = original; }, 2200);
          });
        } else {
          copied();
        }
      });
    });
  })();

  /* ── 5. FAQPage JSON-LD hydration from the real page content ──────
   *
   * The #faqSchema block ships with mainEntity: [] on purpose; this
   * fills it from the visible <details> so structured data can never
   * drift from the markup (rich-results disqualification guard). */
  (function initFaqSchema() {
    var host = document.getElementById('faqSchema');
    var items = document.querySelectorAll('#faq details.faq-item');
    if (!host || !items.length) return;

    var mainEntity = Array.from(items).map(function (d) {
      var q = (d.querySelector('summary') || { textContent: '' }).textContent.trim();
      var a = (d.querySelector('.faq-answer') || { textContent: '' }).textContent.trim();
      return {
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a }
      };
    });

    var data = JSON.parse(host.textContent || '{}');
    data.mainEntity = mainEntity;
    host.textContent = JSON.stringify(data, null, 2);
  })();

  /* ── 6. Footer status ping ─────────────────────────────────────── */
  (function initFooterStatus() {
    var el = document.getElementById('footerStatus');
    if (!el) return;

    fetch('/api/health', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (j) { el.textContent = (j && j.ok) ? 'operational' : 'issues reported'; })
      .catch(function () { el.textContent = 'unverified'; });
  })();

  /* ── 7. Sticky navbar — pins exactly as it touches the viewport ─
   *
   * The topbar sits in its natural place in the page flow. While the
   * hero is visible, the bar scrolls with the page.
   *
   * The pin threshold is computed from the bar's OWN position, not
   * from the hero: the moment the bar's top edge would pass the top
   * of the viewport (getBoundingClientRect().top <= 0), it switches
   * to `position: fixed; top: 0` and a matching spacer holds its
   * height in the flow. Because the threshold is the bar's own
   * visual edge, the handoff happens at the exact frame the bar
   * reaches the viewport top — it can never scroll above the top
   * edge and briefly "disappear" between the hero and the social-
   * proof section. Scrolling back up unpins it the moment its
   * natural position is back within the viewport (CLS-safe).
   *
   * A single { passive: true } scroll listener, throttled by
   * requestAnimationFrame — no measurable scrolling cost. No
   * animation, so reduced-motion users get identical behavior. */
  (function initScrollNavbar() {
    var bar = document.querySelector('.topbar');
    if (!bar) return;

    // The spacer reserves the bar's height while it is pinned fixed,
    // so pinning/unpinning never shifts the layout.
    var spacer = document.createElement('div');
    spacer.className = 'topbar-spacer';
    spacer.style.display = 'none';
    bar.parentNode.insertBefore(spacer, bar);

    var pinned = false;
    function setPinned(state) {
      if (state === pinned) return;
      pinned = state;
      spacer.style.display = state ? 'block' : 'none';
      if (state) {
        bar.classList.add('is-pinned');
        spacer.style.height = bar.offsetHeight + 'px';
      } else {
        bar.classList.remove('is-pinned');
      }
    }

    function onScroll() {
      // Pin the moment the bar's top edge reaches the viewport top.
      setPinned(bar.getBoundingClientRect().top <= 0);
    }

    function schedule() {
      requestAnimationFrame(onScroll);
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    onScroll();
  })();
})();
