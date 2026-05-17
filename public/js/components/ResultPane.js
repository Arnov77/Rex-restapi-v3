/**
 * ResultPane — render the outcome of a Try-It request.
 *
 * Branches by content-type:
 *   image/*           → inline preview + download anchor
 *   application/json  → pretty-print, error-aware highlight
 *   text/*            → plain text in <pre>
 *   binary / unknown  → just the metadata pills + a "download response"
 *
 * Always shows: status pill, latency, content-type, x-request-id (copy on
 * click), and quota / rate-limit chips when present. The hierarchy of
 * importance for a developer is: status → message → request-id, in that
 * order. Layout reflects that.
 *
 * Props:
 *   loading: boolean
 *   error:   Error|null     (network-level or pre-flight failure)
 *   result:  ApiResult|null (from api.execute)
 *   filename: string        (for the download anchor when blob)
 */

import { h, computed, ref, onUnmounted, watch } from 'vue';

export default {
  name: 'ResultPane',
  props: {
    loading: { type: Boolean, default: false },
    error: { type: Object, default: null },
    result: { type: Object, default: null },
    filename: { type: String, default: 'response' },
  },
  setup(props) {
    // Countdown for 429 Retry-After. Re-armed every time a new result lands.
    const countdown = ref(0);
    let timer = null;
    function clearTimer() { if (timer) { clearInterval(timer); timer = null; } }
    onUnmounted(clearTimer);

    watch(() => props.result, (r) => {
      clearTimer();
      if (r?.retryAfter && r.status === 429) {
        countdown.value = r.retryAfter;
        timer = setInterval(() => {
          countdown.value -= 1;
          if (countdown.value <= 0) clearTimer();
        }, 1000);
      } else {
        countdown.value = 0;
      }
    });

    const statusClass = computed(() => {
      const s = props.result?.status ?? 0;
      if (s >= 500) return 'status-5xx';
      if (s >= 400) return 'status-4xx';
      if (s >= 300) return 'status-3xx';
      if (s >= 200) return 'status-2xx';
      return '';
    });

    function copyRequestId() {
      const id = props.result?.requestId;
      if (id) navigator.clipboard?.writeText(id);
    }

    function renderMeta() {
      const r = props.result;
      if (!r) return null;
      return h('div', { class: 'result-head' }, [
        h('span', { class: 'status-pill ' + statusClass.value },
          r.status + ' ' + (r.statusText || ''),
        ),
        h('span', { class: 'result-meta' }, [
          h('strong', {}, r.elapsedMs + 'ms'),
        ]),
        r.contentType && h('span', { class: 'result-meta' }, r.contentType.split(';')[0]),
        r.dailyLimit && h('span', { class: 'result-meta' },
          ['daily ', h('strong', {}, r.dailyLimit.used + '/' + r.dailyLimit.limit)],
        ),
        r.rateLimit && h('span', { class: 'result-meta' },
          ['rate ', h('strong', {}, (r.rateLimit.limit - r.rateLimit.remaining) + '/' + r.rateLimit.limit)],
        ),
        r.requestId && h('span', { class: 'result-id' }, [
          'req: ',
          h('span', { class: 'copy', title: 'Copy request id', onClick: copyRequestId }, r.requestId),
        ]),
      ]);
    }

    function renderError() {
      // For 4xx: show the envelope's error.message prominently.
      // For 5xx: also nudge user to /api/ready.
      const r = props.result;
      const env = r?.json;
      const msg = env?.error?.message || env?.message || (r?.text ?? '');

      return h('div', { class: 'result-body' }, [
        msg && h('div', { class: 'error-msg' }, msg),

        countdown.value > 0 && h('div', { class: 'error-hint' }, [
          'Retry in ',
          h('span', { class: 'countdown' }, countdown.value + 's'),
          '.',
        ]),

        r?.status >= 500 && h('div', { class: 'error-hint' }, [
          'Server error — check ',
          h('a', { href: '/api/ready', target: '_blank', rel: 'noopener' }, 'readiness'),
          ' to see if a dependency (Supabase, Chromium) is down.',
        ]),

        // Always include the raw body for inspection — devs need this.
        env && h('pre', {}, JSON.stringify(env, null, 2)),
        !env && r?.text && h('pre', {}, r.text),
      ]);
    }

    function renderImage() {
      const r = props.result;
      const ext = (r.contentType.split('/')[1] || 'bin').split(';')[0];
      const fname = `${props.filename}.${ext === 'jpeg' ? 'jpg' : ext}`;
      return h('div', { class: 'result-body' }, [
        h('img', { src: r.blobUrl, alt: 'response preview' }),
        h('div', { class: 'download-row' }, [
          h('a', { class: 'btn', href: r.blobUrl, download: fname }, '⬇ Download ' + fname),
          h('span', { style: 'color:var(--fg-dim);font-size:12px;align-self:center' },
            r.blob ? `${(r.blob.size / 1024).toFixed(1)} KB` : '',
          ),
        ]),
      ]);
    }

    function renderJson() {
      const r = props.result;
      return h('div', { class: 'result-body' },
        h('pre', {}, JSON.stringify(r.json, null, 2)),
      );
    }

    function renderText() {
      const r = props.result;
      return h('div', { class: 'result-body' }, h('pre', {}, r.text || '(empty body)'));
    }

    function renderBlob() {
      const r = props.result;
      return h('div', { class: 'result-body' }, [
        h('div', { style: 'color:var(--fg-mu);margin-bottom:8px' }, 'Binary response.'),
        h('div', { class: 'download-row' }, [
          h('a', { class: 'btn', href: r.blobUrl, download: props.filename }, '⬇ Download'),
        ]),
      ]);
    }

    function renderEmpty() {
      const r = props.result;
      return h('div', { class: 'result-body' }, h('pre', {},
        r.status === 204 ? '(no content)' : '(empty body)',
      ));
    }

    return () => {
      if (props.loading) {
        return h('div', { class: 'result' }, [
          h('div', { class: 'result-body', style: 'display:flex;align-items:center;gap:10px' }, [
            h('span', { class: 'spinner' }),
            h('span', { style: 'color:var(--fg-mu)' }, 'Executing…'),
          ]),
        ]);
      }
      if (props.error) {
        return h('div', { class: 'result' }, [
          h('div', { class: 'result-head' }, [
            h('span', { class: 'status-pill status-5xx' }, 'Error'),
          ]),
          h('div', { class: 'result-body' }, [
            h('div', { class: 'error-msg' }, props.error.message),
            h('div', { class: 'error-hint' }, 'The request failed before reaching the server (network or CORS).'),
          ]),
        ]);
      }
      const r = props.result;
      if (!r) return null;

      const ct = r.contentType.toLowerCase();
      let body;
      if (!r.ok) {
        body = renderError();
      } else if (ct.startsWith('image/')) {
        body = renderImage();
      } else if (r.json !== undefined) {
        body = renderJson();
      } else if (r.text !== undefined) {
        body = renderText();
      } else if (r.blob) {
        body = renderBlob();
      } else {
        body = renderEmpty();
      }

      return h('div', { class: 'result' }, [
        renderMeta(),
        body,
      ]);
    };
  },
};
