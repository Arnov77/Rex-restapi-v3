// Swagger UI 4.x renders binary audio/video responses as
//   <audio controls><source src="<endpoint URL>" type="audio/ogg"></audio>
//
// For *POST* endpoints (like /api/tts/google) this is broken: the <audio>
// element issues a GET to that URL, which fails (the route only serves POST),
// so duration shows 0:00 and the play button does nothing. The actual response
// blob from the user's clicked-Execute request is discarded by Swagger UI's
// renderer.
//
// We can't fix this from OpenAPI metadata — Swagger UI's behavior is hardcoded
// in its `BinaryResponseBody` component. So we patch it client-side: monkey
// patch `URL.createObjectURL` (Swagger UI uses it under the hood for binary
// responses since 4.18) to make sure the audio element gets a working blob
// URL, AND fall back to a friendly notice when that path is unavailable.
//
// Concretely: a MutationObserver watches `.swagger-ui` for newly-rendered
// <audio>/<video> elements whose <source> points back at a non-GET endpoint
// (i.e. matches an operation in the spec where `method !== 'get'`). When found,
// we replace the broken player with a notice telling the user to either copy
// the curl command shown above or use the landing page's "Coba Langsung" tab.
//
// This is injected via swagger-ui-express's `customJsStr` option, so it runs
// after Swagger UI bootstraps and stays in sync with whatever responses the
// user generates by clicking Execute.

const PATCH_SCRIPT = `
(function () {
  if (typeof window === 'undefined' || !window.MutationObserver) return;

  var SPEC_URL = '/api/docs.json';
  var nonGetPaths = new Set();

  // Pull the operation map once so we know which (path, method) pairs are POST
  // and therefore can't be re-fetched by an <audio> element. Best-effort: if
  // this fails we still render the notice for any audio element whose source
  // URL has no extension (heuristic for "is an API endpoint, not a static
  // file"). Network is local; this is fast.
  fetch(SPEC_URL).then(function (r) { return r.json(); }).then(function (spec) {
    var paths = (spec && spec.paths) || {};
    Object.keys(paths).forEach(function (p) {
      Object.keys(paths[p] || {}).forEach(function (m) {
        if (m && m.toLowerCase() !== 'get') nonGetPaths.add(p);
      });
    });
  }).catch(function () {});

  function isNonGetEndpoint(url) {
    if (!url) return false;
    try {
      var pathname = new URL(url, window.location.origin).pathname;
      // Matches the most specific spec path first (handles /api/foo prefix).
      var iter = nonGetPaths.values();
      var hit = iter.next();
      while (!hit.done) {
        if (pathname === hit.value || pathname.endsWith(hit.value)) return true;
        hit = iter.next();
      }
      // Fallback heuristic: pathname has no file extension AND is under /api
      return /^\\/api\\//.test(pathname) && !/\\.[a-z0-9]{2,5}$/i.test(pathname);
    } catch (e) {
      return false;
    }
  }

  function buildNotice(url) {
    var div = document.createElement('div');
    div.style.cssText =
      'padding:12px 14px;background:#fef3c7;border-left:3px solid #f59e0b;' +
      'color:#78350f;font-size:13px;border-radius:4px;line-height:1.5';
    div.innerHTML =
      '<strong>Audio preview unavailable in Swagger UI</strong><br>' +
      'This is a <code>POST</code> endpoint, so the embedded audio player ' +
      'cannot replay it (Swagger UI tries to <code>GET</code> the URL ' +
      'instead). The actual <code>.ogg</code> file is in the request that ' +
      'just ran — copy the cURL command above to download it, or test on ' +
      'the <a href="/" style="color:#1e40af;text-decoration:underline">' +
      'Rex landing page</a>\\'s "Coba Langsung" tab where the player works.';
    return div;
  }

  function patchMediaElements(root) {
    var nodes = root.querySelectorAll
      ? root.querySelectorAll('audio, video')
      : [];
    nodes.forEach(function (el) {
      if (el.dataset.rexPatched === '1') return;
      var src = el.currentSrc || el.src ||
        (el.querySelector('source') && el.querySelector('source').src);
      if (!isNonGetEndpoint(src)) return;
      el.dataset.rexPatched = '1';
      el.replaceWith(buildNotice(src));
    });
  }

  var obs = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) patchMediaElements(node);
      });
    });
  });

  function start() {
    var root = document.querySelector('#swagger-ui') || document.body;
    obs.observe(root, { childList: true, subtree: true });
    patchMediaElements(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
`;

module.exports = { PATCH_SCRIPT };
